-- Operational rate-limit state only; no existing user or ledger data is changed.
CREATE TABLE "AuthRateLimit" (
 "key" CHAR(64) PRIMARY KEY,
 "hits" INTEGER NOT NULL CHECK ("hits">=0),
 "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "AuthRateLimit_key_check" CHECK ("key" ~ '^[a-f0-9]{64}$')
);
CREATE INDEX "AuthRateLimit_expiresAt_idx" ON "AuthRateLimit"("expiresAt");
