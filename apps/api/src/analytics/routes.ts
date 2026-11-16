import { Router } from "express";
import { z } from "zod";
import { analyticsRangeSchema, localDateSchema } from "@habitquest/shared";
import { requireAuth, type AppDependencies } from "../auth.js";
import { ApiError } from "../errors.js";
import { analyticsReport, dayDetails } from "./service.js";
export function analyticsRouter(deps: AppDependencies) {
  const router = Router();
  router.use(requireAuth(deps));
  router.get("/", async (req, res) =>
    res.json(
      await analyticsReport(
        deps,
        req.auth!.user.id,
        analyticsRangeSchema.parse(req.query),
      ),
    ),
  );
  router.get("/overview", async (req, res) => {
    const r = await analyticsReport(
      deps,
      req.auth!.user.id,
      analyticsRangeSchema.parse(req.query),
    );
    res.json({
      from: r.from,
      to: r.to,
      timezone: r.timezone,
      overview: r.overview,
    });
  });
  router.get("/heatmap", async (req, res) => {
    const r = await analyticsReport(
      deps,
      req.auth!.user.id,
      analyticsRangeSchema.parse(req.query),
    );
    res.json({ from: r.from, to: r.to, timezone: r.timezone, daily: r.daily });
  });
  router.get("/trends", async (req, res) => {
    const r = await analyticsReport(
      deps,
      req.auth!.user.id,
      analyticsRangeSchema.parse(req.query),
    );
    res.json({
      from: r.from,
      to: r.to,
      timezone: r.timezone,
      weekly: r.weekly,
      monthly: r.monthly,
    });
  });
  router.get("/days/:date", async (req, res) => {
    const date = localDateSchema.parse(req.params.date);
    const r = await dayDetails(deps, req.auth!.user.id, date);
    res.json(r);
  });
  router.get("/habits/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const r = await analyticsReport(
      deps,
      req.auth!.user.id,
      analyticsRangeSchema.parse(req.query),
      id,
    );
    if (!r.habits[0]) throw new ApiError(404, "NOT_FOUND", "Habit not found.");
    res.json({
      from: r.from,
      to: r.to,
      timezone: r.timezone,
      habit: r.habits[0],
      history: r.history ?? [],
    });
  });
  return router;
}
