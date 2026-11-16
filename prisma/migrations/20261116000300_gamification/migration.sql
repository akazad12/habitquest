-- AlterTable
ALTER TABLE "CoinTransaction" ADD COLUMN     "rewardEventId" UUID;

-- AlterTable
ALTER TABLE "XpTransaction" ADD COLUMN     "rewardEventId" UUID;

-- CreateTable
CREATE TABLE "CompletionReward" (
    "id" UUID NOT NULL,
    "completionId" UUID NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "baseXp" INTEGER NOT NULL,
    "bonusPercent" INTEGER NOT NULL,
    "xp" INTEGER NOT NULL,
    "coins" INTEGER NOT NULL,
    "streakAtAward" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompletionReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompletionRewardEvent" (
    "id" UUID NOT NULL,
    "rewardId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "direction" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompletionRewardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreakFreeze" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "source" VARCHAR(50) NOT NULL DEFAULT 'INITIAL',
    "grantedDate" DATE NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreakFreeze_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreakFreezeUse" (
    "freezeId" UUID NOT NULL,
    "habitId" UUID NOT NULL,
    "scheduleVersionId" UUID NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "usedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreakFreezeUse_pkey" PRIMARY KEY ("freezeId")
);

-- CreateTable
CREATE TABLE "HabitPause" (
    "id" UUID NOT NULL,
    "habitId" UUID NOT NULL,
    "fromDate" DATE NOT NULL,
    "untilDate" DATE,
    "timezone" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HabitPause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompletionReward_completionId_key" ON "CompletionReward"("completionId");

-- CreateIndex
CREATE UNIQUE INDEX "CompletionRewardEvent_rewardId_revision_key" ON "CompletionRewardEvent"("rewardId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "StreakFreeze_userId_source_key" ON "StreakFreeze"("userId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "StreakFreezeUse_habitId_scheduledDate_key" ON "StreakFreezeUse"("habitId", "scheduledDate");

-- CreateIndex
CREATE INDEX "HabitPause_habitId_fromDate_idx" ON "HabitPause"("habitId", "fromDate");

-- CreateIndex
CREATE UNIQUE INDEX "CoinTransaction_rewardEventId_key" ON "CoinTransaction"("rewardEventId");

-- CreateIndex
CREATE UNIQUE INDEX "XpTransaction_rewardEventId_key" ON "XpTransaction"("rewardEventId");

-- AddForeignKey
ALTER TABLE "XpTransaction" ADD CONSTRAINT "XpTransaction_rewardEventId_fkey" FOREIGN KEY ("rewardEventId") REFERENCES "CompletionRewardEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_rewardEventId_fkey" FOREIGN KEY ("rewardEventId") REFERENCES "CompletionRewardEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletionReward" ADD CONSTRAINT "CompletionReward_completionId_fkey" FOREIGN KEY ("completionId") REFERENCES "HabitCompletion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletionRewardEvent" ADD CONSTRAINT "CompletionRewardEvent_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "CompletionReward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreakFreeze" ADD CONSTRAINT "StreakFreeze_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreakFreezeUse" ADD CONSTRAINT "StreakFreezeUse_freezeId_fkey" FOREIGN KEY ("freezeId") REFERENCES "StreakFreeze"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreakFreezeUse" ADD CONSTRAINT "StreakFreezeUse_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreakFreezeUse" ADD CONSTRAINT "StreakFreezeUse_scheduleVersionId_habitId_fkey" FOREIGN KEY ("scheduleVersionId", "habitId") REFERENCES "HabitScheduleVersion"("id", "habitId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitPause" ADD CONSTRAINT "HabitPause_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Audited managed award cycles supplement, rather than rewrite, the legacy ledgers.
ALTER TABLE "CompletionReward" ADD CONSTRAINT "Reward_snapshot_valid" CHECK (
 "streakAtAward" >= 1 AND "baseXp" = CASE difficulty WHEN 'EASY' THEN 15 WHEN 'MEDIUM' THEN 25 ELSE 40 END
 AND coins = CASE difficulty WHEN 'EASY' THEN 5 WHEN 'MEDIUM' THEN 10 ELSE 15 END
 AND "bonusPercent" = CASE WHEN "streakAtAward" >= 30 THEN 25 WHEN "streakAtAward" >= 7 THEN 10 ELSE 0 END
 AND xp = ("baseXp" * (100 + "bonusPercent")) / 100
 AND revision >= 0 AND active = (revision % 2 = 1)
);
ALTER TABLE "CompletionRewardEvent" ADD CONSTRAINT "Reward_event_direction" CHECK (revision > 0 AND direction = CASE WHEN revision % 2 = 1 THEN 1 ELSE -1 END);
ALTER TABLE "XpTransaction" ADD CONSTRAINT "Xp_single_source" CHECK (num_nonnulls("completionId", "rewardEventId") <= 1);
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "Coin_one_source" CHECK (num_nonnulls("completionId", "redemptionId", "rewardEventId") <= 1);
ALTER TABLE "HabitPause" ADD CONSTRAINT "Pause_range_valid" CHECK ("untilDate" IS NULL OR "untilDate" >= "fromDate"),
 ADD CONSTRAINT "Pause_no_overlap" EXCLUDE USING gist ("habitId" WITH =, daterange("fromDate", "untilDate", '[)') WITH &&);
CREATE UNIQUE INDEX "Pause_one_open" ON "HabitPause"("habitId") WHERE "untilDate" IS NULL;
CREATE TRIGGER pause_timezone BEFORE INSERT OR UPDATE ON "HabitPause" FOR EACH ROW EXECUTE FUNCTION enforce_timezone();
CREATE TRIGGER freeze_timezone BEFORE INSERT ON "StreakFreezeUse" FOR EACH ROW EXECUTE FUNCTION enforce_timezone();

CREATE FUNCTION protect_reward_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW."completionId",NEW.difficulty,NEW."baseXp",NEW."bonusPercent",NEW.xp,NEW.coins,NEW."streakAtAward",NEW."createdAt") IS DISTINCT FROM
 ROW(OLD.id,OLD."completionId",OLD.difficulty,OLD."baseXp",OLD."bonusPercent",OLD.xp,OLD.coins,OLD."streakAtAward",OLD."createdAt")
 OR NEW.revision <> OLD.revision + 1 THEN
  RAISE EXCEPTION 'Reward snapshots are immutable; append one event per state transition' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER reward_snapshot BEFORE UPDATE ON "CompletionReward" FOR EACH ROW EXECUTE FUNCTION protect_reward_snapshot();
CREATE TRIGGER reward_no_delete BEFORE DELETE ON "CompletionReward" FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER reward_event_immutable BEFORE UPDATE OR DELETE ON "CompletionRewardEvent" FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER freeze_grant_immutable BEFORE UPDATE OR DELETE ON "StreakFreeze" FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER freeze_use_immutable BEFORE UPDATE OR DELETE ON "StreakFreezeUse" FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER achievement_permanent BEFORE UPDATE OR DELETE ON "UserAchievement" FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();

CREATE FUNCTION check_managed_ledger_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; expected integer;
BEGIN
 IF NEW."rewardEventId" IS NOT NULL THEN
  SELECT h."userId", e.direction * CASE WHEN TG_TABLE_NAME='XpTransaction' THEN r.xp ELSE r.coins END INTO owner_id,expected
  FROM "CompletionRewardEvent" e JOIN "CompletionReward" r ON r.id=e."rewardId"
  JOIN "HabitCompletion" c ON c.id=r."completionId" JOIN "Habit" h ON h.id=c."habitId" WHERE e.id=NEW."rewardEventId";
  IF owner_id IS DISTINCT FROM NEW."userId" OR NEW.amount IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'Managed ledger source, owner, or amount invalid' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER xp_managed_source BEFORE INSERT ON "XpTransaction" FOR EACH ROW EXECUTE FUNCTION check_managed_ledger_source();
CREATE TRIGGER coin_managed_source BEFORE INSERT ON "CoinTransaction" FOR EACH ROW EXECUTE FUNCTION check_managed_ledger_source();

-- Every balance-changing writer shares the same user lock, including future spend paths.
DO $$ BEGIN
 IF EXISTS (SELECT "userId" FROM "CoinTransaction" GROUP BY "userId" HAVING sum(amount)<0)
 OR EXISTS (SELECT "userId" FROM "XpTransaction" GROUP BY "userId" HAVING sum(amount)<0) THEN
  RAISE EXCEPTION 'Existing negative ledger balance needs an audited correction before enabling progression';
 END IF;
END $$;
CREATE FUNCTION check_nonnegative_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE balance bigint;
BEGIN
 PERFORM id FROM "User" WHERE id=NEW."userId" FOR UPDATE;
 IF TG_TABLE_NAME='CoinTransaction' THEN
  SELECT coalesce(sum(amount),0) INTO balance FROM "CoinTransaction" WHERE "userId"=NEW."userId";
 ELSE
  SELECT coalesce(sum(amount),0) INTO balance FROM "XpTransaction" WHERE "userId"=NEW."userId";
 END IF;
 IF balance + NEW.amount < 0 THEN
  RAISE EXCEPTION 'Insufficient balance for ledger entry' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER coin_balance BEFORE INSERT ON "CoinTransaction" FOR EACH ROW EXECUTE FUNCTION check_nonnegative_balance();
CREATE TRIGGER xp_balance BEFORE INSERT ON "XpTransaction" FOR EACH ROW EXECUTE FUNCTION check_nonnegative_balance();

-- Deferred checks make the reward, both ledger entries, and completion state an atomic unit.
CREATE FUNCTION verify_managed_reward() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reward "CompletionReward"; target_id uuid; events bigint; last_revision integer; undone timestamptz;
BEGIN
 IF TG_TABLE_NAME='CompletionReward' THEN target_id=NEW.id;
 ELSIF TG_TABLE_NAME='CompletionRewardEvent' THEN target_id=NEW."rewardId";
 ELSE SELECT id INTO target_id FROM "CompletionReward" WHERE "completionId"=NEW.id;
 END IF;
 IF target_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO reward FROM "CompletionReward" WHERE id=target_id;
 SELECT count(*), coalesce(max(revision),0) INTO events,last_revision FROM "CompletionRewardEvent" WHERE "rewardId"=target_id;
 SELECT "undoneAt" INTO undone FROM "HabitCompletion" WHERE id=reward."completionId";
 IF events<>reward.revision OR last_revision<>reward.revision OR reward.active IS DISTINCT FROM (undone IS NULL)
 OR EXISTS (
  SELECT 1 FROM "CompletionRewardEvent" e
  LEFT JOIN "XpTransaction" x ON x."rewardEventId"=e.id
  LEFT JOIN "CoinTransaction" c ON c."rewardEventId"=e.id
  WHERE e."rewardId"=target_id AND (x.id IS NULL OR c.id IS NULL OR x.amount<>e.direction*reward.xp OR c.amount<>e.direction*reward.coins)
 ) THEN
  RAISE EXCEPTION 'Incomplete or inconsistent managed reward transaction' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER reward_consistency AFTER INSERT OR UPDATE ON "CompletionReward" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_managed_reward();
CREATE CONSTRAINT TRIGGER reward_event_consistency AFTER INSERT ON "CompletionRewardEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_managed_reward();
CREATE CONSTRAINT TRIGGER completion_reward_consistency AFTER UPDATE ON "HabitCompletion" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_managed_reward();

CREATE FUNCTION enforce_freeze_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM "User" WHERE id=NEW."userId" FOR UPDATE;
 IF (SELECT count(*) FROM "StreakFreeze" f LEFT JOIN "StreakFreezeUse" u ON u."freezeId"=f.id WHERE f."userId"=NEW."userId" AND u."freezeId" IS NULL)>=2 THEN
  RAISE EXCEPTION 'Freeze inventory cannot exceed two' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER freeze_inventory BEFORE INSERT ON "StreakFreeze" FOR EACH ROW EXECUTE FUNCTION enforce_freeze_inventory();
CREATE FUNCTION grant_initial_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO "StreakFreeze" (id,"userId",source,"grantedDate",timezone) VALUES (gen_random_uuid(),NEW.id,'INITIAL',(CURRENT_TIMESTAMP AT TIME ZONE NEW.timezone)::date,NEW.timezone);
 RETURN NEW;
END;
$$;
CREATE TRIGGER initial_freeze AFTER INSERT ON "User" FOR EACH ROW EXECUTE FUNCTION grant_initial_freeze();
INSERT INTO "StreakFreeze" (id,"userId",source,"grantedDate",timezone) SELECT gen_random_uuid(),id,'INITIAL',(CURRENT_TIMESTAMP AT TIME ZONE timezone)::date,timezone FROM "User";
INSERT INTO "HabitPause" (id,"habitId","fromDate",timezone)
 SELECT gen_random_uuid(),h.id,(h."archivedAt" AT TIME ZONE u.timezone)::date,u.timezone FROM "Habit" h JOIN "User" u ON u.id=h."userId" WHERE h."archivedAt" IS NOT NULL;
CREATE FUNCTION validate_freeze_use() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; habit_owner uuid; schedule "HabitScheduleVersion";
BEGIN
 SELECT "userId" INTO owner_id FROM "StreakFreeze" WHERE id=NEW."freezeId";
 PERFORM id FROM "User" WHERE id=owner_id FOR UPDATE;
 SELECT "userId" INTO habit_owner FROM "Habit" WHERE id=NEW."habitId";
 SELECT * INTO schedule FROM "HabitScheduleVersion" WHERE id=NEW."scheduleVersionId" FOR SHARE;
 IF owner_id IS DISTINCT FROM habit_owner OR schedule."habitId" IS DISTINCT FROM NEW."habitId"
 OR NEW."scheduledDate"<schedule."effectiveFrom" OR (schedule."effectiveUntil" IS NOT NULL AND NEW."scheduledDate">=schedule."effectiveUntil")
 OR NOT schedule_is_due(schedule.kind,schedule.weekdays,schedule."intervalDays",schedule."anchorDate",NEW."scheduledDate")
 OR EXISTS (SELECT 1 FROM "HabitCompletion" WHERE "habitId"=NEW."habitId" AND "scheduledDate"=NEW."scheduledDate" AND "undoneAt" IS NULL)
 OR EXISTS (SELECT 1 FROM "HabitPause" WHERE "habitId"=NEW."habitId" AND "fromDate"<=NEW."scheduledDate" AND ("untilDate" IS NULL OR NEW."scheduledDate"<"untilDate")) THEN
  RAISE EXCEPTION 'Freeze must protect an owned, missed scheduled occurrence' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER freeze_eligibility BEFORE INSERT ON "StreakFreezeUse" FOR EACH ROW EXECUTE FUNCTION validate_freeze_use();
CREATE FUNCTION prevent_frozen_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."undoneAt" IS NULL AND EXISTS (SELECT 1 FROM "StreakFreezeUse" WHERE "habitId"=NEW."habitId" AND "scheduledDate"=NEW."scheduledDate") THEN
  RAISE EXCEPTION 'A frozen occurrence cannot also be completed' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER completion_not_frozen BEFORE INSERT OR UPDATE ON "HabitCompletion" FOR EACH ROW EXECUTE FUNCTION prevent_frozen_completion();
CREATE FUNCTION protect_freeze_schedule_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "StreakFreezeUse" WHERE "scheduleVersionId"=OLD.id AND "scheduledDate">=NEW."effectiveUntil") THEN
  RAISE EXCEPTION 'Schedule change would invalidate freeze history' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER freeze_schedule_history BEFORE UPDATE ON "HabitScheduleVersion" FOR EACH ROW EXECUTE FUNCTION protect_freeze_schedule_history();
CREATE FUNCTION protect_pause_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW."habitId",NEW."fromDate",NEW.timezone,NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."habitId",OLD."fromDate",OLD.timezone,OLD."createdAt")
 OR OLD."untilDate" IS NOT NULL OR NEW."untilDate" IS NULL THEN
  RAISE EXCEPTION 'An archive pause may only be closed once' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER pause_history BEFORE UPDATE ON "HabitPause" FOR EACH ROW EXECUTE FUNCTION protect_pause_history();
