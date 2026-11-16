import type { ShopReward, Purchase, PurchaseReceipt } from "@habitquest/shared";
import type {
  Prisma,
  Reward,
  RewardRedemption,
  RedemptionStatus,
} from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
import { lockUser, type AppDependencies, type AuthUser } from "../auth.js";
import { balances, progressionSnapshot } from "../progression/service.js";
export function rewardDto(reward: Reward, balance: number): ShopReward {
  return {
    id: reward.id,
    title: reward.title,
    description: reward.description,
    coinCost: reward.coinCost,
    category: reward.category as ShopReward["category"],
    icon: reward.icon as ShopReward["icon"],
    createdAt: reward.createdAt?.toISOString() ?? null,
    updatedAt: reward.updatedAt?.toISOString() ?? null,
    archivedAt: reward.archivedAt?.toISOString() ?? null,
    affordable: !reward.archivedAt && balance >= reward.coinCost,
  };
}
export function purchaseDto(row: RewardRedemption): Purchase {
  return {
    id: row.id,
    rewardId: row.rewardId,
    title: row.rewardTitle,
    description: row.rewardDescription,
    category: row.rewardCategory,
    icon: row.rewardIcon as Purchase["icon"],
    coinCost: row.coinCost,
    status: row.lifecycleManaged ? row.status : null,
    managed: row.lifecycleManaged,
    createdAt: row.createdAt.toISOString(),
    fulfilledAt: row.fulfilledAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
  };
}
export async function ownedReward(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
) {
  const reward = await tx.reward.findFirst({ where: { id, userId } });
  if (!reward) throw new ApiError(404, "NOT_FOUND", "Reward not found.");
  return reward;
}
const keyFor = (userId: string, key: string) => `purchase:${userId}:${key}`;
async function receipt(
  tx: Prisma.TransactionClient,
  user: AuthUser,
  now: Date,
  row: RewardRedemption,
  changed: boolean,
): Promise<PurchaseReceipt> {
  const progression = await progressionSnapshot(tx, user, now);
  return {
    redemption: purchaseDto(row),
    balance: progression.coins,
    changed,
    progression,
  };
}
export async function redeem(
  deps: AppDependencies,
  userId: string,
  rewardId: string,
  input: { idempotencyKey: string; expectedCoinCost: number },
) {
  return deps.database().$transaction(
    async (tx) => {
      const user = await lockUser(tx, userId);
      const reward = await ownedReward(tx, userId, rewardId);
      const now = deps.now();
      const key = keyFor(userId, input.idempotencyKey);
      const prior = await tx.rewardRedemption.findUnique({
        where: { idempotencyKey: key },
      });
      if (prior) {
        if (
          prior.userId !== userId ||
          prior.rewardId !== rewardId ||
          prior.coinCost !== input.expectedCoinCost
        )
          throw new ApiError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This request key was already used for another purchase intent.",
          );
        return receipt(tx, user, now, prior, false);
      }
      if (reward.archivedAt)
        throw new ApiError(
          409,
          "REWARD_ARCHIVED",
          "This reward has been archived.",
        );
      if (reward.coinCost !== input.expectedCoinCost)
        throw new ApiError(
          409,
          "PRICE_CHANGED",
          "The price changed. Review the updated reward before purchasing.",
        );
      const funds = await balances(tx, userId);
      if (funds.coins < reward.coinCost)
        throw new ApiError(
          409,
          "INSUFFICIENT_COINS",
          "You do not have enough coins for this reward.",
        );
      const row = await tx.rewardRedemption.create({
        data: {
          userId,
          rewardId,
          coinCost: reward.coinCost,
          rewardTitle: reward.title,
          rewardDescription: reward.description,
          rewardCategory: reward.category,
          rewardIcon: reward.icon,
          idempotencyKey: key,
          lifecycleManaged: true,
          status: "PENDING",
          createdAt: now,
        },
      });
      await tx.redemptionEvent.create({
        data: { redemptionId: row.id, status: "PENDING", createdAt: now },
      });
      await tx.coinTransaction.create({
        data: {
          userId,
          redemptionId: row.id,
          amount: -row.coinCost,
          reason: "Personal reward purchase",
          idempotencyKey: `purchase:${row.id}:debit`,
          createdAt: now,
        },
      });
      return receipt(tx, user, now, row, true);
    },
    { maxWait: 10000, timeout: 20000 },
  );
}
export async function transitionPurchase(
  deps: AppDependencies,
  userId: string,
  id: string,
  next: "FULFILLED" | "CANCELED",
) {
  return deps.database().$transaction(
    async (tx) => {
      const user = await lockUser(tx, userId);
      const now = deps.now();
      const row = await tx.rewardRedemption.findFirst({
        where: { id, userId },
      });
      if (!row) throw new ApiError(404, "NOT_FOUND", "Redemption not found.");
      if (!row.lifecycleManaged)
        throw new ApiError(
          409,
          "LEGACY_REDEMPTION",
          "This legacy snapshot has no managed lifecycle and requires audited reconciliation.",
        );
      if (row.status === next) return receipt(tx, user, now, row, false);
      if (row.status !== "PENDING")
        throw new ApiError(
          409,
          "TERMINAL_REDEMPTION",
          row.status === "FULFILLED"
            ? "A fulfilled reward cannot be canceled."
            : "A canceled reward cannot be fulfilled.",
        );
      if (next === "CANCELED")
        await tx.coinTransaction.create({
          data: {
            userId,
            refundRedemptionId: row.id,
            amount: row.coinCost,
            reason: "Personal reward cancellation refund",
            idempotencyKey: `purchase:${row.id}:refund`,
            createdAt: now,
          },
        });
      const changed = await tx.rewardRedemption.update({
        where: { id },
        data: {
          status: next,
          ...(next === "CANCELED" ? { canceledAt: now } : { fulfilledAt: now }),
        },
      });
      await tx.redemptionEvent.create({
        data: { redemptionId: id, status: next, createdAt: now },
      });
      return receipt(tx, user, now, changed, true);
    },
    { maxWait: 10000, timeout: 20000 },
  );
}
export type PurchaseStatus = RedemptionStatus;
