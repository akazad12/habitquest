import { rewardsRouter, redemptionsRouter } from "./rewards/routes.js";
import { analyticsRouter } from "./analytics/routes.js";
import { progressionRouter } from "./progression/routes.js";
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { ZodError } from "zod";
import { createDatabase } from "./db.js";
import { authRouter, type AppDependencies } from "./auth.js";
import { habitsRouter } from "./habits.js";
import { ApiError } from "./errors.js";
import { Prisma } from "./generated/prisma/client.js";
import { healthSchema } from "@habitquest/shared";
export function createApp(
  origin = "http://localhost:5173",
  options: Partial<AppDependencies> = {},
) {
  let db: ReturnType<typeof createDatabase> | undefined;
  const deps: AppDependencies = {
    database: () => (db ??= createDatabase()),
    now: () => new Date(),
    production: process.env.NODE_ENV === "production",
    sessionDays: 7,
    origin,
    authLimit: 20,
    ...options,
  };
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: deps.origin, credentials: true }));
  app.use(express.json({ limit: "32kb" }));
  // Liveness only: deliberately does not imply database readiness.
  app.get("/api/health", (_req, res) =>
    res.json(healthSchema.parse({ status: "ok", service: "habitquest-api" })),
  );
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("Origin") !== deps.origin
    ) {
      next(
        new ApiError(403, "CSRF_REJECTED", "Request origin is not allowed."),
      );
      return;
    }
    next();
  });
  app.use("/api/auth", authRouter(deps));
  app.use("/api/habits", habitsRouter(deps));
  app.use("/api/progression", progressionRouter(deps));
  app.use("/api/rewards", rewardsRouter(deps));
  app.use("/api/redemptions", redemptionsRouter(deps));
  app.use("/api/analytics", analyticsRouter(deps));
  app.use((_req, res) =>
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "Route not found" } }),
  );
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof ApiError) {
      res
        .status(error.status)
        .json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2003", "P2034"].includes(error.code)
    ) {
      res.status(409).json({
        error: {
          code: "CONFLICT",
          message: "The record changed. Refresh and try again.",
        },
      });
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          issues: error.issues,
        },
      });
      return;
    }
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number(error.status)
        : 500;
    if (status >= 400 && status < 500) {
      res.status(status).json({
        error: {
          code: "BAD_REQUEST",
          message: "Request could not be processed",
        },
      });
      return;
    }
    console.error("Unhandled API error", {
      name: error instanceof Error ? error.name : "Unknown",
      code:
        error instanceof Prisma.PrismaClientKnownRequestError
          ? error.code
          : undefined,
    });
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    });
  };
  app.use(errors);
  return app;
}