CREATE TRIGGER pause_no_delete BEFORE DELETE ON "HabitPause" FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();

INSERT INTO "Achievement" (id,key,title,description) VALUES
 ('a0000000-0000-4000-8000-000000000001','first-step','First Step','Complete your first habit session.'),
 ('a0000000-0000-4000-8000-000000000002','consistency','Consistency','Reach a streak of 7 real scheduled completions.'),
 ('a0000000-0000-4000-8000-000000000003','dedicated','Dedicated','Reach a streak of 30 real scheduled completions.'),
 ('a0000000-0000-4000-8000-000000000004','century-club','Century Club','Record 100 completed habit sessions.'),
 ('a0000000-0000-4000-8000-000000000005','habit-builder','Habit Builder','Create five habits, including archived habits.')
 ON CONFLICT (key) DO NOTHING;

CREATE TRIGGER freeze_grant_timezone BEFORE INSERT ON "StreakFreeze" FOR EACH ROW EXECUTE FUNCTION enforce_timezone();
CREATE FUNCTION prevent_mixed_reward_sources() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='CompletionReward' THEN
  IF EXISTS (SELECT 1 FROM "XpTransaction" WHERE "completionId"=NEW."completionId") OR EXISTS (SELECT 1 FROM "CoinTransaction" WHERE "completionId"=NEW."completionId") THEN
   RAISE EXCEPTION 'Legacy awards cannot also receive managed rewards' USING ERRCODE='23514';
  END IF;
 ELSIF NEW."completionId" IS NOT NULL THEN
  IF EXISTS (SELECT 1 FROM "CompletionReward" WHERE "completionId"=NEW."completionId") THEN
   RAISE EXCEPTION 'Managed completions cannot also receive legacy awards' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER reward_not_legacy BEFORE INSERT ON "CompletionReward" FOR EACH ROW EXECUTE FUNCTION prevent_mixed_reward_sources();
CREATE TRIGGER xp_not_mixed BEFORE INSERT ON "XpTransaction" FOR EACH ROW EXECUTE FUNCTION prevent_mixed_reward_sources();
CREATE TRIGGER coin_not_mixed BEFORE INSERT ON "CoinTransaction" FOR EACH ROW EXECUTE FUNCTION prevent_mixed_reward_sources();
