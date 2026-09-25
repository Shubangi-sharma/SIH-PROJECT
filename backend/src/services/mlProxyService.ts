/**
 * mlProxyService — thin pass-through proxy to the pyrosense_ml service.
 *
 * The Node backend is the frontend's single API origin (§1 architecture):
 * FIRMS, Overpass, scoring, and now ML inference are all reached through
 * backend:4000. This module forwards requests to pyrosense_ml (FastAPI,
 * default :5000) and returns the response body UNCHANGED — the frontend's
 * TypeScript types mirror the FastAPI response verbatim, so the contract is
 * defined exactly once (docs/api-contract.md).
 *
 * Timeouts are generous because /predict legitimately does real work:
 * feature engineering (Overpass + land cover + Open-Meteo), GBM inference,
 * GenAI explanation (provider chain + template fallback).
 */

import { env } from "../config/env.js";
import { httpRequest, GENAI_QUEUE } from "../lib/http.js";
import { logger } from "../lib/logger.js";

const log = logger.child({ module: "mlProxy" });

/** ML calls share the GenAI lane: inference can trigger provider calls too. */
const ML_TIMEOUT_MS = 120_000;

export interface MlProxyResult {
  status: number;
  /** Parsed JSON body exactly as pyrosense_ml returned it (pass-through). */
  body: unknown;
}

async function forward(
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<MlProxyResult> {
  const url = `${env.ML_API_BASE_URL.replace(/\/+$/, "")}${path}`;
  const { status, text } = await httpRequest(
    url,
    {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        // FastAPI only parses a Pydantic body when Content-Type is JSON.
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body,
    },
    { timeoutMs: ML_TIMEOUT_MS, allowHttpError: true },
  );

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: `pyrosense_ml returned non-JSON response (HTTP ${status})` };
  }
  return { status, body };
}

/** POST /predict — classify one hotspot (auto or expert mode). */
export async function proxyPredict(payload: unknown): Promise<MlProxyResult> {
  return GENAI_QUEUE(() =>
    forward("/predict", { method: "POST", body: JSON.stringify(payload) }),
  );
}

/** GET /hotspots — ML service's stored hotspots (historical + live). */
export function proxyHotspots(query: string): Promise<MlProxyResult> {
  const qs = query ? `?${query}` : "";
  return forward(`/hotspots${qs}`);
}

/**
 * GET /observations?lat=…&lng=… — live land-cover / surroundings / weather
 * for one point. Same engineering modules as /predict, but display-shaped:
 * nothing persisted, no inference, unknowns are null (never 0.0 priors).
 */
export function proxyObservations(lat: number, lng: number): Promise<MlProxyResult> {
  return forward(`/observations?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`);
}

/** GET /health — pyrosense_ml model/DB status. */
export function proxyMlHealth(): Promise<MlProxyResult> {
  return forward("/health");
}
