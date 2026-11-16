-- Additive Phase 2 migration. No tables or history are reset.
CREATE TYPE "Difficulty" AS ENUM ('EASY','MEDIUM','HARD');
CREATE TYPE "RecurrenceKind" AS ENUM ('DAILY','WEEKDAYS','INTERVAL');
ALTER TABLE "User" ADD COLUMN "displayName" VARCHAR(80) NOT NULL DEFAULT 'HabitQuest member';
ALTER TABLE "User" ADD CONSTRAINT "User_displayName_nonempty" CHECK (length(btrim("displayName")) > 0);
ALTER TABLE "Habit" ADD COLUMN category VARCHAR(50) NOT NULL DEFAULT 'Personal', ADD COLUMN difficulty "Difficulty" NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "Habit" ADD CONSTRAINT "Habit_category_valid" CHECK (category IN ('Personal','Health','Fitness','Learning','Mindfulness','Work','Other'));
ALTER TABLE "HabitScheduleVersion" ADD COLUMN kind "RecurrenceKind" NOT NULL DEFAULT 'WEEKDAYS', ADD COLUMN "intervalDays" INTEGER, ADD COLUMN "anchorDate" DATE;
ALTER TABLE "HabitScheduleVersion" DROP CONSTRAINT "Schedule_weekdays_valid";
ALTER TABLE "HabitScheduleVersion" ADD CONSTRAINT "Schedule_rule_valid" CHECK (
 (kind = 'WEEKDAYS' AND valid_weekdays(weekdays) AND "intervalDays" IS NULL AND "anchorDate" IS NULL)
 OR (kind = 'DAILY' AND weekdays = ARRAY[1,2,3,4,5,6,7] AND "intervalDays" IS NULL AND "anchorDate" IS NULL)
 OR (kind = 'INTERVAL' AND cardinality(weekdays) = 0 AND "intervalDays" IS NOT NULL AND "intervalDays" BETWEEN 1 AND 365 AND "anchorDate" IS NOT NULL)
);
ALTER TABLE "HabitCompletion" ADD COLUMN "undoneAt" TIMESTAMPTZ(3), ADD COLUMN timezone VARCHAR(100) NOT NULL DEFAULT 'UTC';
-- Backfill provenance using the version that originally admitted each completion.
DROP TRIGGER completion_immutable ON "HabitCompletion";
UPDATE "HabitCompletion" c SET timezone = s.timezone FROM "HabitScheduleVersion" s WHERE c."scheduleVersionId" = s.id;
CREATE TRIGGER completion_timezone BEFORE INSERT OR UPDATE ON "HabitCompletion" FOR EACH ROW EXECUTE FUNCTION enforce_timezone();
CREATE TABLE "Session" (
 id UUID NOT NULL PRIMARY KEY,
 "tokenHash" CHAR(64) NOT NULL UNIQUE,
 "csrfToken" CHAR(64) NOT NULL,
 "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "Session_expiry_valid" CHECK ("expiresAt" > "createdAt")
);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE FUNCTION schedule_is_due(rule "RecurrenceKind", days integer[], every integer, anchor date, local_date date) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE rule WHEN 'DAILY' THEN true WHEN 'WEEKDAYS' THEN extract(isodow FROM local_date)::integer = ANY(days)
 WHEN 'INTERVAL' THEN local_date >= anchor AND (local_date - anchor) % every = 0 ELSE false END;
$$;
CREATE OR REPLACE FUNCTION enforce_completion_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE schedule "HabitScheduleVersion";
BEGIN
 SELECT * INTO schedule FROM "HabitScheduleVersion" WHERE id = NEW."scheduleVersionId" FOR SHARE;
 IF schedule.id IS NULL OR schedule."habitId" <> NEW."habitId" OR NEW."scheduledDate" < schedule."effectiveFrom"
 OR (schedule."effectiveUntil" IS NOT NULL AND NEW."scheduledDate" >= schedule."effectiveUntil")
 OR NOT schedule_is_due(schedule.kind,schedule.weekdays,schedule."intervalDays",schedule."anchorDate",NEW."scheduledDate") THEN
  RAISE EXCEPTION 'Completion must match its schedule and local date' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION protect_schedule_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW."habitId",NEW."effectiveFrom",NEW.timezone,NEW.weekdays,NEW.kind,NEW."intervalDays",NEW."anchorDate")
 IS DISTINCT FROM ROW(OLD.id,OLD."habitId",OLD."effectiveFrom",OLD.timezone,OLD.weekdays,OLD.kind,OLD."intervalDays",OLD."anchorDate") THEN
  RAISE EXCEPTION 'Create a new schedule version instead' USING ERRCODE = '23514';
 END IF;
 IF EXISTS (SELECT 1 FROM "HabitCompletion" WHERE "scheduleVersionId" = OLD.id AND "scheduledDate" >= NEW."effectiveUntil") THEN
  RAISE EXCEPTION 'Schedule change would invalidate history' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
-- Undo is a state transition, retaining the unique row and all historical identity.
CREATE FUNCTION protect_completion_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW."habitId",NEW."scheduleVersionId",NEW."scheduledDate",NEW."completedAt",NEW.timezone)
 IS DISTINCT FROM ROW(OLD.id,OLD."habitId",OLD."scheduleVersionId",OLD."scheduledDate",OLD."completedAt",OLD.timezone)
 OR EXISTS (SELECT 1 FROM "XpTransaction" WHERE "completionId" = OLD.id)
 OR EXISTS (SELECT 1 FROM "CoinTransaction" WHERE "completionId" = OLD.id) THEN
  RAISE EXCEPTION 'Only unrewarded completion state may change' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER completion_history BEFORE UPDATE ON "HabitCompletion" FOR EACH ROW EXECUTE FUNCTION protect_completion_history();
CREATE TRIGGER completion_no_delete BEFORE DELETE ON "HabitCompletion" FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
