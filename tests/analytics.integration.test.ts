import { afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../apps/api/src/app.js";
import {
  addDays,
  calendarDate,
  localDate,
} from "../apps/api/src/scheduling.js";
import { fixture, testDatabase, testUrl } from "./phase4-support.js";
const db = testDatabase();
afterAll(async () => {
  await db?.$disconnect();
});
async function record(habitId: string, dates: string[]) {
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
        completedAt: new Date(date + "T12:00:00Z"),
      },
    });
}
describe.skipIf(!testUrl)("PostgreSQL-backed analytics", () => {
  it("returns truthful empty ranges with no rate and zero account totals", async () => {
    const user = await fixture(db!);
    const result = await user.agent.get(
      "/api/analytics?from=2026-11-01&to=2026-11-16",
    );
    expect(result.status).toBe(200);
    expect(result.body.daily).toHaveLength(16);
    expect(result.body.overview).toMatchObject({
      completed: 0,
      scheduled: 0,
      assessed: 0,
      rate: null,
      xp: 0,
      level: 1,
      coinBalance: 0,
      achievementsUnlocked: 0,
    });
    expect(result.body.habits).toHaveLength(0);
  });
  it("aggregates scheduled weekday sessions and genuine rest days", async () => {
    const user = await fixture(db!, 0, "2026-11-01T17:00:00Z");
    const id = await user.habit({ kind: "WEEKDAYS", weekdays: [1, 3, 5] });
    await record(id, ["2026-11-02", "2026-11-04"]);
    user.setNow("2026-11-09T17:00:00Z");
    const r = await user.agent.get(
      "/api/analytics?from=2026-11-02&to=2026-11-08",
    );
    expect(r.status).toBe(200);
    expect(r.body.overview).toMatchObject({
      completed: 2,
      scheduled: 3,
      assessed: 3,
      rate: 66.67,
    });
    expect(r.body.weekly[0]).toMatchObject({
      period: "2026-11-02",
      completed: 2,
      assessed: 3,
      rate: 66.67,
    });
    expect(
      r.body.daily.find((d: { period: string }) => d.period === "2026-11-07")
        .scheduled,
    ).toBe(0);
    expect(r.body.habits[0].weekly[0].completed).toBe(2);
  });
  it("excludes pending today and reflects undo immediately in calendar, counts, and net XP", async () => {
    const user = await fixture(db!);
    const first = await user.habit();
    await user.habit();
    await user
      .mutate("post", `/api/habits/${first}/completions`)
      .send({ scheduledDate: "2026-11-16" });
    const before = await user.agent.get(
      "/api/analytics?from=2026-11-16&to=2026-11-16",
    );
    expect(before.body.overview).toMatchObject({
      completed: 1,
      scheduled: 2,
      assessed: 1,
      pending: 1,
      rate: 100,
      xp: 25,
      coinsEarned: 10,
    });
    expect(before.body.daily[0].xp).toBe(25);
    await user.mutate("delete", `/api/habits/${first}/completions/2026-11-16`);
    const after = await user.agent.get(
      "/api/analytics?from=2026-11-16&to=2026-11-16",
    );
    expect(after.body.overview).toMatchObject({
      completed: 0,
      assessed: 0,
      pending: 2,
      rate: null,
      xp: 0,
      coinsEarned: 0,
    });
    expect(after.body.daily[0].xp).toBe(0);
    const detail = await user.agent.get(
      `/api/analytics/habits/${first}?from=2026-11-16&to=2026-11-16`,
    );
    expect(detail.body.history[0].completed).toBe(false);
  });
  it("respects interval anchors and historical recurrence edits", async () => {
    const user = await fixture(db!, 0, "2026-11-01T17:00:00Z");
    const id = await user.habit({
      kind: "INTERVAL",
      intervalDays: 2,
      anchorDate: "2026-11-02",
    });
    user.setNow("2026-11-04T17:00:00Z");
    expect(
      (
        await user
          .mutate("patch", `/api/habits/${id}`)
          .send({ schedule: { kind: "DAILY" } })
      ).status,
    ).toBe(200);
    user.setNow("2026-11-09T17:00:00Z");
    const r = await user.agent.get(
      "/api/analytics?from=2026-11-01&to=2026-11-08",
    );
    expect(r.body.overview.scheduled).toBe(6);
    expect(r.body.daily.map((d: { scheduled: number }) => d.scheduled)).toEqual(
      [0, 1, 0, 1, 1, 1, 1, 1],
    );
  });
  it("retains archived data while skipping recorded archive intervals", async () => {
    const user = await fixture(db!, 0, "2026-11-01T17:00:00Z");
    const id = await user.habit();
    await record(id, ["2026-11-01", "2026-11-02"]);
    user.setNow("2026-11-03T17:00:00Z");
    await user.mutate("delete", `/api/habits/${id}`);
    user.setNow("2026-11-10T17:00:00Z");
    const r = await user.agent.get(
      "/api/analytics?from=2026-11-01&to=2026-11-09",
    );
    expect(r.body.habits[0]).toMatchObject({
      archived: true,
      scheduled: 2,
      completed: 2,
      rate: 100,
      currentStreak: 2,
      longestStreak: 2,
    });
    expect(r.body.overview.lifetimeCompletions).toBe(2);
  });
  it("groups ledger activity by the configured timezone across spring DST", async () => {
    const user = await fixture(
      db!,
      0,
      "2026-03-09T18:00:00Z",
      "America/New_York",
    );
    for (const [time, amount] of [
      ["2026-03-08T04:59:00Z", 1],
      ["2026-03-08T05:00:00Z", 2],
      ["2026-03-09T03:59:00Z", 4],
      ["2026-03-09T04:00:00Z", 8],
    ] as const)
      await db!.xpTransaction.create({
        data: {
          userId: user.id,
          amount,
          reason: "DST boundary fixture",
          idempotencyKey: crypto.randomUUID(),
          createdAt: new Date(time),
        },
      });
    const r = await user.agent.get(
      "/api/analytics?from=2026-03-08&to=2026-03-08",
    );
    expect(r.body.daily[0].xp).toBe(6);
    expect(r.body.overview.xp).toBe(15);
    expect(r.body.timezone).toBe("America/New_York");
  });
  it("handles the repeated fall-back hour and midnight edges without duplicate grouping", async () => {
    const user = await fixture(
      db!,
      0,
      "2026-11-02T18:00:00Z",
      "America/New_York",
    );
    for (const time of ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"])
      await db!.xpTransaction.create({
        data: {
          userId: user.id,
          amount: 10,
          reason: "Fall DST fixture",
          idempotencyKey: crypto.randomUUID(),
          createdAt: new Date(time),
        },
      });
    const r = await user.agent.get(
      "/api/analytics?from=2026-11-01&to=2026-11-01",
    );
    expect(r.body.daily).toHaveLength(1);
    expect(r.body.daily[0].xp).toBe(20);
  });
  it("uses the account local date at timezone boundaries", async () => {
    const user = await fixture(
      db!,
      0,
      "2026-11-16T01:00:00Z",
      "America/Los_Angeles",
    );
    const id = await user.habit();
    expect(
      (
        await user
          .mutate("post", `/api/habits/${id}/completions`)
          .send({ scheduledDate: "2026-11-15" })
      ).status,
    ).toBe(200);
    const r = await user.agent.get(
      "/api/analytics?from=2026-11-15&to=2026-11-15",
    );
    expect(r.body.today).toBe("2026-11-15");
    expect(r.body.daily[0].completed).toBe(1);
    expect(r.body.daily[0].xp).toBe(25);
  });
  it("counts protected misses as scheduled, never as completions", async () => {
    const today = localDate(new Date(), "UTC");
    const user = await fixture(db!, 0, today + "T12:00:00Z");
    const id = await user.habit();
    user.setNow(addDays(today, 2) + "T12:00:00Z");
    expect(
      (
        await user
          .mutate("post", "/api/progression/freezes")
          .send({ habitId: id, scheduledDate: addDays(today, 1) })
      ).status,
    ).toBe(200);
    const r = await user.agent.get(
      `/api/analytics?from=${today}&to=${addDays(today, 1)}`,
    );
    expect(r.body.overview).toMatchObject({
      completed: 0,
      scheduled: 2,
      assessed: 2,
      frozen: 1,
      rate: 0,
    });
    const day = await user.agent.get(
      `/api/analytics/days/${addDays(today, 1)}`,
    );
    expect(day.body.sessions[0].status).toBe("FROZEN");
  });
  it("reconciles earned, gross spent, refunded, adjustment, and available coins against the ledger", async () => {
    const user = await fixture(db!, 100);
    const id = await user.habit();
    await user
      .mutate("post", `/api/habits/${id}/completions`)
      .send({ scheduledDate: "2026-11-16" });
    const reward = await user.reward(25);
    const first = await user.buy(reward.id, 25);
    await user.buy(reward.id, 25);
    await user.mutate(
      "post",
      `/api/redemptions/${first.body.redemption.id}/cancel`,
    );
    const r = await user.agent.get(
      "/api/analytics?from=2026-11-16&to=2026-11-16",
    );
    expect(r.body.overview).toMatchObject({
      coinsEarned: 10,
      coinsSpent: 50,
      coinsRefunded: 25,
      coinAdjustments: 100,
      coinBalance: 85,
      xp: 25,
      level: 1,
      achievementsUnlocked: 1,
    });
  });
  it("isolates every analytics view and rejects invalid ranges or foreign habit IDs", async () => {
    expect((await request(createApp()).get("/api/analytics")).status).toBe(401);
    const owner = await fixture(db!);
    const other = await fixture(db!);
    const id = await owner.habit();
    await owner
      .mutate("post", `/api/habits/${id}/completions`)
      .send({ scheduledDate: "2026-11-16" });
    expect((await other.agent.get(`/api/analytics/habits/${id}`)).status).toBe(
      404,
    );
    for (const path of ["/api/analytics", "/api/analytics/overview"]) {
      const r = await other.agent.get(path);
      expect(r.body.overview.completed).toBe(0);
    }
    expect(
      (await other.agent.get("/api/analytics/heatmap")).body.daily.every(
        (d: { completed: number }) => d.completed === 0,
      ),
    ).toBe(true);
    expect(
      (await other.agent.get("/api/analytics/days/2026-11-16")).body.sessions,
    ).toHaveLength(0);
    expect(
      (await owner.agent.get("/api/analytics?from=2020-01-01&to=2026-11-16"))
        .status,
    ).toBe(400);
    expect((await owner.agent.get("/api/analytics?to=2026-11-17")).status).toBe(
      400,
    );
  });
});
