import { createHmac } from "node:crypto";
import type { Store, IncrementResponse, Options } from "express-rate-limit";
import type { PrismaClient } from "./generated/prisma/client.js";
// A single atomic UPSERT makes a fixed window consistent across API processes.
export class PostgresRateLimitStore implements Store {
  localKeys = false;
  private windowMs = 900000;
  constructor(
    private database: () => PrismaClient,
    private secret: string,
    private namespace: string,
  ) {}
  init(options: Options) {
    this.windowMs = options.windowMs;
  }
  private key(key: string) {
    return createHmac("sha256", this.secret)
      .update(`${this.namespace}:${key}`)
      .digest("hex");
  }
  async increment(key: string): Promise<IncrementResponse> {
    const digest = this.key(key);
    const rows = await this.database().$queryRaw<
      { hits: number; expiresAt: Date }[]
    >`
      INSERT INTO "AuthRateLimit" (key,hits,"expiresAt") VALUES (${digest},1,clock_timestamp()+${this.windowMs}*interval '1 millisecond')
      ON CONFLICT (key) DO UPDATE SET hits=CASE WHEN "AuthRateLimit"."expiresAt"<=clock_timestamp() THEN 1 ELSE least("AuthRateLimit".hits,2147483646)+1 END,
      "expiresAt"=CASE WHEN "AuthRateLimit"."expiresAt"<=clock_timestamp() THEN clock_timestamp()+${this.windowMs}*interval '1 millisecond' ELSE "AuthRateLimit"."expiresAt" END
      RETURNING hits,"expiresAt"`;
    return { totalHits: rows[0]!.hits, resetTime: rows[0]!.expiresAt };
  }
  async decrement(key: string) {
    await this.database()
      .$executeRaw`UPDATE "AuthRateLimit" SET hits=greatest(0,hits-1) WHERE key=${this.key(key)}`;
  }
  async resetKey(key: string) {
    await this.database()
      .$executeRaw`DELETE FROM "AuthRateLimit" WHERE key=${this.key(key)}`;
  }
}
