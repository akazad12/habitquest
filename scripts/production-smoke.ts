import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const socket = createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const address = socket.address();
if (!address || typeof address === "string") throw new Error("No port");
const port = address.port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const child = spawn(process.execPath, ["apps/api/dist/server.js"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    WEB_ORIGIN: "https://app.example.test",
    TRUST_PROXY_HOPS: "1",
    RATE_LIMIT_SECRET: randomBytes(32).toString("hex"),
    DATABASE_URL:
      "postgresql://unavailable:synthetic@127.0.0.1:1/isolated?sslmode=verify-full",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => {
  logs += String(chunk);
});
child.stderr.on("data", (chunk) => {
  logs += String(chunk);
});
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Startup deadline exceeded")),
      5000,
    );
    child.stdout.on("data", () => {
      if (logs.includes("server_listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Startup failed"));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const live = await fetch(base + "/api/health");
  const ready = await fetch(base + "/api/ready");
  const insecure = await fetch(base + "/api/auth/me");
  const secure = await fetch(base + "/api/auth/me", {
    headers: { "X-Forwarded-Proto": "https" },
  });
  if (
    live.status !== 200 ||
    ready.status !== 503 ||
    insecure.status !== 400 ||
    secure.status !== 401
  )
    throw new Error("Unexpected production smoke result");
  child.kill("SIGTERM");
  const exit = await new Promise<number | null>((resolve) =>
    child.once("exit", resolve),
  );
  if (
    exit !== 0 ||
    !logs.includes("shutdown_complete") ||
    logs.includes("unavailable:synthetic")
  )
    throw new Error("Unsafe log or shutdown failure");
  const report = {
    verifiedAt: new Date().toISOString(),
    configuration:
      "Built API started from environment without loading a local .env; no live platform deployment",
    liveness: live.status,
    readinessWithUnavailableDatabase: ready.status,
    insecureProtectedRequest: insecure.status,
    forwardedHttpsWithoutSession: secure.status,
    gracefulShutdownExit: exit,
    credentialsAbsentFromLogs: true,
    liveManagedTlsDatabase: "Not run; provider credentials unavailable",
  };
  await mkdir("docs/verification", { recursive: true });
  await writeFile(
    "docs/verification/production-smoke.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (child.exitCode === null) child.kill("SIGKILL");
}
