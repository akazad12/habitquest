import { randomUUID } from "node:crypto";
import { afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { createApp } from "../apps/api/src/app.js";
import {
  addDays,
  calendarDate,
  localDate,
} from "../apps/api/src/scheduling.js";
import { completionReward } from "../apps/api/src/progression/engine.js";
const url = process.env.TEST_DATABASE_URL;
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const today = localDate(new Date(), "UTC");
const origin = "http://localhost:5173";
afterAll(async () => {
  await db?.$disconnect();
});
async function member(start = today) {
  let date = start;
  const now = () => new Date(`${date}T12:00:00Z`);
  const app = createApp(origin, {
    database: () => db!,
    now,
    sessionDays: 365,
    authLimit: 1000,
  });
  const agent = request.agent(app);
  const response = await agent
    .post("/api/auth/register")
    .set("Origin", origin)
    .send({
      email: `${randomUUID()}@example.test`,
      displayName: "Progression Tester",
      password: "a long progression test password",
      timezone: "UTC",
    });
  expect(response.status).toBe(201);
  const userId = response.body.user.id as string;
  const csrf = response.body.csrfToken as string;
  const mutate = (method: "post" | "patch" | "delete", path: string) =>
    agent[method](path).set("Origin", origin).set("X-CSRF-Token", csrf);
  const create = async (
    difficulty = "MEDIUM",
    schedule: unknown = { kind: "DAILY" },
  ) => {
    const result = await mutate("post", "/api/habits").send({
      title: "Daily practice",
      difficulty,
      schedule,
    });
    expect(result.status).toBe(201);
    return result.body.habit.id as string;
  };
  const complete = (id: string, target = date) =>
    mutate("post", `/api/habits/${id}/completions`).send({
      scheduledDate: target,
    });
  const undo = (id: string, target = date) =>
    mutate("delete", `/api/habits/${id}/completions/${target}`).set(
      "Prefer",
      "return=representation",
    );
  const game = async () => {
    const result = await agent.get("/api/progression");
    expect(result.status).toBe(200);
    return result.body;
  };
  return {
    app,
    agent,
    userId,
    mutate,
    create,
    complete,
    undo,
    game,
    setDate: (next: string) => {
      date = next;
    },
    date: () => date,
  };
}
async function historical(habitId: string, dates: string[]) {
  const schedule = await db!.habitScheduleVersion.findFirstOrThrow({
    where: { habitId },
    orderBy: { effectiveFrom: "asc" },
  });
  for (const date of dates)
    await db!.habitCompletion.create({
      data: {
        habitId,
        scheduleVersionId: schedule.id,
        scheduledDate: calendarDate(date),
        timezone: "UTC",
        completedAt: new Date(`${date}T12:00:00Z`),
      },
    });
}
describe.skipIf(!url)("atomic PostgreSQL gamification", () => {
  it("starts with real zero balances, level one, one freeze, and locked achievements", async () => {
    const user = await member();
    const game = await user.game();
    expect(game).toMatchObject({
      xp: 0,
      coins: 0,
      level: 1,
      xpIntoLevel: 0,
      xpForNextLevel: 100,
      freezes: { available: 1, maximum: 2, used: 0 },
    });
    expect(game.achievements).toHaveLength(5);
    expect(
      game.achievements.every(
        (a: { unlockedAt: unknown }) => a.unlockedAt === null,
      ),
    ).toBe(true);
    expect(
      await db!.streakFreeze.count({
        where: { userId: user.userId, source: "INITIAL" },
      }),
    ).toBe(1);
  });
  it.each([
    ["EASY", 15, 5],
    ["MEDIUM", 25, 10],
    ["HARD", 40, 15],
  ] as const)(
    "atomically awards %s completion",
    async (difficulty, xp, coins) => {
      const user = await member();
      const id = await user.create(difficulty);
      const result = await user.complete(id);
      expect(result.status).toBe(200);
      expect(result.body.reward).toMatchObject({
        changed: true,
        xp,
        coins,
        baseXp: xp,
        bonusPercent: 0,
        streak: 1,
      });
      expect(result.body.progression).toMatchObject({ xp, coins });
      expect(result.body.reward.newAchievements).toContain("first-step");
      const reward = await db!.completionReward.findUniqueOrThrow({
        where: { completionId: result.body.completion.id },
        include: {
          events: { include: { xpTransaction: true, coinTransaction: true } },
        },
      });
      expect(reward).toMatchObject({ active: true, revision: 1, xp, coins });
      expect(reward.events[0]!.xpTransaction!.amount).toBe(xp);
      expect(reward.events[0]!.coinTransaction!.amount).toBe(coins);
    },
  );
  it("deduplicates concurrent awards and returns a zero-delta receipt on retries", async () => {
    const user = await member();
    const id = await user.create("HARD");
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => user.complete(id)),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(responses.filter((r) => r.body.reward.changed)).toHaveLength(1);
    expect(new Set(responses.map((r) => r.body.completion.id)).size).toBe(1);
    expect(
      await db!.completionRewardEvent.count({
        where: { reward: { completion: { habitId: id } } },
      }),
    ).toBe(1);
    expect(await user.game()).toMatchObject({ xp: 40, coins: 15 });
  });
  it("reverses atomically, deduplicates undo, and restores the immutable original snapshot after difficulty changes", async () => {
    const user = await member();
    const id = await user.create("EASY");
    const first = await user.complete(id);
    const undone = await user.undo(id);
    expect(undone.status).toBe(200);
    expect(undone.body.reward).toMatchObject({
      changed: true,
      xp: -15,
      coins: -5,
    });
    expect(undone.body.progression).toMatchObject({ xp: 0, coins: 0 });
    expect((await user.undo(id)).body.reward.changed).toBe(false);
    expect(
      (
        await user
          .mutate("patch", `/api/habits/${id}`)
          .send({ difficulty: "HARD" })
      ).status,
    ).toBe(200);
    const restored = await user.complete(id);
    expect(restored.body.reward).toMatchObject({
      restored: true,
      xp: 15,
      coins: 5,
    });
    expect(restored.body.completion.id).toBe(first.body.completion.id);
    expect(await user.game()).toMatchObject({ xp: 15, coins: 5 });
    const events = await db!.completionRewardEvent.findMany({
      where: { reward: { completionId: first.body.completion.id } },
      orderBy: { revision: "asc" },
    });
    expect(events.map((e) => e.direction)).toEqual([1, -1, 1]);
    expect(
      restored.body.progression.achievements.find(
        (a: { key: string }) => a.key === "first-step",
      ).unlockedAt,
    ).not.toBeNull();
  });
  it("rolls back completion, XP, coins, and achievements when the second ledger insert fails", async () => {
    const user = await member();
    const id = await user.create();
    // Inject a coin-writer failure after XP has been inserted into the real PostgreSQL transaction.
    const broken = db!.$extends({
      query: {
        coinTransaction: {
          async create() {
            throw new Error("Injected coin write failure");
          },
        },
      },
    }) as unknown as PrismaClient;
    const app = createApp(origin, {
      database: () => broken,
      now: () => new Date(`${today}T12:00:00Z`),
    });
    const session = await user.agent.get("/api/auth/me");
    const authCookie = (
      await user.agent.post("/api/auth/login").set("Origin", origin).send({
        email: session.body.user.email,
        password: "a long progression test password",
      })
    ).headers["set-cookie"]![0]!.split(";")[0]!;
    const auth = await request(app)
      .get("/api/auth/me")
      .set("Cookie", authCookie);
    const failed = await request(app)
      .post(`/api/habits/${id}/completions`)
      .set("Cookie", authCookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", auth.body.csrfToken)
      .send({ scheduledDate: today });
    expect(failed.status).toBe(500);
    expect(await db!.habitCompletion.count({ where: { habitId: id } })).toBe(0);
    expect(
      await db!.completionReward.count({
        where: { completion: { habitId: id } },
      }),
    ).toBe(0);
    expect(await user.game()).toMatchObject({ xp: 0, coins: 0 });
    expect(
      await db!.userAchievement.count({ where: { userId: user.userId } }),
    ).toBe(0);
  });
  it("enforces commit-time consistency if a client omits the coin entry", async () => {
    const user = await member();
    const id = await user.create();
    const schedule = await db!.habitScheduleVersion.findFirstOrThrow({
      where: { habitId: id },
    });
    await expect(
      db!.$transaction(async (tx) => {
        const completion = await tx.habitCompletion.create({
          data: {
            habitId: id,
            scheduleVersionId: schedule.id,
            scheduledDate: calendarDate(today),
          },
        });
        const reward = await tx.completionReward.create({
          data: {
            completionId: completion.id,
            ...completionReward("MEDIUM", 1),
          },
        });
        const event = await tx.completionRewardEvent.create({
          data: { rewardId: reward.id, revision: 1, direction: 1 },
        });
        await tx.xpTransaction.create({
          data: {
            userId: user.userId,
            rewardEventId: event.id,
            amount: 25,
            reason: "partial attempt",
            idempotencyKey: randomUUID(),
          },
        });
        await tx.completionReward.update({
          where: { id: reward.id },
          data: { revision: 1, active: true },
        });
      }),
    ).rejects.toThrow();
    expect(await db!.habitCompletion.count({ where: { habitId: id } })).toBe(0);
    expect(await user.game()).toMatchObject({ xp: 0, coins: 0 });
  });
  it("rejects negative balances and rolls back undo if an audited adjustment has already removed the coins", async () => {
    const user = await member();
    const id = await user.create("EASY");
    await user.complete(id);
    await db!.coinTransaction.create({
      data: {
        userId: user.userId,
        amount: -5,
        reason: "test adjustment",
        idempotencyKey: randomUUID(),
      },
    });
    expect((await user.undo(id)).status).toBe(409);
    expect((await user.game()).xp).toBe(15);
    expect(
      (await db!.habitCompletion.findFirstOrThrow({ where: { habitId: id } }))
        .undoneAt,
    ).toBeNull();
    await expect(
      db!.coinTransaction.create({
        data: {
          userId: user.userId,
          amount: -1,
          reason: "overspend",
          idempotencyKey: randomUUID(),
        },
      }),
    ).rejects.toThrow();
    expect((await user.game()).coins).toBe(0);
  });
  it("applies and rounds the 7- and 30-session bonuses from actual records", async () => {
    for (const [count, bonus, xp] of [
      [6, 10, 27],
      [29, 25, 31],
    ]) {
      const start = addDays(today, -count!);
      const user = await member(start);
      const id = await user.create();
      await historical(
        id,
        Array.from({ length: count! }, (_, i) => addDays(start, i)),
      );
      user.setDate(today);
      const result = await user.complete(id);
      expect(result.status).toBe(200);
      expect(result.body.reward).toMatchObject({
        bonusPercent: bonus,
        xp,
        streak: count! + 1,
        milestone: count! + 1,
      });
      expect(
        result.body.progression.achievements.find(
          (a: { key: string }) =>
            a.key === (count === 6 ? "consistency" : "dedicated"),
        ).unlockedAt,
      ).not.toBeNull();
    }
  });
  it("crosses level thresholds using ledger XP and reverses level progress on undo", async () => {
    const user = await member();
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const id = await user.create("HARD");
      ids.push(id);
      await user.complete(id);
    }
    expect(await user.game()).toMatchObject({
      xp: 120,
      level: 2,
      xpIntoLevel: 20,
      xpForNextLevel: 150,
    });
    const result = await user.undo(ids[2]!);
    expect(result.body.progression).toMatchObject({
      xp: 80,
      level: 1,
      xpIntoLevel: 80,
    });
  });
  it("consumes one freeze for a missed day without rewards, with idempotency and permanent audit", async () => {
    const user = await member();
    const id = await user.create();
    await user.complete(id);
    user.setDate(addDays(today, 2));
    await user.complete(id);
    const before = await user.game();
    expect(before.habits[0].current).toBe(1);
    expect(before.freezeCandidates).toContainEqual({
      habitId: id,
      title: "Daily practice",
      date: addDays(today, 1),
    });
    const freeze = await user
      .mutate("post", "/api/progression/freezes")
      .send({ habitId: id, scheduledDate: addDays(today, 1) });
    expect(freeze.status).toBe(200);
    expect(freeze.body).toMatchObject({
      changed: true,
      progression: { xp: 50, coins: 20, freezes: { available: 0, used: 1 } },
    });
    expect(freeze.body.progression.habits[0]).toMatchObject({
      current: 2,
      longest: 2,
    });
    const repeat = await user
      .mutate("post", "/api/progression/freezes")
      .send({ habitId: id, scheduledDate: addDays(today, 1) });
    expect(repeat.status).toBe(200);
    expect(repeat.body.changed).toBe(false);
    expect(await db!.streakFreezeUse.count({ where: { habitId: id } })).toBe(1);
    expect(await db!.habitCompletion.count({ where: { habitId: id } })).toBe(2);
    const use = await db!.streakFreezeUse.findFirstOrThrow({
      where: { habitId: id },
    });
    await expect(
      db!.streakFreezeUse.delete({ where: { freezeId: use.freezeId } }),
    ).rejects.toThrow();
  });
  it("does not freeze rest days, today, pre-grant dates, or dates outside the delayed window", async () => {
    const user = await member(addDays(today, -10));
    const id = await user.create("MEDIUM", {
      kind: "INTERVAL",
      intervalDays: 2,
      anchorDate: addDays(today, -10),
    });
    user.setDate(addDays(today, 8));
    for (const date of [
      addDays(today, 8),
      addDays(today, -1),
      today,
      addDays(today, 3),
    ])
      expect(
        (
          await user
            .mutate("post", "/api/progression/freezes")
            .send({ habitId: id, scheduledDate: date })
        ).status,
      ).toBe(409);
  });
  it("serializes competing freeze uses and prevents reuse and over-cap grants", async () => {
    const user = await member();
    const first = await user.create();
    const second = await user.create();
    user.setDate(addDays(today, 2));
    const results = await Promise.all(
      [first, second].map((habitId) =>
        user
          .mutate("post", "/api/progression/freezes")
          .send({ habitId, scheduledDate: addDays(today, 1) }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await user.game()).freezes.available).toBe(0);
    for (const source of ["TEST_GRANT_1", "TEST_GRANT_2"])
      await db!.streakFreeze.create({
        data: {
          userId: user.userId,
          source,
          grantedDate: calendarDate(today),
          timezone: "UTC",
        },
      });
    await expect(
      db!.streakFreeze.create({
        data: {
          userId: user.userId,
          source: "TEST_GRANT_3",
          grantedDate: calendarDate(today),
          timezone: "UTC",
        },
      }),
    ).rejects.toThrow();
    expect((await user.game()).freezes.available).toBe(2);
  });
  it("keeps frozen dates protected when timezone changes make the saved date today again", async () => {
    const user = await member();
    const id = await user.create();
    user.setDate(addDays(today, 1));
    expect(
      (
        await user
          .mutate("post", "/api/progression/freezes")
          .send({ habitId: id, scheduledDate: today })
      ).status,
    ).toBe(200);
    // Move the trusted request clock backward to simulate a date-line timezone return.
    user.setDate(today);
    expect((await user.complete(id)).status).toBe(409);
    expect(await user.game()).toMatchObject({ xp: 0, coins: 0 });
  });
  it("preserves archived streak history across delayed evaluation and reactivation", async () => {
    const user = await member();
    const id = await user.create();
    await user.complete(id);
    expect((await user.mutate("delete", `/api/habits/${id}`)).status).toBe(204);
    user.setDate(addDays(today, 5));
    expect((await user.game()).habits[0]).toMatchObject({
      current: 1,
      longest: 1,
      archived: true,
    });
    expect(
      (
        await user
          .mutate("patch", `/api/habits/${id}`)
          .send({ archived: false })
      ).status,
    ).toBe(200);
    await user.complete(id);
    expect((await user.game()).habits[0]).toMatchObject({
      current: 2,
      longest: 2,
      archived: false,
    });
  });
  // This end-to-end achievement case seeds 99 PostgreSQL rows and exercises
  // multiple HTTP transactions; allow slower CI I/O without relaxing other tests.
  it("unlocks Habit Builder and Century Club only from actual records, and keeps badges after undo", async () => {
    const start = addDays(today, -99);
    const user = await member(start);
    const id = await user.create();
    await historical(
      id,
      Array.from({ length: 99 }, (_, i) => addDays(start, i)),
    );
    user.setDate(today);
    await user.complete(id);
    for (let i = 0; i < 4; i++) await user.create();
    const game = await user.game();
    expect(
      game.achievements.filter(
        (a: { unlockedAt: string | null }) => a.unlockedAt,
      ),
    ).toHaveLength(5);
    await user.undo(id);
    expect(
      (await user.game()).achievements.filter(
        (a: { unlockedAt: string | null }) => a.unlockedAt,
      ),
    ).toHaveLength(5);
    await user.mutate("post", "/api/progression/reconcile").send({});
    expect(
      await db!.userAchievement.count({ where: { userId: user.userId } }),
    ).toBe(5);
  }, 15_000);
  it("does not retroactively award Phase 2 active completions through retry or reconcile", async () => {
    const user = await member();
    const id = await user.create();
    await historical(id, [today]);
    expect((await user.complete(id)).body.reward).toMatchObject({
      changed: false,
      xp: 0,
      coins: 0,
    });
    await user.mutate("post", "/api/progression/reconcile").send({});
    expect(await user.game()).toMatchObject({ xp: 0, coins: 0 });
    await user.undo(id);
    expect((await user.complete(id)).body.reward).toMatchObject({
      xp: 25,
      coins: 10,
    });
  });
  it("requires authentication and isolates progression, completions, and freeze targets", async () => {
    expect((await request(createApp()).get("/api/progression")).status).toBe(
      401,
    );
    const owner = await member();
    const other = await member();
    const id = await owner.create();
    await owner.complete(id);
    expect(await other.game()).toMatchObject({ xp: 0, coins: 0 });
    expect((await other.complete(id)).status).toBe(404);
    expect((await other.undo(id)).status).toBe(404);
    expect(
      (
        await other
          .mutate("post", "/api/progression/freezes")
          .send({ habitId: id, scheduledDate: today })
      ).status,
    ).toBe(404);
  });
  it("serializes concurrent undo and restore cycles without changing net awards", async () => {
    const user = await member();
    const id = await user.create("HARD");
    await user.complete(id);
    const undos = await Promise.all(
      Array.from({ length: 4 }, () => user.undo(id)),
    );
    expect(undos.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(undos.filter((r) => r.body.reward.changed)).toHaveLength(1);
    expect(await user.game()).toMatchObject({ xp: 0, coins: 0 });
    const restores = await Promise.all(
      Array.from({ length: 4 }, () => user.complete(id)),
    );
    expect(restores.filter((r) => r.body.reward.changed)).toHaveLength(1);
    expect(await user.game()).toMatchObject({ xp: 40, coins: 15 });
    expect(
      await db!.completionRewardEvent.count({
        where: { reward: { completion: { habitId: id } } },
      }),
    ).toBe(3);
  });
  it("rejects concurrent overspending at the database boundary", async () => {
    const user = await member();
    await db!.coinTransaction.create({
      data: {
        userId: user.userId,
        amount: 10,
        reason: "test credit",
        idempotencyKey: randomUUID(),
      },
    });
    const attempts = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        db!.coinTransaction.create({
          data: {
            userId: user.userId,
            amount: -7,
            reason: "test debit",
            idempotencyKey: randomUUID(),
          },
        }),
      ),
    );
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await user.game()).coins).toBe(3);
  });
  it("prevents direct completion-state changes without a matching reversal transaction", async () => {
    const user = await member();
    const id = await user.create();
    const result = await user.complete(id);
    await expect(
      db!.habitCompletion.update({
        where: { id: result.body.completion.id },
        data: { undoneAt: new Date() },
      }),
    ).rejects.toThrow();
    expect(await user.game()).toMatchObject({ xp: 25, coins: 10 });
  });
  it("rejects client reward amounts and preserves later-date history after a timezone-style date return", async () => {
    const user = await member();
    const id = await user.create();
    expect(
      (
        await user
          .mutate("post", `/api/habits/${id}/completions`)
          .send({ scheduledDate: today, xp: 999 })
      ).status,
    ).toBe(400);
    user.setDate(addDays(today, 1));
    expect((await user.complete(id)).status).toBe(200);
    user.setDate(today);
    expect(
      (
        await user
          .mutate("patch", `/api/habits/${id}`)
          .send({ schedule: { kind: "WEEKDAYS", weekdays: [1] } })
      ).status,
    ).toBe(409);
    expect(
      await db!.habitScheduleVersion.count({ where: { habitId: id } }),
    ).toBe(1);
  });
});
