/**
 * Rate limiting & backpressure (§6) — express-rate-limit on all public
 * routes. The AI summary endpoint gets its own tighter bucket since it can
 * trigger upstream provider calls on cache misses.
 */

import rateLimit from "express-rate-limit";

/** General API bucket: generous for a dashboard, hostile to scrapers. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests — slow down." },
});

/** Summary bucket: cache misses cost an upstream AI call. */
export const summaryLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Summary rate limit exceeded — retry shortly." },
});
