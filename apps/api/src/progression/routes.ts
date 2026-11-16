import { Router } from "express";
import { freezeRequestSchema } from "@habitquest/shared";
import {
  requireAuth,
  lockUser,
  publicSelect,
  type AppDependencies,
} from "../auth.js";
import {
  consumeFreeze,
  progressionSnapshot,
  reconcileAchievements,
} from "./service.js";
export function progressionRouter(deps: AppDependencies) {
  const router = Router();
  router.use(requireAuth(deps));
  router.get("/", async (req, res) => {
    const result = await deps.database().$transaction(
      async (tx) => {
        const user = await tx.user.findUniqueOrThrow({
          where: { id: req.auth!.user.id },
          select: publicSelect,
        });
        return progressionSnapshot(tx, user, deps.now());
      },
      { isolationLevel: "RepeatableRead" },
    );
    res.json(result);
  });
  router.post("/reconcile", async (req, res) => {
    const result = await deps.database().$transaction(
      async (tx) => {
        const user = await lockUser(tx, req.auth!.user.id);
        const now = deps.now();
        await reconcileAchievements(tx, user, now);
        return progressionSnapshot(tx, user, now);
      },
      { maxWait: 10000, timeout: 20000 },
    );
    res.json(result);
  });
  router.post("/freezes", async (req, res) => {
    const input = freezeRequestSchema.parse(req.body);
    const result = await deps.database().$transaction(
      async (tx) => {
        const user = await lockUser(tx, req.auth!.user.id);
        return consumeFreeze(
          tx,
          user,
          input.habitId,
          input.scheduledDate,
          deps.now(),
        );
      },
      { maxWait: 10000, timeout: 20000 },
    );
    res.json(result);
  });
  return router;
}
