import { randomUUID } from "node:crypto";
import { afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { testDatabase } from "./phase4-support.js";
import { createApp } from "../apps/api/src/app.js";
import { PostgresRateLimitStore } from "../apps/api/src/rate-limit-store.js";
const db = testDatabase();
afterAll(async () => {
  await db?.$disconnect();
});
describe.skipIf(!db)("persistent auth budgets", () => {
  const origin = "https://app.example.com";
  const secret = randomUUID() + randomUUID();
  const app = () =>
    createApp(origin, {
      database: () => db!,
      production: true,
      trustProxyHops: 1,
      enforceHttps: true,
      rateLimitSecret: secret,
      authLimit: 3,
    });
  const login = (server: ReturnType<typeof app>, ip: string, email: string) =>
    request(server)
      .post("/api/auth/login")
      .set("Origin", origin)
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-For", ip)
      .send({ email, password: "Invalid test password" });
  it("shares IP limits across independent app instances and ignores spoofed leading IPs", async () => {
    const a = app(),
      b = app();
    for (let i = 0; i < 3; i++)
      expect(
        (
          await login(
            i % 2 ? a : b,
            `198.51.100.${i + 1}, 203.0.113.10`,
            `${randomUUID()}@example.test`,
          )
        ).status,
      ).toBe(401);
    const r = await login(
      b,
      "192.0.2.99, 203.0.113.10",
      `${randomUUID()}@example.test`,
    );
    expect(r.status).toBe(429);
    expect(r.headers["ratelimit"]).toBeDefined();
  });
  it("bounds a normalized account across multiple IPs", async () => {
    const email = `${randomUUID()}@example.test`;
    const a = app(),
      b = app();
    for (let i = 0; i < 10; i++)
      expect(
        (
          await login(
            i % 2 ? a : b,
            `203.0.114.${i + 1}`,
            i % 2 ? email.toUpperCase() : email,
          )
        ).status,
      ).toBe(401);
    expect((await login(b, "203.0.114.99", email)).status).toBe(429);
  });
  it("counts concurrent increments exactly once and resets expired windows", async () => {
    const name = randomUUID();
    const store = new PostgresRateLimitStore(() => db!, secret, name);
    const values = await Promise.all(
      Array.from({ length: 12 }, () => store.increment("synthetic-private-ip")),
    );
    expect(values.map((v) => v.totalHits).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    const rows = await db!.authRateLimit.findMany();
    expect(rows.some((r) => r.key.includes("synthetic"))).toBe(false);
    await store.resetKey("synthetic-private-ip");
    expect((await store.increment("synthetic-private-ip")).totalHits).toBe(1);
    const key = (
      await db!.authRateLimit.findMany({
        where: { hits: 1 },
        orderBy: { expiresAt: "desc" },
        take: 1,
      })
    )[0]!.key;
    await db!.authRateLimit.update({
      where: { key },
      data: { expiresAt: new Date(0) },
    });
    expect((await store.increment("synthetic-private-ip")).totalHits).toBe(1);
  });
  it("fails closed if its persistent store is unavailable", async () => {
    const r = await request(
      createApp(origin, {
        production: true,
        enforceHttps: true,
        trustProxyHops: 1,
        rateLimitSecret: secret,
        database: () => {
          throw new Error("private-db-secret");
        },
      }),
    )
      .post("/api/auth/login")
      .set("Origin", origin)
      .set("X-Forwarded-Proto", "https")
      .send({ email: "test@example.test", password: "Invalid test password" });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("private-db-secret");
  });
});
