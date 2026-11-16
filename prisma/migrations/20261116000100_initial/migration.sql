-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" VARCHAR(255),
    "timezone" VARCHAR(100) NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Habit" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Habit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HabitScheduleVersion" (
    "id" UUID NOT NULL,
    "habitId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveUntil" DATE,
    "timezone" VARCHAR(100) NOT NULL,
    "weekdays" INTEGER[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HabitScheduleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HabitCompletion" (
    "id" UUID NOT NULL,
    "habitId" UUID NOT NULL,
    "scheduleVersionId" UUID NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "completedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HabitCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpTransaction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "completionId" UUID,
    "amount" INTEGER NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinTransaction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "completionId" UUID,
    "redemptionId" UUID,
    "amount" INTEGER NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "coinCost" INTEGER NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRedemption" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rewardId" UUID NOT NULL,
    "coinCost" INTEGER NOT NULL,
    "rewardTitle" VARCHAR(120) NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAchievement" (
    "userId" UUID NOT NULL,
    "achievementId" UUID NOT NULL,
    "unlockedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("userId","achievementId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Habit_userId_archivedAt_idx" ON "Habit"("userId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HabitScheduleVersion_id_habitId_key" ON "HabitScheduleVersion"("id", "habitId");

-- CreateIndex
CREATE UNIQUE INDEX "HabitScheduleVersion_habitId_effectiveFrom_key" ON "HabitScheduleVersion"("habitId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "HabitCompletion_habitId_scheduledDate_key" ON "HabitCompletion"("habitId", "scheduledDate");

-- CreateIndex
CREATE UNIQUE INDEX "XpTransaction_completionId_key" ON "XpTransaction"("completionId");

-- CreateIndex
CREATE UNIQUE INDEX "XpTransaction_idempotencyKey_key" ON "XpTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "XpTransaction_userId_createdAt_idx" ON "XpTransaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoinTransaction_completionId_key" ON "CoinTransaction"("completionId");

-- CreateIndex
CREATE UNIQUE INDEX "CoinTransaction_redemptionId_key" ON "CoinTransaction"("redemptionId");

-- CreateIndex
CREATE UNIQUE INDEX "CoinTransaction_idempotencyKey_key" ON "CoinTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CoinTransaction_userId_createdAt_idx" ON "CoinTransaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoinTransaction_redemptionId_userId_key" ON "CoinTransaction"("redemptionId", "userId");

-- CreateIndex
CREATE INDEX "Reward_userId_archivedAt_idx" ON "Reward"("userId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reward_id_userId_key" ON "Reward"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRedemption_idempotencyKey_key" ON "RewardRedemption"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RewardRedemption_userId_createdAt_idx" ON "RewardRedemption"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRedemption_id_userId_key" ON "RewardRedemption"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_key_key" ON "Achievement"("key");

-- AddForeignKey
ALTER TABLE "Habit" ADD CONSTRAINT "Habit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitScheduleVersion" ADD CONSTRAINT "HabitScheduleVersion_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitCompletion" ADD CONSTRAINT "HabitCompletion_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitCompletion" ADD CONSTRAINT "HabitCompletion_scheduleVersionId_habitId_fkey" FOREIGN KEY ("scheduleVersionId", "habitId") REFERENCES "HabitScheduleVersion"("id", "habitId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpTransaction" ADD CONSTRAINT "XpTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpTransaction" ADD CONSTRAINT "XpTransaction_completionId_fkey" FOREIGN KEY ("completionId") REFERENCES "HabitCompletion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_completionId_fkey" FOREIGN KEY ("completionId") REFERENCES "HabitCompletion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_redemptionId_userId_fkey" FOREIGN KEY ("redemptionId", "userId") REFERENCES "RewardRedemption"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_rewardId_userId_fkey" FOREIGN KEY ("rewardId", "userId") REFERENCES "Reward"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express these PostgreSQL constraints. Preserve them in migrations.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "User" ADD CONSTRAINT "User_email_normalized" CHECK (email = lower(btrim(email)) AND length(email) > 3);
ALTER TABLE "Habit" ADD CONSTRAINT "Habit_title_nonempty" CHECK (length(btrim(title)) > 0);
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_positive_cost" CHECK ("coinCost" > 0), ADD CONSTRAINT "Reward_title_nonempty" CHECK (length(btrim(title)) > 0);
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "Redemption_positive_cost" CHECK ("coinCost" > 0);
ALTER TABLE "XpTransaction" ADD CONSTRAINT "Xp_nonzero" CHECK (amount <> 0);
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "Coin_nonzero" CHECK (amount <> 0), ADD CONSTRAINT "Coin_single_source" CHECK (NOT ("completionId" IS NOT NULL AND "redemptionId" IS NOT NULL));
CREATE FUNCTION valid_weekdays(days integer[]) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT cardinality(days) BETWEEN 1 AND 7 AND days <@ ARRAY[1,2,3,4,5,6,7]
 AND array_position(days, NULL) IS NULL
 AND cardinality(days) = (SELECT count(DISTINCT d) FROM unnest(days) d);
$$;
ALTER TABLE "HabitScheduleVersion" ADD CONSTRAINT "Schedule_weekdays_valid" CHECK (valid_weekdays(weekdays)),
 ADD CONSTRAINT "Schedule_range_valid" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom"),
 ADD CONSTRAINT "Schedule_no_overlap" EXCLUDE USING gist ("habitId" WITH =, daterange("effectiveFrom", "effectiveUntil", '[)') WITH &&);
CREATE FUNCTION enforce_timezone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
  RAISE EXCEPTION 'Invalid IANA timezone' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER user_timezone BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION enforce_timezone();
CREATE TRIGGER schedule_timezone BEFORE INSERT OR UPDATE ON "HabitScheduleVersion" FOR EACH ROW EXECUTE FUNCTION enforce_timezone();
CREATE FUNCTION enforce_completion_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE schedule "HabitScheduleVersion";
BEGIN
 SELECT * INTO schedule FROM "HabitScheduleVersion" WHERE id = NEW."scheduleVersionId" FOR SHARE;
 IF schedule.id IS NULL OR schedule."habitId" <> NEW."habitId" OR NEW."scheduledDate" < schedule."effectiveFrom"
 OR (schedule."effectiveUntil" IS NOT NULL AND NEW."scheduledDate" >= schedule."effectiveUntil")
 OR NOT (extract(isodow FROM NEW."scheduledDate")::integer = ANY(schedule.weekdays)) THEN
  RAISE EXCEPTION 'Completion must match its schedule and local date' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER completion_schedule BEFORE INSERT OR UPDATE ON "HabitCompletion" FOR EACH ROW EXECUTE FUNCTION enforce_completion_schedule();
CREATE FUNCTION protect_schedule_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Versions are immutable apart from closing the exclusive end date.
 IF NEW."habitId" <> OLD."habitId" OR NEW."effectiveFrom" <> OLD."effectiveFrom"
 OR NEW.timezone <> OLD.timezone OR NEW.weekdays <> OLD.weekdays THEN
  RAISE EXCEPTION 'Create a new schedule version instead' USING ERRCODE = '23514';
 END IF;
 IF EXISTS (SELECT 1 FROM "HabitCompletion" WHERE "scheduleVersionId" = OLD.id AND "scheduledDate" >= NEW."effectiveUntil") THEN
  RAISE EXCEPTION 'Schedule change would invalidate history' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER schedule_history BEFORE UPDATE ON "HabitScheduleVersion" FOR EACH ROW EXECUTE FUNCTION protect_schedule_history();
CREATE FUNCTION enforce_transaction_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; cost integer;
BEGIN
 IF NEW."completionId" IS NOT NULL THEN
  SELECT h."userId" INTO owner_id FROM "HabitCompletion" c JOIN "Habit" h ON h.id = c."habitId" WHERE c.id = NEW."completionId";
  IF owner_id IS DISTINCT FROM NEW."userId" OR NEW.amount <= 0 THEN
   RAISE EXCEPTION 'Completion transaction owner or amount invalid' USING ERRCODE = '23514';
  END IF;
 END IF;
 IF TG_TABLE_NAME = 'CoinTransaction' THEN
  IF NEW."redemptionId" IS NOT NULL THEN
   SELECT "coinCost" INTO cost FROM "RewardRedemption" WHERE id = NEW."redemptionId";
   IF NEW.amount IS DISTINCT FROM -cost THEN
    RAISE EXCEPTION 'Redemption debit must match snapshot cost' USING ERRCODE = '23514';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER xp_source BEFORE INSERT ON "XpTransaction" FOR EACH ROW EXECUTE FUNCTION enforce_transaction_source();
CREATE TRIGGER coin_source BEFORE INSERT ON "CoinTransaction" FOR EACH ROW EXECUTE FUNCTION enforce_transaction_source();
CREATE FUNCTION prevent_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'History is append-only; use a compensating transaction' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER xp_immutable BEFORE UPDATE OR DELETE ON "XpTransaction" FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER coin_immutable BEFORE UPDATE OR DELETE ON "CoinTransaction" FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER redemption_immutable BEFORE UPDATE OR DELETE ON "RewardRedemption" FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER completion_immutable BEFORE UPDATE OR DELETE ON "HabitCompletion" FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER habit_owner_immutable BEFORE UPDATE OF "userId" ON "Habit" FOR EACH ROW WHEN (OLD."userId" IS DISTINCT FROM NEW."userId") EXECUTE FUNCTION prevent_history_mutation();
