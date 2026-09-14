/**
 * Structured request logging (§6): one pino line per request with method,
 * path, status, and duration. Secrets are redacted at the logger level.
 */

import { NextFunction, Request, Response } from "express";
import { httpLog } from "../lib/logger.js";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    httpLog.info(
      {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms: Math.round(ms),
      },
      "request",
    );
  });
  next();
}
