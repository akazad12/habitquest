import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import { createApp } from "../apps/api/src/app.js";
import { readConfig } from "../apps/api/src/config.js";
import { shutdownHandler } from "../apps/api/src/lifecycle.js";
import type { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
const env = {
  NODE_ENV: "production",
  WEB_ORIGIN: "https://app.example.com",
  DATABASE_URL:
    "postgresql://test:private@db.example.com/test?sslmode=verify-full",
  TRUST_PROXY_HOPS: "1",
  RATE_LIMIT_SECRET: "a".repeat(64),
};
describe("production configuration", () => {
  it("requires secure explicit production settings", () => {
    expect(readConfig(env).DB_POOL_MAX).toBe(10);
  });
  it.each([
    { WEB_ORIGIN: "http://app.example.com" },
    { RATE_LIMIT_SECRET: "REPLACE_WITH_RANDOM_CHARACTERS_12345" },
    { RATE_LIMIT_SECRET: undefined },
    { TRUST_PROXY_HOPS: "0" },
    { TRUST_PROXY_HOPS: "true" },
    { DATABASE_URL: "postgresql://db/test?sslmode=require" },
    {
      DATABASE_URL:
        "postgresql://db/test?sslmode=verify-full&uselibpqcompat=true",
    },
    { DB_POOL_MAX: "100" },
    { NODE_ENV: "staging" },
  ])("rejects unsafe settings %j", (override) => {
    expect(() => readConfig({ ...env, ...override })).toThrow();
  });
  it("allows ordinary local PostgreSQL configuration", () => {
    expect(
      readConfig({ DATABASE_URL: "postgresql://localhost/test" }).NODE_ENV,
    ).toBe("development");
  });
});
describe("reliability and safe request telemetry", () => {
  it("returns readiness only after a successful database query", async () => {
    const query = vi.fn().mockResolvedValue([{ value: 1 }]);
    const app = createApp(undefined, {
      database: () => ({ $queryRaw: query }) as unknown as PrismaClient,
    });
    const r = await request(app).get("/api/ready");
    expect(r.status).toBe(200);
    expect(query).toHaveBeenCalledOnce();
    expect(r.headers["cache-control"]).toBe("no-store");
  });
  it("keeps liveness independent and hides readiness failure details", async () => {
    const app = createApp(undefined, {
      database: () => {
        throw new Error("secret-db-password");
      },
    });
    expect((await request(app).get("/api/health")).status).toBe(200);
    const r = await request(app).get("/api/ready");
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain("secret");
  });
  it("reports not ready while draining without touching the database", async () => {
    const db = vi.fn();
    const r = await request(
      createApp(undefined, { isDraining: () => true, database: db }),
    ).get("/api/ready");
    expect(r.status).toBe(503);
    expect(db).not.toHaveBeenCalled();
  });
  it("generates correlation IDs and never logs raw URLs, auth headers, or bodies", async () => {
    const log = vi.fn();
    const r = await request(createApp(undefined, { logger: log }))
      .post("/api/missing?token=private-query")
      .set("Origin", "http://localhost:5173")
      .set("Authorization", "Bearer private-token")
      .set("Cookie", "private-cookie")
      .set("X-Request-ID", "injected")
      .send({ password: "private-password" });
    expect(r.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const text = JSON.stringify(log.mock.calls);
    expect(text).not.toMatch(/private-|injected/);
    expect(text).toContain(r.headers["x-request-id"]);
  });
  it("reports safe correlated errors without raw exception messages", async () => {
    const log = vi.fn();
    const app = createApp(undefined, {
      logger: log,
      database: () => {
        throw new Error("secret-host-and-password");
      },
    });
    const r = await request(app)
      .get("/api/auth/me")
      .set("Cookie", `habitquest=${"a".repeat(64)}`);
    expect(r.status).toBe(500);
    expect(
      JSON.stringify(log.mock.calls) + JSON.stringify(r.body),
    ).not.toContain("secret-host");
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "api_error",
        requestId: r.headers["x-request-id"],
      }),
    );
  });
  it("requires HTTPS only through explicitly trusted proxy hops", async () => {
    const app = createApp("https://app.example.com", {
      production: true,
      rateLimitSecret: env.RATE_LIMIT_SECRET,
      trustProxyHops: 1,
      enforceHttps: true,
    });
    expect((await request(app).get("/api/auth/me")).status).toBe(400);
    expect(
      (await request(app).get("/api/auth/me").set("X-Forwarded-Proto", "https"))
        .status,
    ).toBe(401);
    const direct = createApp("https://app.example.com", {
      production: true,
      rateLimitSecret: env.RATE_LIMIT_SECRET,
      enforceHttps: true,
    });
    expect(
      (
        await request(direct)
          .get("/api/auth/me")
          .set("X-Forwarded-Proto", "https")
      ).status,
    ).toBe(400);
  });
});
describe("graceful shutdown", () => {
  it("drains once, closes idle connections, and disconnects before successful exit", async () => {
    let finish: () => void = () => {};
    const close = vi.fn((cb: () => void) => {
      finish = cb;
    });
    const idle = vi.fn();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const h = shutdownHandler(
      { close, closeIdleConnections: idle } as unknown as Server,
      disconnect,
      vi.fn(),
      exit,
    );
    h.stop();
    h.stop();
    expect(h.isDraining()).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(idle).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it("terminates stuck connections at the deadline", () => {
    vi.useFakeTimers();
    try {
      const closeAllConnections = vi.fn();
      const exit = vi.fn();
      const h = shutdownHandler(
        {
          close: vi.fn(),
          closeIdleConnections: vi.fn(),
          closeAllConnections,
        } as unknown as Server,
        vi.fn(),
        vi.fn(),
        exit,
        100,
      );
      h.stop();
      vi.advanceTimersByTime(101);
      expect(closeAllConnections).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
