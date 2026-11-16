import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  PrismaClient,
  Prisma,
} from "../apps/api/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
// Opt-in only; every fixture is rolled back. CI provides an isolated PostgreSQL service.
const url = process.env.TEST_DATABASE_URL;
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
afterAll(async () => {
  await db?.$disconnect();
});
async function fixture(tx: Prisma.TransactionClient) {
  const user = await tx.user.create({
    data: { email: `${randomUUID()}@example.test` },
  });
  const habit = await tx.habit.create({
    data: { userId: user.id, title: "Read" },
  });
  const schedule = await tx.habitScheduleVersion.create({
    data: {
      habitId: habit.id,
      effectiveFrom: new Date("2026-11-16"),
      timezone: "America/New_York",
      weekdays: [1, 3, 5],
    },
  });
  return { user, habit, schedule };
}
async function rejected(
  action: (
    tx: Prisma.TransactionClient,
    data: Awaited<ReturnType<typeof fixture>>,
  ) => Promise<unknown>,
  code: string,
) {
  await expect(
    db!.$transaction(async (tx) => action(tx, await fixture(tx))),
  ).rejects.toMatchObject({
    code: "P2010",
    meta: { driverAdapterError: { cause: { originalCode: code } } },
  });
}
describe.skipIf(!url)("PostgreSQL migration constraints", () => {
  it("accepts a valid completion and rolls the fixture back", async () => {
    const rollback = new Error("test rollback");
    let completed = false;
    await expect(
      db!.$transaction(async (tx) => {
        const { habit, schedule } = await fixture(tx);
        await tx.habitCompletion.create({
          data: {
            habitId: habit.id,
            scheduleVersionId: schedule.id,
            scheduledDate: new Date("2026-11-16"),
          },
        });
        await tx.xpTransaction.create({
          data: {
            userId: (
              await tx.habit.findUniqueOrThrow({ where: { id: habit.id } })
            ).userId,
            completionId: (
              await tx.habitCompletion.findFirstOrThrow({
                where: { habitId: habit.id },
              })
            ).id,
            amount: 10,
            reason: "completion",
            idempotencyKey: randomUUID(),
          },
        });
        const userId = (
          await tx.habit.findUniqueOrThrow({ where: { id: habit.id } })
        ).userId;
        const reward = await tx.reward.create({
          data: { userId, title: "Tea", coinCost: 10 },
        });
        const redemption = await tx.rewardRedemption.create({
          data: {
            userId,
            rewardId: reward.id,
            coinCost: 10,
            rewardTitle: "Tea",
            idempotencyKey: randomUUID(),
          },
        });
        await tx.coinTransaction.create({
          data: {
            userId,
            amount: 10,
            reason: "Fund the redemption fixture",
            idempotencyKey: randomUUID(),
          },
        });
        await tx.coinTransaction.create({
          data: {
            userId,
            redemptionId: redemption.id,
            amount: -10,
            reason: "redeem",
            idempotencyKey: randomUUID(),
          },
        });
        completed = true;
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(completed).toBe(true);
  });
  it("rejects duplicate habit/local-date completions", async () =>
    rejected(async (tx, { habit, schedule }) => {
      await tx.habitCompletion.create({
        data: {
          habitId: habit.id,
          scheduleVersionId: schedule.id,
          scheduledDate: new Date("2026-11-16"),
        },
      });
      return tx.$executeRaw`INSERT INTO "HabitCompletion" (id,"habitId","scheduleVersionId","scheduledDate") VALUES (${randomUUID()}::uuid,${habit.id}::uuid,${schedule.id}::uuid,'2026-11-16')`;
    }, "23505"));
  it("rejects an unscheduled local date", async () =>
    rejected(
      (tx, { habit, schedule }) =>
        tx.$executeRaw`INSERT INTO "HabitCompletion" (id,"habitId","scheduleVersionId","scheduledDate") VALUES (${randomUUID()}::uuid,${habit.id}::uuid,${schedule.id}::uuid,'2026-11-17')`,
      "23514",
    ));
  it("rejects overlapping versions", async () =>
    rejected(
      (tx, { habit }) =>
        tx.$executeRaw`INSERT INTO "HabitScheduleVersion" (id,"habitId","effectiveFrom",timezone,weekdays) VALUES (${randomUUID()}::uuid,${habit.id}::uuid,'2026-11-18','UTC',ARRAY[2])`,
      "23P01",
    ));
  it("rejects invalid weekdays", async () =>
    rejected(
      (tx, { habit }) =>
        tx.$executeRaw`INSERT INTO "HabitScheduleVersion" (id,"habitId","effectiveFrom",timezone,weekdays) VALUES (${randomUUID()}::uuid,${habit.id}::uuid,'2026-01-01','UTC',ARRAY[8])`,
      "23514",
    ));
  it("rejects invalid timezone names", async () =>
    rejected(
      (tx, { user }) =>
        tx.$executeRaw`UPDATE "User" SET timezone='Mars/Olympus' WHERE id=${user.id}::uuid`,
      "23514",
    ));
  it("enforces reward ownership at redemption", async () =>
    rejected(async (tx, { user }) => {
      const other = await tx.user.create({
        data: { email: `${randomUUID()}@example.test` },
      });
      const reward = await tx.reward.create({
        data: { userId: other.id, title: "Coffee", coinCost: 10 },
      });
      return tx.$executeRaw`INSERT INTO "RewardRedemption" (id,"userId","rewardId","coinCost","rewardTitle","idempotencyKey") VALUES (${randomUUID()}::uuid,${user.id}::uuid,${reward.id}::uuid,10,'Coffee',${randomUUID()})`;
    }, "23503"));
  it("enforces transaction ownership and positive completion awards", async () =>
    rejected(async (tx, { habit, schedule }) => {
      const other = await tx.user.create({
        data: { email: `${randomUUID()}@example.test` },
      });
      const completion = await tx.habitCompletion.create({
        data: {
          habitId: habit.id,
          scheduleVersionId: schedule.id,
          scheduledDate: new Date("2026-11-16"),
        },
      });
      return tx.$executeRaw`INSERT INTO "XpTransaction" (id,"userId","completionId",amount,reason,"idempotencyKey") VALUES (${randomUUID()}::uuid,${other.id}::uuid,${completion.id}::uuid,10,'completion',${randomUUID()})`;
    }, "23514"));
  it("enforces the redemption debit snapshot", async () =>
    rejected(async (tx, { user }) => {
      const reward = await tx.reward.create({
        data: { userId: user.id, title: "Coffee", coinCost: 10 },
      });
      const redemption = await tx.rewardRedemption.create({
        data: {
          userId: user.id,
          rewardId: reward.id,
          coinCost: 10,
          rewardTitle: "Coffee",
          idempotencyKey: randomUUID(),
        },
      });
      return tx.$executeRaw`INSERT INTO "CoinTransaction" (id,"userId","redemptionId",amount,reason,"idempotencyKey") VALUES (${randomUUID()}::uuid,${user.id}::uuid,${redemption.id}::uuid,-1,'redeem',${randomUUID()})`;
    }, "23514"));
  it("keeps ledgers append-only", async () =>
    rejected(async (tx, { user }) => {
      const ledger = await tx.coinTransaction.create({
        data: {
          userId: user.id,
          amount: 10,
          reason: "grant",
          idempotencyKey: randomUUID(),
        },
      });
      return tx.$executeRaw`UPDATE "CoinTransaction" SET amount=100 WHERE id=${ledger.id}::uuid`;
    }, "23514"));
  it("rejects invalid interval rule shapes", async () =>
    rejected(
      (tx, { habit }) =>
        tx.$executeRaw`INSERT INTO "HabitScheduleVersion" (id,"habitId","effectiveFrom",timezone,weekdays,kind,"intervalDays","anchorDate") VALUES (${randomUUID()}::uuid,${habit.id}::uuid,'2026-01-01','UTC',ARRAY[]::integer[],'INTERVAL',0,'2026-01-01')`,
      "23514",
    ));
  it("keeps recurrence rules immutable", async () =>
    rejected(
      (tx, { schedule }) =>
        tx.$executeRaw`UPDATE "HabitScheduleVersion" SET kind='DAILY',weekdays=ARRAY[1,2,3,4,5,6,7] WHERE id=${schedule.id}::uuid`,
      "23514",
    ));
  it("prevents undo of completions that already have ledger entries", async () =>
    rejected(async (tx, { user, habit, schedule }) => {
      const completion = await tx.habitCompletion.create({
        data: {
          habitId: habit.id,
          scheduleVersionId: schedule.id,
          scheduledDate: new Date("2026-11-16"),
        },
      });
      await tx.xpTransaction.create({
        data: {
          userId: user.id,
          completionId: completion.id,
          amount: 10,
          reason: "legacy completion",
          idempotencyKey: randomUUID(),
        },
      });
      return tx.$executeRaw`UPDATE "HabitCompletion" SET "undoneAt"=CURRENT_TIMESTAMP WHERE id=${completion.id}::uuid`;
    }, "23514"));
});
