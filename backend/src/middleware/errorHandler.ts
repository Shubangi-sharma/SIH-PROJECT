/**
 * Centralized error handling (§6): every error leaves the API in the same
 * shape — { error: string } — with a safe message. Stack traces, env vars,
 * and upstream bodies are logged server-side and NEVER returned.
 */

import { ErrorRequestHandler, RequestHandler } from "express";
import { httpLog } from "../lib/logger.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = typeof (err as { status?: number }).status === "number" ? (err as { status: number }).status : 500;
  const isClientError = status >= 400 && status < 500;

  if (!isClientError) {
    httpLog.error({ err, path: req.path }, "unhandled error");
  } else {
    httpLog.warn({ path: req.path, status }, "client error");
  }

  // Never leak internals: only intentional, client-safe messages survive.
  const message = isClientError && err instanceof Error && err.message ? err.message : "Internal Server Error";
  if (res.headersSent) return;
  res.status(status).json({ error: message });
};
