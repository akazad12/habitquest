import { randomUUID } from "node:crypto";
import request from "supertest";
import { expect } from "vitest";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { createApp } from "../apps/api/src/app.js";
export const testUrl = process.env.TEST_DATABASE_URL;
export const testDatabase = () =>
  testUrl
    ? new PrismaClient({ adapter: new PrismaPg({ connectionString: testUrl }) })
    : null;
export const origin = "http://localhost:5173";
export async function fixture(
  db: PrismaClient,
  credit = 0,
  instant = "2026-11-16T17:00:00Z",
  timezone = "UTC",
) {
  let now = new Date(instant);
  const app = createApp(origin, {
    database: () => db,
    now: () => now,
    authLimit: 1000,
    sessionDays: 3650,
  });
  const agent = request.agent(app);
  const auth = await agent
    .post("/api/auth/register")
    .set("Origin", origin)
    .send({
      email: `phase4-${randomUUID()}@example.test`,
      displayName: "Phase 4 Tester",
      password: "HabitQuest phase four test password",
      timezone,
    });
  expect(auth.status).toBe(201);
  const id = auth.body.user.id as string;
  if (credit)
    await db.coinTransaction.create({
      data: {
        userId: id,
        amount: credit,
        reason: "Isolated test fixture credit",
        idempotencyKey: randomUUID(),
        createdAt: now,
      },
    });
  const mutate = (method: "post" | "patch" | "delete", path: string) =>
    agent[method](path)
      .set("Origin", origin)
      .set("X-CSRF-Token", auth.body.csrfToken);
  const reward = async (cost = 25) => {
    const response = await mutate("post", "/api/rewards").send({
      title: "Quiet coffee",
      description: "A small celebration.",
      coinCost: cost,
      category: "Food",
      icon: "coffee",
    });
    expect(response.status).toBe(201);
    return response.body.reward;
  };
  const buy = (
    rewardId: string,
    expectedCoinCost: number,
    key = randomUUID(),
  ) =>
    mutate("post", `/api/rewards/${rewardId}/redemptions`).send({
      idempotencyKey: key,
      expectedCoinCost,
    });
  const habit = async (schedule: unknown = { kind: "DAILY" }) => {
    const response = await mutate("post", "/api/habits").send({
      title: "Practice",
      schedule,
    });
    expect(response.status).toBe(201);
    return response.body.habit.id as string;
  };
  return {
    id,
    app,
    agent,
    mutate,
    reward,
    buy,
    habit,
    setNow: (value: string) => {
      now = new Date(value);
    },
  };
}
