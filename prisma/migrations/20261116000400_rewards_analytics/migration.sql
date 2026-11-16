-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('PENDING', 'FULFILLED', 'CANCELED');

-- AlterTable
ALTER TABLE "CoinTransaction" ADD COLUMN     "refundRedemptionId" UUID;

-- AlterTable
ALTER TABLE "Reward" ADD COLUMN     "category" VARCHAR(50) NOT NULL DEFAULT 'Personal',
ADD COLUMN     "createdAt" TIMESTAMPTZ(3),
ADD COLUMN     "description" VARCHAR(1000),
ADD COLUMN     "icon" VARCHAR(30),
ADD COLUMN     "updatedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "RewardRedemption" ADD COLUMN     "canceledAt" TIMESTAMPTZ(3),
ADD COLUMN     "fulfilledAt" TIMESTAMPTZ(3),
ADD COLUMN     "lifecycleManaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rewardCategory" VARCHAR(50),
ADD COLUMN     "rewardDescription" VARCHAR(1000),
ADD COLUMN     "rewardIcon" VARCHAR(30),
ADD COLUMN     "status" "RedemptionStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "RedemptionEvent" (
    "id" UUID NOT NULL,
    "redemptionId" UUID NOT NULL,
    "status" "RedemptionStatus" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedemptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RedemptionEvent_redemptionId_status_key" ON "RedemptionEvent"("redemptionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CoinTransaction_refundRedemptionId_key" ON "CoinTransaction"("refundRedemptionId");

-- CreateIndex
CREATE UNIQUE INDEX "CoinTransaction_refundRedemptionId_userId_key" ON "CoinTransaction"("refundRedemptionId", "userId");

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_refundRedemptionId_userId_fkey" FOREIGN KEY ("refundRedemptionId", "userId") REFERENCES "RewardRedemption"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedemptionEvent" ADD CONSTRAINT "RedemptionEvent_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "RewardRedemption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Existing snapshots remain unchanged; lifecycleManaged=false identifies unknown legacy lifecycle.
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_category_valid" CHECK (category IN ('Personal','Relaxation','Food','Entertainment','Adventure','Other')),
 ADD CONSTRAINT "Reward_icon_valid" CHECK (icon IS NULL OR icon IN ('gift','film','utensils','gamepad','coffee','sparkles','mountain','book'));
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "Redemption_lifecycle_dates" CHECK (
 (status='PENDING' AND "fulfilledAt" IS NULL AND "canceledAt" IS NULL)
 OR (status='FULFILLED' AND "fulfilledAt">="createdAt" AND "fulfilledAt" IS NOT NULL AND "canceledAt" IS NULL)
 OR (status='CANCELED' AND "canceledAt">="createdAt" AND "canceledAt" IS NOT NULL AND "fulfilledAt" IS NULL)
);
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "Coin_phase4_one_source" CHECK (num_nonnulls("completionId","redemptionId","refundRedemptionId","rewardEventId") <= 1);
DROP TRIGGER redemption_immutable ON "RewardRedemption";
CREATE FUNCTION protect_redemption_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT OLD."lifecycleManaged" OR
 ROW(NEW.id,NEW."userId",NEW."rewardId",NEW."coinCost",NEW."rewardTitle",NEW."rewardDescription",NEW."rewardCategory",NEW."rewardIcon",NEW."idempotencyKey",NEW."createdAt",NEW."lifecycleManaged") IS DISTINCT FROM
 ROW(OLD.id,OLD."userId",OLD."rewardId",OLD."coinCost",OLD."rewardTitle",OLD."rewardDescription",OLD."rewardCategory",OLD."rewardIcon",OLD."idempotencyKey",OLD."createdAt",OLD."lifecycleManaged")
 OR OLD.status<>'PENDING' OR NEW.status NOT IN ('FULFILLED','CANCELED') THEN
  RAISE EXCEPTION 'Purchase snapshots are immutable and terminal purchases cannot transition' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER redemption_snapshot BEFORE UPDATE ON "RewardRedemption" FOR EACH ROW EXECUTE FUNCTION protect_redemption_snapshot();
CREATE TRIGGER redemption_no_delete BEFORE DELETE ON "RewardRedemption" FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER redemption_event_immutable BEFORE UPDATE OR DELETE ON "RedemptionEvent" FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE FUNCTION validate_refund_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purchase "RewardRedemption";
BEGIN
 IF NEW."refundRedemptionId" IS NOT NULL THEN
  SELECT * INTO purchase FROM "RewardRedemption" WHERE id=NEW."refundRedemptionId";
  IF NOT purchase."lifecycleManaged" OR NEW."userId" IS DISTINCT FROM purchase."userId" OR NEW.amount IS DISTINCT FROM purchase."coinCost" THEN
   RAISE EXCEPTION 'Refund must match an owned managed purchase snapshot' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER coin_refund_source BEFORE INSERT ON "CoinTransaction" FOR EACH ROW EXECUTE FUNCTION validate_refund_source();
CREATE FUNCTION verify_purchase_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purchase "RewardRedemption"; target_id uuid; debit integer; refund integer; event_count bigint;
BEGIN
 IF TG_TABLE_NAME='RewardRedemption' THEN target_id=NEW.id;
 ELSIF TG_TABLE_NAME='RedemptionEvent' THEN target_id=NEW."redemptionId";
 ELSE target_id=coalesce(NEW."redemptionId",NEW."refundRedemptionId");
 END IF;
 IF target_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO purchase FROM "RewardRedemption" WHERE id=target_id;
 IF NOT purchase."lifecycleManaged" THEN RETURN NULL; END IF;
 SELECT amount INTO debit FROM "CoinTransaction" WHERE "redemptionId"=target_id;
 SELECT amount INTO refund FROM "CoinTransaction" WHERE "refundRedemptionId"=target_id;
 SELECT count(*) INTO event_count FROM "RedemptionEvent" WHERE "redemptionId"=target_id;
 IF debit IS DISTINCT FROM -purchase."coinCost"
 OR NOT EXISTS(SELECT 1 FROM "RedemptionEvent" WHERE "redemptionId"=target_id AND status='PENDING' AND "createdAt"=purchase."createdAt")
 OR event_count<>(CASE WHEN purchase.status='PENDING' THEN 1 ELSE 2 END)
 OR (purchase.status='CANCELED' AND (refund IS DISTINCT FROM purchase."coinCost" OR NOT EXISTS(SELECT 1 FROM "RedemptionEvent" WHERE "redemptionId"=target_id AND status='CANCELED' AND "createdAt"=purchase."canceledAt")))
 OR (purchase.status<>'CANCELED' AND refund IS NOT NULL)
 OR (purchase.status='FULFILLED' AND NOT EXISTS(SELECT 1 FROM "RedemptionEvent" WHERE "redemptionId"=target_id AND status='FULFILLED' AND "createdAt"=purchase."fulfilledAt")) THEN
  RAISE EXCEPTION 'Purchase, debit, refund, and lifecycle audit must agree at commit' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER purchase_consistency AFTER INSERT OR UPDATE ON "RewardRedemption" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_purchase_consistency();
CREATE CONSTRAINT TRIGGER purchase_event_consistency AFTER INSERT ON "RedemptionEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_purchase_consistency();
CREATE CONSTRAINT TRIGGER purchase_ledger_consistency AFTER INSERT ON "CoinTransaction" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_purchase_consistency();
-- Supporting time- and ownership-bounded history reads.
CREATE INDEX "HabitCompletion_scheduledDate_idx" ON "HabitCompletion"("scheduledDate");
