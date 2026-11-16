import { randomUUID } from "node:crypto";
import { afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import * as argon2 from "argon2";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { createApp } from "../apps/api/src/app.js";
const url = process.env.TEST_DATABASE_URL;
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const origin = "http://localhost:5173";
const instant = new Date("2026-11-16T17:00:00Z");
const password = "correct horse habit battery";
const app = () =>
  createApp(origin, {
    database: () => db!,
    now: () => instant,
    authLimit: 1000,
  });
afterAll(async () => {
  await db?.$disconnect();
});
async function account(timezone = "America/New_York") {
  const server = app();
  const agent = request.agent(server);
  const email = `${randomUUID()}@example.test`;
  const response = await agent
    .post("/api/auth/register")
    .set("Origin", origin)
    .send({ email, displayName: "Habit Reader", password, timezone });
  expect(response.status).toBe(201);
  const csrf = response.body.csrfToken as string;
  const user = response.body.user;
  const cookie = response.headers["set-cookie"]![0]!.split(";")[0]!;
  const mutate = (method: "post" | "patch" | "delete", path: string) =>
    agent[method](path).set("Origin", origin).set("X-CSRF-Token", csrf);
  return { agent, email, csrf, user, cookie, mutate };
}
async function habitFor(
  member: Awaited<ReturnType<typeof account>>,
  schedule: unknown = { kind: "DAILY" },
) {
  const response = await member.mutate("post", "/api/habits").send({
    title: "Read ten pages",
    category: "Learning",
    difficulty: "HARD",
    schedule,
  });
  expect(response.status).toBe(201);
  return response.body.habit;
}
describe.skipIf(!url)("Phase 2 HTTP integration", () => {
  it("registers normalized email, hashes passwords with Argon2id, and persists an opaque session", async () => {
    const member = await account();
    const user = await db!.user.findUniqueOrThrow({
      where: { id: member.user.id },
    });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toBe(password);
    expect(await argon2.verify(user.passwordHash!, password)).toBe(true);
    const session = await db!.session.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(member.cookie).not.toContain(session.tokenHash);
    const response = await request(app())
      .get("/api/auth/me")
      .set("Cookie", member.cookie);
    expect(response.status).toBe(200);
    expect(response.body.user).toEqual(member.user);
    expect(response.body.user.passwordHash).toBeUndefined();
    expect(response.body.user.sessions).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("sets HttpOnly and SameSite cookies and Secure in production", async () => {
    const response = await request(
      createApp(origin, {
        database: () => db!,
        production: true,
        now: () => instant,
      }),
    )
      .post("/api/auth/register")
      .set("Origin", origin)
      .send({
        email: `${randomUUID()}@example.test`,
        displayName: "Reader",
        password,
        timezone: "UTC",
      });
    expect(response.status).toBe(201);
    expect(response.headers["set-cookie"]![0]).toContain("__Host-habitquest=");
    expect(response.headers["set-cookie"]![0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]![0]).toContain("Secure");
    expect(response.headers["set-cookie"]![0]).toContain("SameSite=Lax");
    expect(response.headers["set-cookie"]![0]).not.toContain("Domain=");
  });
  it("validates registration and rejects duplicate normalized emails", async () => {
    const member = await account();
    const response = await member.agent
      .post("/api/auth/register")
      .set("Origin", origin)
      .send({
        email: member.email.toUpperCase(),
        displayName: "Reader",
        password,
        timezone: "UTC",
      });
    expect(response.status).toBe(409);
    const weak = await request(app())
      .post("/api/auth/register")
      .set("Origin", origin)
      .send({
        email: "weak@example.test",
        displayName: "Reader",
        password: "short",
        timezone: "Mars",
      });
    expect(weak.status).toBe(400);
  });
  it("logs in, rotates the current session, rejects bad credentials, and invalidates logout", async () => {
    const member = await account();
    const oldCookie = member.cookie;
    const bad = await member.agent
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: member.email, password: "not the password" });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("INVALID_CREDENTIALS");
    const login = await member.agent
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: member.email, password });
    expect(login.status).toBe(200);
    expect(
      (await request(app()).get("/api/auth/me").set("Cookie", oldCookie))
        .status,
    ).toBe(401);
    const cookie = login.headers["set-cookie"]![0]!.split(";")[0]!;
    const logout = await member.agent
      .post("/api/auth/logout")
      .set("Origin", origin)
      .set("X-CSRF-Token", login.body.csrfToken);
    expect(logout.status).toBe(204);
    expect(
      (await request(app()).get("/api/auth/me").set("Cookie", cookie)).status,
    ).toBe(401);
  });
  it("expires persisted sessions and rejects malformed cookies", async () => {
    const member = await account();
    const later = createApp(origin, {
      database: () => db!,
      now: () => new Date("2026-11-24T17:00:00Z"),
    });
    expect(
      (await request(later).get("/api/auth/me").set("Cookie", member.cookie))
        .status,
    ).toBe(401);
    expect(await db!.session.count({ where: { userId: member.user.id } })).toBe(
      0,
    );
    expect(
      (
        await request(app())
          .get("/api/auth/me")
          .set("Cookie", "habitquest=garbage")
      ).status,
    ).toBe(401);
  });
  it("protects unauthenticated endpoints and enforces Origin plus CSRF tokens", async () => {
    expect((await request(app()).get("/api/habits")).status).toBe(401);
    const member = await account();
    const body = { title: "Read", schedule: { kind: "DAILY" } };
    expect(
      (
        await member.agent
          .post("/api/habits")
          .set("Origin", "https://attacker.example")
          .set("X-CSRF-Token", member.csrf)
          .send(body)
      ).status,
    ).toBe(403);
    expect(
      (
        await member.agent
          .post("/api/habits")
          .set("X-CSRF-Token", member.csrf)
          .send(body)
      ).status,
    ).toBe(403);
    expect(
      (await member.agent.post("/api/habits").set("Origin", origin).send(body))
        .status,
    ).toBe(403);
    expect(
      (
        await member.agent
          .post("/api/habits")
          .set("Origin", origin)
          .set("X-CSRF-Token", "ü".repeat(64))
          .send(body)
      ).status,
    ).toBe(403);
  });
  it("rate limits authentication attempts", async () => {
    const limited = request(createApp(origin, { authLimit: 2 }));
    for (let i = 0; i < 2; i++)
      expect(
        (await limited.post("/api/auth/login").set("Origin", origin).send({}))
          .status,
      ).toBe(400);
    const response = await limited
      .post("/api/auth/register")
      .set("Origin", origin)
      .send({});
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("RATE_LIMITED");
  });
  it("creates, edits, archives, and reactivates owned habits without losing metadata", async () => {
    const member = await account();
    const habit = await habitFor(member);
    expect(habit.category).toBe("Learning");
    expect(habit.createdAt).toBeTruthy();
    const edit = await member
      .mutate("patch", `/api/habits/${habit.id}`)
      .send({ title: "Read twenty pages" });
    expect(edit.status).toBe(200);
    expect(edit.body.habit.title).toBe("Read twenty pages");
    expect(edit.body.habit.category).toBe("Learning");
    expect(edit.body.habit.difficulty).toBe("HARD");
    expect(
      (await member.agent.get("/api/habits")).body.habits.some(
        (h: { id: string }) => h.id === habit.id,
      ),
    ).toBe(true);
    expect(
      (await member.mutate("delete", `/api/habits/${habit.id}`)).status,
    ).toBe(204);
    expect((await member.agent.get("/api/habits")).body.habits).toHaveLength(0);
    expect(
      (await member.agent.get("/api/habits?status=archived")).body.habits,
    ).toHaveLength(1);
    expect(
      (
        await member
          .mutate("post", `/api/habits/${habit.id}/completions`)
          .send({ scheduledDate: "2026-11-16" })
      ).status,
    ).toBe(409);
    expect(
      (
        await member
          .mutate("patch", `/api/habits/${habit.id}`)
          .send({ archived: false })
      ).status,
    ).toBe(200);
    expect((await member.agent.get("/api/habits/today")).body.total).toBe(1);
  });
  it("returns 404 for every cross-user habit access", async () => {
    const owner = await account();
    const other = await account();
    const habit = await habitFor(owner);
    for (const suffix of ["", "/completions"])
      expect(
        (await other.agent.get(`/api/habits/${habit.id}${suffix}`)).status,
      ).toBe(404);
    expect(
      (
        await other
          .mutate("patch", `/api/habits/${habit.id}`)
          .send({ title: "stolen" })
      ).status,
    ).toBe(404);
    expect(
      (await other.mutate("delete", `/api/habits/${habit.id}`)).status,
    ).toBe(404);
    expect(
      (
        await other
          .mutate("post", `/api/habits/${habit.id}/completions`)
          .send({ scheduledDate: "2026-11-16" })
      ).status,
    ).toBe(404);
    expect(
      (
        await other.mutate(
          "delete",
          `/api/habits/${habit.id}/completions/2026-11-16`,
        )
      ).status,
    ).toBe(404);
  });
  it("rejects spoofed ownership, unsupported difficulty, and invalid recurrence", async () => {
    const member = await account();
    for (const body of [
      { title: "Read", schedule: { kind: "DAILY" }, userId: randomUUID() },
      { title: "Read", difficulty: "IMPOSSIBLE", schedule: { kind: "DAILY" } },
      { title: "Read", schedule: { kind: "WEEKDAYS", weekdays: [] } },
    ])
      expect(
        (await member.mutate("post", "/api/habits").send(body)).status,
      ).toBe(400);
  });
  it("persists a completion through new app instances, deduplicates concurrent requests, and supports idempotent undo/recomplete", async () => {
    const member = await account();
    const habit = await habitFor(member);
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app())
          .post(`/api/habits/${habit.id}/completions`)
          .set("Cookie", member.cookie)
          .set("Origin", origin)
          .set("X-CSRF-Token", member.csrf)
          .send({ scheduledDate: "2026-11-16" }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(responses.map((r) => r.body.completion.id)).size).toBe(1);
    expect(
      await db!.habitCompletion.count({ where: { habitId: habit.id } }),
    ).toBe(1);
    const today = await request(app())
      .get("/api/habits/today")
      .set("Cookie", member.cookie);
    expect(today.body).toMatchObject({
      completed: 1,
      total: 1,
      percentage: 100,
    });
    expect(today.body.habits[0].completed).toBe(true);
    for (let i = 0; i < 2; i++)
      expect(
        (
          await member.mutate(
            "delete",
            `/api/habits/${habit.id}/completions/2026-11-16`,
          )
        ).status,
      ).toBe(204);
    expect((await member.agent.get("/api/habits/today")).body.completed).toBe(
      0,
    );
    const history = await member.agent.get(
      `/api/habits/${habit.id}/completions`,
    );
    expect(history.body.completions[0].undoneAt).not.toBeNull();
    const again = await member
      .mutate("post", `/api/habits/${habit.id}/completions`)
      .send({ scheduledDate: "2026-11-16" });
    expect(again.body.completion.id).toBe(responses[0]!.body.completion.id);
    const managed = await db!.completionReward.findUniqueOrThrow({
      where: { completionId: again.body.completion.id },
    });
    expect(managed).toMatchObject({
      xp: 40,
      coins: 15,
      active: true,
      revision: 3,
    });
    const ledgerXp = await db!.xpTransaction.aggregate({
      where: { rewardEvent: { rewardId: managed.id } },
      _sum: { amount: true },
    });
    const ledgerCoins = await db!.coinTransaction.aggregate({
      where: { rewardEvent: { rewardId: managed.id } },
      _sum: { amount: true },
    });
    expect(ledgerXp._sum.amount).toBe(40);
    expect(ledgerCoins._sum.amount).toBe(15);
  });
  it("rejects past, future, and unscheduled completions and past undo", async () => {
    const member = await account();
    const habit = await habitFor(member, { kind: "WEEKDAYS", weekdays: [2] });
    for (const date of ["2026-11-15", "2026-11-16", "2026-11-17"])
      expect(
        (
          await member
            .mutate("post", `/api/habits/${habit.id}/completions`)
            .send({ scheduledDate: date })
        ).status,
      ).toBe(409);
    expect(
      (
        await member.mutate(
          "delete",
          `/api/habits/${habit.id}/completions/2026-11-15`,
        )
      ).status,
    ).toBe(409);
    expect((await member.agent.get("/api/habits/today")).body.total).toBe(0);
  });
  it("supports interval schedules, including ineligible anchors in the future", async () => {
    const member = await account();
    const eligible = await habitFor(member, {
      kind: "INTERVAL",
      intervalDays: 2,
      anchorDate: "2026-11-14",
    });
    await habitFor(member, {
      kind: "INTERVAL",
      intervalDays: 2,
      anchorDate: "2026-11-17",
    });
    const today = await member.agent.get("/api/habits/today");
    expect(today.body.habits.map((h: { id: string }) => h.id)).toEqual([
      eligible.id,
    ]);
    expect(
      (
        await member
          .mutate("post", `/api/habits/${eligible.id}/completions`)
          .send({ scheduledDate: "2026-11-16" })
      ).status,
    ).toBe(200);
  });
  it("preserves recorded versions and today when schedules are edited, and replaces unstarted edits safely", async () => {
    const member = await account();
    const habit = await habitFor(member);
    await member
      .mutate("post", `/api/habits/${habit.id}/completions`)
      .send({ scheduledDate: "2026-11-16" });
    const edit = await member
      .mutate("patch", `/api/habits/${habit.id}`)
      .send({ schedule: { kind: "WEEKDAYS", weekdays: [2, 4] } });
    expect(edit.status).toBe(200);
    expect(edit.body.habit.schedule.kind).toBe("DAILY");
    expect(edit.body.habit.pendingSchedule).toEqual({
      schedule: { kind: "WEEKDAYS", weekdays: [2, 4] },
      effectiveFrom: "2026-11-17",
    });
    expect(
      (
        await member.mutate("patch", `/api/habits/${habit.id}`).send({
          schedule: {
            kind: "INTERVAL",
            intervalDays: 3,
            anchorDate: "2026-11-17",
          },
        })
      ).status,
    ).toBe(200);
    const versions = await db!.habitScheduleVersion.findMany({
      where: { habitId: habit.id },
      orderBy: { effectiveFrom: "asc" },
    });
    expect(versions).toHaveLength(2);
    expect(versions[0]!.kind).toBe("DAILY");
    expect(versions[1]!.kind).toBe("INTERVAL");
    expect((await member.agent.get("/api/habits/today")).body.completed).toBe(
      1,
    );
    const nextDay = createApp(origin, {
      database: () => db!,
      now: () => new Date("2026-11-17T17:00:00Z"),
    });
    expect(
      (
        await request(nextDay)
          .get("/api/habits/today")
          .set("Cookie", member.cookie)
      ).body.total,
    ).toBe(1);
  });
  it("uses the configured user timezone for today and preserves saved date keys after timezone changes", async () => {
    const member = await account("Pacific/Kiritimati");
    const habit = await habitFor(member);
    expect((await member.agent.get("/api/habits/today")).body.date).toBe(
      "2026-11-17",
    );
    expect(
      (
        await member
          .mutate("post", `/api/habits/${habit.id}/completions`)
          .send({ scheduledDate: "2026-11-17" })
      ).status,
    ).toBe(200);
    const profile = await member
      .mutate("patch", "/api/auth/profile")
      .send({ displayName: "Updated Reader", timezone: "America/Los_Angeles" });
    expect(profile.status).toBe(200);
    expect(profile.body.user.displayName).toBe("Updated Reader");
    expect((await member.agent.get("/api/habits/today")).body.date).toBe(
      "2026-11-16",
    );
    expect(
      (await member.agent.get(`/api/habits/${habit.id}/completions`)).body
        .completions[0],
    ).toMatchObject({
      scheduledDate: "2026-11-17",
      timezone: "Pacific/Kiritimati",
    });
    expect(
      (
        await member
          .mutate("patch", "/api/auth/profile")
          .send({ displayName: "Reader", timezone: "Mars/Olympus" })
      ).status,
    ).toBe(400);
  });
  it("paginates local-date history without permitting historical writes", async () => {
    const member = await account();
    const habit = await habitFor(member);
    await member
      .mutate("post", `/api/habits/${habit.id}/completions`)
      .send({ scheduledDate: "2026-11-16" });
    const next = createApp(origin, {
      database: () => db!,
      now: () => new Date("2026-11-17T17:00:00Z"),
    });
    const complete = await request(next)
      .post(`/api/habits/${habit.id}/completions`)
      .set("Cookie", member.cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", member.csrf)
      .send({ scheduledDate: "2026-11-17" });
    expect(complete.status).toBe(200);
    const first = await member.agent.get(
      `/api/habits/${habit.id}/completions?limit=1`,
    );
    expect(first.body.completions[0].scheduledDate).toBe("2026-11-17");
    expect(first.body.nextCursor).toBe("2026-11-17");
    const second = await member.agent.get(
      `/api/habits/${habit.id}/completions?before=${first.body.nextCursor}&limit=1`,
    );
    expect(second.body.completions[0].scheduledDate).toBe("2026-11-16");
    expect(second.body.nextCursor).toBeNull();
  });
  it("rejects unknown-account login with the same generic credential error", async () => {
    const response = await request(app())
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: `${randomUUID()}@example.test`, password });
    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe("Email or password is incorrect.");
  });
});
