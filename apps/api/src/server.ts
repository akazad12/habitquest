import { z } from "zod";
import { createApp } from "./app.js";
import { createDatabase } from "./db.js";
const config = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    HOST: z.string().default("127.0.0.1"),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    WEB_ORIGIN: z
      .url()
      .refine(
        (value) => new URL(value).origin === value,
        "WEB_ORIGIN must be an exact origin without a path or trailing slash",
      )
      .default("http://localhost:5173"),
  })
  .refine(
    (value) =>
      value.NODE_ENV !== "production" ||
      value.WEB_ORIGIN.startsWith("https://"),
    "Production requires an HTTPS WEB_ORIGIN",
  )
  .parse(process.env);
const database = createDatabase();
const server = createApp(config.WEB_ORIGIN, {
  database: () => database,
  production: config.NODE_ENV === "production",
}).listen(config.PORT, config.HOST, () =>
  console.log(`HabitQuest API listening on ${config.PORT}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(() => {
      void database
        .$disconnect()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
