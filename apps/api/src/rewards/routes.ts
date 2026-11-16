import { Router } from "express";
import { z } from "zod";
import {
  rewardInputSchema,
  rewardPatchSchema,
  rewardCategorySchema,
  redeemInputSchema,
} from "@habitquest/shared";
import { requireAuth, lockUser, type AppDependencies } from "../auth.js";
import { ApiError } from "../errors.js";
import { balances } from "../progression/service.js";
import {
  ownedReward,
  rewardDto,
  purchaseDto,
  redeem,
  transitionPurchase,
} from "./service.js";
const listing = z
  .object({
    status: z.enum(["active", "archived", "all"]).default("active"),
    category: rewardCategorySchema.optional(),
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(24),
  })
  .strict();
const history = z
  .object({
    status: z.enum(["PENDING", "FULFILLED", "CANCELED"]).optional(),
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export function rewardsRouter(deps: AppDependencies) {
  const router = Router();
  router.use(requireAuth(deps));
  router.get("/", async (req, res) => {
    const input = listing.parse(req.query);
    const userId = req.auth!.user.id;
    const result = await deps.database().$transaction(
      async (tx) => {
        if (input.cursor) await ownedReward(tx, userId, input.cursor);
        const rows = await tx.reward.findMany({
          where: {
            userId,
            ...(input.status === "all"
              ? {}
              : {
                  archivedAt: input.status === "active" ? null : { not: null },
                }),
            category: input.category,
          },
          orderBy: [
            { createdAt: { sort: "desc", nulls: "last" } },
            { id: "desc" },
          ],
          take: input.limit + 1,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        });
        const funds = await balances(tx, userId);
        const page = rows.slice(0, input.limit);
        return {
          rewards: page.map((r) => rewardDto(r, funds.coins)),
          balance: funds.coins,
          nextCursor: rows.length > input.limit ? page.at(-1)!.id : null,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
    res.json(result);
  });
  router.post("/", async (req, res) => {
    const input = rewardInputSchema.parse(req.body);
    const userId = req.auth!.user.id;
    const reward = await deps.database().$transaction(async (tx) => {
      await lockUser(tx, userId);
      const now = deps.now();
      const row = await tx.reward.create({
        data: {
          userId,
          ...input,
          description: input.description || null,
          icon: input.icon ?? null,
          createdAt: now,
          updatedAt: now,
        },
      });
      return rewardDto(row, (await balances(tx, userId)).coins);
    });
    res.status(201).json({ reward });
  });
  router.get("/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const result = await deps
      .database()
      .$transaction(
        async (tx) =>
          rewardDto(
            await ownedReward(tx, req.auth!.user.id, id),
            (await balances(tx, req.auth!.user.id)).coins,
          ),
        { isolationLevel: "RepeatableRead" },
      );
    res.json({ reward: result });
  });
  router.patch("/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = rewardPatchSchema.parse(req.body);
    const userId = req.auth!.user.id;
    const reward = await deps.database().$transaction(async (tx) => {
      await lockUser(tx, userId);
      await ownedReward(tx, userId, id);
      const now = deps.now();
      const row = await tx.reward.update({
        where: { id },
        data: {
          title: input.title,
          description:
            input.description === undefined
              ? undefined
              : input.description || null,
          category: input.category,
          icon: input.icon,
          coinCost: input.coinCost,
          archivedAt:
            input.archived === undefined
              ? undefined
              : input.archived
                ? now
                : null,
          updatedAt: now,
        },
      });
      return rewardDto(row, (await balances(tx, userId)).coins);
    });
    res.json({ reward });
  });
  router.delete("/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    await deps.database().$transaction(async (tx) => {
      await lockUser(tx, req.auth!.user.id);
      const row = await ownedReward(tx, req.auth!.user.id, id);
      if (!row.archivedAt)
        await tx.reward.update({
          where: { id },
          data: { archivedAt: deps.now(), updatedAt: deps.now() },
        });
    });
    res.status(204).end();
  });
  router.post("/:id/redemptions", async (req, res) => {
    const result = await redeem(
      deps,
      req.auth!.user.id,
      z.uuid().parse(req.params.id),
      redeemInputSchema.parse(req.body),
    );
    res.status(result.changed ? 201 : 200).json(result);
  });
  return router;
}
export function redemptionsRouter(deps: AppDependencies) {
  const router = Router();
  router.use(requireAuth(deps));
  router.get("/", async (req, res) => {
    const input = history.parse(req.query);
    const userId = req.auth!.user.id;
    if (
      input.cursor &&
      !(await deps
        .database()
        .rewardRedemption.findFirst({ where: { id: input.cursor, userId } }))
    )
      throw new ApiError(404, "NOT_FOUND", "Redemption cursor not found.");
    const rows = await deps.database().rewardRedemption.findMany({
      where: {
        userId,
        ...(input.status
          ? { status: input.status, lifecycleManaged: true }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, input.limit);
    res.json({
      redemptions: page.map(purchaseDto),
      nextCursor: rows.length > input.limit ? page.at(-1)!.id : null,
    });
  });
  router.post("/:id/cancel", async (req, res) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    res.json(
      await transitionPurchase(
        deps,
        req.auth!.user.id,
        z.uuid().parse(req.params.id),
        "CANCELED",
      ),
    );
  });
  router.post("/:id/fulfill", async (req, res) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    res.json(
      await transitionPurchase(
        deps,
        req.auth!.user.id,
        z.uuid().parse(req.params.id),
        "FULFILLED",
      ),
    );
  });
  return router;
}
