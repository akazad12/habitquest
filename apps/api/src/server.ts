import { readConfig } from "./config.js";
import { createApp } from "./app.js";
import { createDatabase } from "./db.js";
import { jsonLogger } from "./observability.js";
import { shutdownHandler } from "./lifecycle.js";
import { ZodError } from "zod";
try {
  const config = readConfig();
  const database = createDatabase();
  const server = createApp(config.WEB_ORIGIN, {
    database: () => database,
    production: config.NODE_ENV === "production",
    rateLimitSecret: config.RATE_LIMIT_SECRET,
    trustProxyHops: config.TRUST_PROXY_HOPS,
    isDraining: () => lifecycle.isDraining(),
  }).listen(config.PORT, config.HOST, () =>
    jsonLogger({ event: "server_listening", port: config.PORT }),
  );
  const lifecycle = shutdownHandler(
    server,
    () => database.$disconnect(),
    jsonLogger,
    (code) => process.exit(code),
  );
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.on("error", () => {
    jsonLogger({ event: "server_failed" });
    void database.$disconnect().finally(() => process.exit(1));
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, lifecycle.stop);
} catch (error) {
  jsonLogger({
    event: "startup_failed",
    fields:
      error instanceof ZodError
        ? error.issues.map((i) => i.path.join(".")).join(",")
        : "configuration",
  });
  process.exitCode = 1;
}
