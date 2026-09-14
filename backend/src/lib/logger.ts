/**
 * pino logger — structured, one instance for the whole backend.
 * Redaction keeps every secret path out of logs by construction.
 */

import pino from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "FIRMS_MAP_KEY",
      "OPENROUTER_API_KEY",
      "*.FIRMS_MAP_KEY",
      "*.OPENROUTER_API_KEY",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  base: undefined, // no pid/hostname noise
});

export const httpLog = logger.child({ module: "http" });
export const firmsLog = logger.child({ module: "firms" });
export const overpassLog = logger.child({ module: "overpass" });
export const scoringLog = logger.child({ module: "scoring" });
export const genaiLog = logger.child({ module: "genai" });
export const ingestLog = logger.child({ module: "ingest" });
export const dbLog = logger.child({ module: "db" });
