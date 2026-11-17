import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
export type LogEvent = Record<string, string | number | boolean | undefined>;
export type Logger = (event: LogEvent) => void;
export const jsonLogger: Logger = (event) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), ...event }));
export function requestLogging(log: Logger): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    const started = performance.now();
    res.locals.requestId = requestId;
    res.set("X-Request-ID", requestId);
    res.once("finish", () =>
      log({
        event: "http_request",
        requestId,
        method: req.method,
        route: req.route
          ? `${req.baseUrl}${String(req.route.path)}`
          : "unmatched",
        status: res.statusCode,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      }),
    );
    next();
  };
}
