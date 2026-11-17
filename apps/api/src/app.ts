import { jsonLogger, requestLogging, type Logger } from "./observability.js";
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
  options: Partial<AppDependencies> & {
    logger?: Logger;
    trustProxyHops?: number;
    isDraining?: () => boolean;
    enforceHttps?: boolean;
  } = {},
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
  if (
    deps.production &&
    process.env.NODE_ENV !== "test" &&
    (!deps.rateLimitSecret ||
      deps.rateLimitSecret.length < 32 ||
      !deps.origin.startsWith("https://"))
  )
    throw new Error("Invalid production application security configuration");
  const log =
    options.logger ?? (process.env.NODE_ENV === "test" ? () => {} : jsonLogger);
  const app = express();
  app.set("trust proxy", options.trustProxyHops ?? false);
  app.use(requestLogging(log));
  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: deps.origin, credentials: true }));
  app.use((req, _res, next) => {
    if (
      (options.enforceHttps ??
        (deps.production && process.env.NODE_ENV !== "test")) &&
      !req.secure &&
      !["/api/health", "/api/ready"].includes(req.path)
    )
      return next(new ApiError(400, "HTTPS_REQUIRED", "HTTPS is required."));
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/ready", async (_req, res) => {
    if (options.isDraining?.()) {
      res.status(503).json({ status: "unavailable" });
      return;
    }
    try {
      await deps.database().$queryRaw`SELECT 1`;
      res.json({ status: "ready", service: "habitquest-api" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
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
    const code =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : undefined;
    const unavailable =
      error instanceof Prisma.PrismaClientInitializationError ||
      (code !== undefined &&
        ["P1001", "P1002", "P1008", "P1017", "P2024", "P2037"].includes(code));
    log({
      event: "api_error",
      requestId: String(res.locals.requestId),
      code: unavailable ? "DATABASE_UNAVAILABLE" : "INTERNAL_ERROR",
    });
    if (unavailable) {
      res
        .set("Retry-After", "5")
        .status(503)
        .json({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message:
              "The service is temporarily unavailable. Please try again.",
          },
        });
      return;
    }
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
