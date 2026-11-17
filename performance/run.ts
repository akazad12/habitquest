import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import { createApp } from "../apps/api/src/app.js";
import { isolatedDatabaseUrl, seedDemo } from "../scripts/demo-seed.js";
const url = isolatedDatabaseUrl();
const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 3000,
  }),
  log: [{ emit: "event", level: "query" }],
});
let queries = 0;
db.$on("query", () => {
  queries++;
});
const workers = 4,
  iterations = 8,
  origin = "https://app.example.test";
const accounts = [];
for (let i = 1; i <= workers; i++) accounts.push(await seedDemo(db, i, 8, 14));
const server = createApp(origin, {
  database: () => db,
  production: true,
  rateLimitSecret: randomUUID() + randomUUID(),
  trustProxyHops: 1,
  enforceHttps: true,
  logger: () => {},
}).listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("Missing local address");
const base = `http://127.0.0.1:${address.port}`;
const clients = accounts.map((account, i) => ({
  account,
  cookie: "",
  csrf: "",
  ip: `198.51.100.${i + 1}`,
}));
async function call(
  client: (typeof clients)[number],
  path: string,
  method = "GET",
  body?: unknown,
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      "X-Forwarded-Proto": "https",
      "X-Forwarded-For": client.ip,
      Cookie: client.cookie,
      "X-CSRF-Token": client.csrf,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = r.status === 204 ? undefined : await r.json();
  if (!r.ok) throw new Error(`Unexpected HTTP ${r.status}`);
  return { r, data };
}
async function login(c: (typeof clients)[number]) {
  const { r, data } = await call(c, "/api/auth/login", "POST", {
    email: c.account.email,
    password: c.account.password,
  });
  c.cookie = r.headers.get("set-cookie")!.split(";")[0]!;
  c.csrf = data.csrfToken;
}
const results = [];
try {
  for (const c of clients) await login(c);
  const scenarios: [
    string,
    number,
    (c: (typeof clients)[number]) => Promise<unknown>,
  ][] = [
    ["authentication", 4, login],
    ["daily_dashboard", iterations, (c) => call(c, "/api/habits/today")],
    [
      "habit_completion",
      iterations,
      async (c) => {
        await call(
          c,
          `/api/habits/${c.account.habitId}/completions/${c.account.today}`,
          "DELETE",
        );
        return call(c, `/api/habits/${c.account.habitId}/completions`, "POST", {
          scheduledDate: c.account.today,
        });
      },
    ],
    ["progression", iterations, (c) => call(c, "/api/progression")],
    ["analytics", iterations, (c) => call(c, "/api/analytics")],
    [
      "reward_redemption",
      iterations,
      (c) =>
        call(c, `/api/rewards/${c.account.rewardId}/redemptions`, "POST", {
          idempotencyKey: randomUUID(),
          expectedCoinCost: 1,
        }),
    ],
  ];
  for (const [name, count, operation] of scenarios) {
    const values: number[] = [];
    let errors = 0;
    queries = 0;
    const start = performance.now();
    await Promise.all(
      clients.map(async (c) => {
        for (let i = 0; i < count; i++) {
          const t = performance.now();
          try {
            await operation(c);
          } catch {
            errors++;
          }
          values.push(performance.now() - t);
        }
      }),
    );
    const seconds = (performance.now() - start) / 1000;
    values.sort((a, b) => a - b);
    const percentile = (p: number) =>
      Math.round(values[Math.max(0, Math.ceil(values.length * p) - 1)]! * 100) /
      100;
    results.push({
      scenario: name,
      requests: values.length,
      workers,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      throughputPerSecond: Math.round((values.length / seconds) * 100) / 100,
      errorRate: errors / values.length,
      errors,
      sqlStatements: queries,
      note:
        name === "habit_completion"
          ? "Each measured cycle includes undo plus completion; SQL includes both requests."
          : undefined,
    });
  }
  const queryScaling = [];
  for (const size of [1, 24]) {
    const account = await seedDemo(db, size + 100, size, 0);
    const c = { account, cookie: "", csrf: "", ip: `198.51.101.${size}` };
    await login(c);
    for (const path of [
      "/api/habits/today",
      "/api/progression",
      "/api/analytics",
    ]) {
      queries = 0;
      await call(c, path);
      queryScaling.push({ habits: size, path, sqlStatements: queries });
    }
  }
  const report = {
    measuredAt: new Date().toISOString(),
    tool: "Node fetch closed-loop local load runner",
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      poolMax: 10,
      workers,
      fixture:
        "Four isolated users, eight habits each, fourteen days of actual transaction-service history; additional 1-vs-24 habit query probes",
      target:
        "ephemeral in-process API on 127.0.0.1, PostgreSQL in local Docker; not production",
    },
    budgets: {
      authenticationP95Ms: 1500,
      readP95Ms: 500,
      writeCycleP95Ms: 1000,
      errorRate: 0,
      note: "Targets for this local smoke workload, not a production SLA",
    },
    results,
    queryScaling,
  };
  await mkdir("docs/verification", { recursive: true });
  await writeFile(
    "docs/verification/performance.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (results.some((r) => r.errors)) process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.$disconnect();
}
