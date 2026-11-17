import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { readConfig } from "./config.js";
export function createDatabase() {
  const config = readConfig();
  const url = new URL(config.DATABASE_URL);
  let ssl: undefined | { rejectUnauthorized: true; ca?: string };
  if (url.searchParams.get("sslmode") === "verify-full") {
    if (
      ["sslcert", "sslkey", "sslrootcert", "uselibpqcompat"].some((key) =>
        url.searchParams.has(key),
      )
    )
      throw new Error("Conflicting database TLS configuration");
    url.searchParams.delete("sslmode");
    ssl = {
      rejectUnauthorized: true,
      ...(config.DB_SSL_CA
        ? { ca: config.DB_SSL_CA.replaceAll("\\n", "\n") }
        : {}),
    };
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url.toString(),
      ssl,
      max: config.DB_POOL_MAX,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 30000,
      statement_timeout: 15000,
      query_timeout: 18000,
      application_name: "habitquest-api",
    }),
  });
}
