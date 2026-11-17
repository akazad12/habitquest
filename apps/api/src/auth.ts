import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { parse, serialize } from "cookie";
import * as argon2 from "argon2";
import type { Request, Response, RequestHandler } from "express";
import { Router } from "express";
import { PostgresRateLimitStore } from "./rate-limit-store.js";
import { rateLimit } from "express-rate-limit";
import { loginSchema, registerSchema, profileSchema } from "@habitquest/shared";
import {
  Prisma,
  type PrismaClient,
  type User,
  type Session,
} from "./generated/prisma/client.js";
import { ApiError } from "./errors.js";
export type AuthUser = Pick<User, "id" | "displayName" | "email" | "timezone">;
export const publicSelect = {
  id: true,
  displayName: true,
  email: true,
  timezone: true,
} as const;
declare module "express-serve-static-core" {
  interface Request {
    auth?: { user: AuthUser; session: Session };
  }
}
export type AppDependencies = {
  database: () => PrismaClient;
  now: () => Date;
  production: boolean;
  sessionDays: number;
  origin: string;
  authLimit: number;
  rateLimitSecret?: string;
};
const hashing: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};
let dummyHash: Promise<string> | undefined;
export const hashPassword = (password: string) =>
  argon2.hash(password, hashing);
export const digestToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const cookieName = (production: boolean) =>
  production ? "__Host-habitquest" : "habitquest";
export function readSessionToken(req: Request, production: boolean) {
  const token = parse(req.headers.cookie || "")[cookieName(production)];
  return token && /^[a-f0-9]{64}$/.test(token) ? token : undefined;
}
function setCookie(
  res: Response,
  token: string,
  deps: AppDependencies,
  expires: Date,
) {
  res.append(
    "Set-Cookie",
    serialize(cookieName(deps.production), token, {
      httpOnly: true,
      secure: deps.production,
      sameSite: "lax",
      path: "/",
      expires,
    }),
  );
}
export function clearSessionCookie(res: Response, deps: AppDependencies) {
  setCookie(res, "", deps, new Date(0));
}
export function requireAuth(deps: AppDependencies): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = readSessionToken(req, deps.production);
      if (!token)
        throw new ApiError(
          401,
          "UNAUTHENTICATED",
          "Please sign in to continue.",
        );
      const session = await deps.database().session.findUnique({
        where: { tokenHash: digestToken(token) },
        include: { user: { select: publicSelect } },
      });
      if (!session || session.expiresAt <= deps.now()) {
        if (session)
          await deps
            .database()
            .session.deleteMany({ where: { id: session.id } });
        clearSessionCookie(res, deps);
        throw new ApiError(
          401,
          "UNAUTHENTICATED",
          "Your session has expired. Please sign in.",
        );
      }
      req.auth = { user: session.user, session };
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const token = req.get("X-CSRF-Token");
        if (
          !token ||
          !/^[a-f0-9]{64}$/.test(token) ||
          !timingSafeEqual(Buffer.from(token), Buffer.from(session.csrfToken))
        )
          throw new ApiError(
            403,
            "CSRF_REJECTED",
            "Security check failed. Refresh the page and try again.",
          );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
export async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId}::uuid FOR UPDATE`;
  return tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: publicSelect,
  });
}
export function authRouter(deps: AppDependencies) {
  const router = Router();
  const limiter = rateLimit({
    store:
      deps.production && deps.rateLimitSecret
        ? new PostgresRateLimitStore(deps.database, deps.rateLimitSecret!, "ip")
        : undefined,
    windowMs: 15 * 60 * 1000,
    limit: deps.authLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Too many attempts. Please try again later.",
      },
    },
  });
  const accountLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store:
      deps.production && deps.rateLimitSecret
        ? new PostgresRateLimitStore(
            deps.database,
            deps.rateLimitSecret!,
            "account",
          )
        : undefined,
    keyGenerator: (req) =>
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase().slice(0, 254)
        : "invalid",
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Too many attempts. Please try again later.",
      },
    },
  });
  const limits = deps.production ? [limiter, accountLimiter] : [limiter];
  async function establish(
    req: Request,
    user: AuthUser,
    tx: Prisma.TransactionClient,
  ) {
    const old = readSessionToken(req, deps.production);
    if (old)
      await tx.session.deleteMany({ where: { tokenHash: digestToken(old) } });
    const token = randomBytes(32).toString("hex");
    const csrfToken = randomBytes(32).toString("hex");
    const createdAt = deps.now();
    const expiresAt = new Date(
      createdAt.getTime() + deps.sessionDays * 86400000,
    );
    await tx.session.create({
      data: {
        userId: user.id,
        tokenHash: digestToken(token),
        csrfToken,
        createdAt,
        expiresAt,
      },
    });
    // Cookie is emitted only after the surrounding transaction commits.
    return { user, csrfToken, token, expiresAt };
  }
  router.post("/register", ...limits, async (req, res) => {
    const input = registerSchema.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    try {
      const result = await deps.database().$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            displayName: input.displayName,
            timezone: input.timezone,
            passwordHash,
          },
          select: publicSelect,
        });
        return establish(req, user, tx);
      });
      setCookie(res, result.token, deps, result.expiresAt);
      res.status(201).json({ user: result.user, csrfToken: result.csrfToken });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ApiError(
          409,
          "EMAIL_IN_USE",
          "An account with this email already exists.",
        );
      throw error;
    }
  });
  router.post("/login", ...limits, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const db = deps.database();
    const user = await db.user.findUnique({ where: { email: input.email } });
    dummyHash ??= hashPassword(randomBytes(32).toString("hex"));
    const fallbackHash = await dummyHash;
    const valid = await argon2.verify(
      user?.passwordHash ?? fallbackHash,
      input.password,
    );
    if (!user || !user.passwordHash || !valid)
      throw new ApiError(
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect.",
      );
    const result = await db.$transaction((tx) =>
      establish(
        req,
        {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          timezone: user.timezone,
        },
        tx,
      ),
    );
    setCookie(res, result.token, deps, result.expiresAt);
    res.json({ user: result.user, csrfToken: result.csrfToken });
  });
  router.get("/me", requireAuth(deps), (req, res) =>
    res.json({ user: req.auth!.user, csrfToken: req.auth!.session.csrfToken }),
  );
  router.post("/logout", requireAuth(deps), async (req, res) => {
    await deps
      .database()
      .session.deleteMany({ where: { id: req.auth!.session.id } });
    clearSessionCookie(res, deps);
    res.status(204).end();
  });
  router.patch("/profile", requireAuth(deps), async (req, res) => {
    const input = profileSchema.parse(req.body);
    const user = await deps.database().$transaction(async (tx) => {
      await lockUser(tx, req.auth!.user.id);
      return tx.user.update({
        where: { id: req.auth!.user.id },
        data: input,
        select: publicSelect,
      });
    });
    res.json({ user });
  });
  return router;
}
