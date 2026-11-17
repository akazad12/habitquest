import { z } from "zod";
export const configSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    HOST: z.string().min(1).default("127.0.0.1"),
    WEB_ORIGIN: z
      .url()
      .refine((v) => new URL(v).origin === v, "Use an exact origin")
      .default("http://localhost:5173"),
    DATABASE_URL: z
      .url()
      .refine(
        (v) => ["postgres:", "postgresql:"].includes(new URL(v).protocol),
        "Use PostgreSQL",
      ),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    DB_SSL_CA: z.string().optional(),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
    RATE_LIMIT_SECRET: z.string().min(32).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV !== "production") return;
    if (!v.WEB_ORIGIN.startsWith("https://"))
      ctx.addIssue({
        code: "custom",
        path: ["WEB_ORIGIN"],
        message: "HTTPS required",
      });
    if (!v.RATE_LIMIT_SECRET)
      ctx.addIssue({
        code: "custom",
        path: ["RATE_LIMIT_SECRET"],
        message: "Required in production",
      });
    if (!v.TRUST_PROXY_HOPS)
      ctx.addIssue({
        code: "custom",
        path: ["TRUST_PROXY_HOPS"],
        message: "Explicit TLS proxy required",
      });
    if (
      v.RATE_LIMIT_SECRET?.startsWith("REPLACE_") ||
      new URL(v.WEB_ORIGIN).hostname.endsWith(".invalid")
    )
      ctx.addIssue({
        code: "custom",
        path: ["RATE_LIMIT_SECRET"],
        message: "Replace production placeholders",
      });
    const u = new URL(v.DATABASE_URL);
    if (
      u.searchParams.get("sslmode") !== "verify-full" ||
      u.searchParams.has("uselibpqcompat")
    )
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message:
          "Production requires sslmode=verify-full without compatibility overrides",
      });
  });
export type Config = z.infer<typeof configSchema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  return configSchema.parse(env);
}
