"use client";

/**
 * PYROSENSE — ML service API client (pyrosense_ml, FastAPI).
 *
 * Transport is ALWAYS the Node backend's pass-through proxy (POST
 * /api/predict, GET /api/ml/hotspots) — the browser never talks to the ML
 * service directly and never sees a second origin. The DTOs below mirror
 * pyrosense_ml's FastAPI responses verbatim (docs/api-contract.md):
 * the backend proxies pass-through, so this is the single definition.
 *
 * The frontend never engineers features and never fills the 36-feature
 * schema: Predict sends only latitude/longitude (+ optional region tag) and
 * pyrosense_ml's auto-mode does the rest. Leakage columns (label, risk_score,
 * confidence, …) are rejected upstream with 422 and are never rendered here.
 *
 * Vocabulary guard: everything in this module is the ML model's world —
 * `MODEL_CLASSES` are "Predicted Hotspot Category" values. The monitoring
 * backend's rule-based risk vocabulary (normal/watch/suspicious/critical)
 * lives in lib/types.ts and must stay separate.
 */

import { API_BASE } from "./api";

/* ------------------------------------------------------------------ */
/* base url                                                            */
/* ------------------------------------------------------------------ */

/** ML calls ride the Node backend proxy; same origin knob as lib/api.ts. */
export const ML_PROXY_BASE = API_BASE;

/* ------------------------------------------------------------------ */
/* DTOs (mirror pyrosense_ml/app/api/predict.py + hotspots.py)          */
/* ------------------------------------------------------------------ */

/**
 * The trained model's 4 output classes — feature_schema.py MODEL_CLASSES,
 * exact order of predict_proba columns. NOT the monitoring risk vocabulary.
 */
export const MODEL_CLASSES = [
  "Agricultural_Vegetation",
  "Industrial",
  "Mining_Extraction",
  "Other_Persistent_Thermal_Source",
] as const;

export type ModelClass = (typeof MODEL_CLASSES)[number];

/** Human labels for the model's classes (PDF §8 wording). */
export const MODEL_CLASS_LABELS: Record<ModelClass, string> = {
  Agricultural_Vegetation: "Agricultural Vegetation",
  Industrial: "Industrial",
  Mining_Extraction: "Mining Extraction",
  Other_Persistent_Thermal_Source: "Other Persistent Thermal Source",
};

/** One key driver of a prediction (deviation × importance ranking, top-5). */
export interface ContributingFeatureDto {
  feature: string;
  value: number | string;
  importance: number;
}

/**
 * POST /predict response — verbatim from predict_endpoint (predict.py).
 * Risk score (0–100) is the ML service's weighted-probability derivation;
 * the monitoring backend's risk score (command view) is a separate concept.
 */
export interface PredictionResponseDto {
  hotspot_id: string;
  /** Predicted Hotspot Category — one of MODEL_CLASSES. */
  class: ModelClass;
  probabilities: Record<ModelClass, number>;
  risk_score: number;
  /** Winning-class probability (0–1). */
  confidence: number;
  top_contributing_features: ContributingFeatureDto[];
  /** Grounded GenAI narrative, or deterministic template fallback. */
  explanation: string;
  /** "openrouter" when LLM-generated, "template" for the fallback. */
  explanation_provenance: string;
  source: string;
  model_version: string;
  dataset_version: string;
  feature_schema_version: string;
  /** ISO-8601 UTC with tz offset. */
  prediction_timestamp: string;
  /** Per-block feature source (sqlite / overpass / dynamic_world / …). */
  feature_provenance: Record<string, string>;
  /** Honest degradation notices (median fallbacks), shown in the UI. */
  warnings: string[];
}

/** GET /hotspots summary row (map-ready, latest prediction per hotspot). */
export interface MlHotspotSummaryDto {
  hotspot_id: string;
  latitude: number;
  longitude: number;
  class: ModelClass;
  confidence: number;
  risk_score: number;
  source: string;
  model_version: string;
}

export interface MlHotspotsResponseDto {
  count: number;
  hotspots: MlHotspotSummaryDto[];
}

/** GET /health response (pyrosense_ml self-report). */
export interface MlHealthDto {
  status: string;
  service: string;
  model_loaded: boolean;
  postgres_connected: boolean;
  model_version: string;
  dataset_version: string;
  feature_schema_version: string;
  feature_count: number;
}

/* ------------------------------------------------------------------ */
/* fetchers                                                            */
/* ------------------------------------------------------------------ */

export class MlApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MlApiError";
  }
}

async function fetchMlJson<T>(path: string): Promise<T> {
  const res = await fetch(`${ML_PROXY_BASE}${path}`);
  if (!res.ok) {
    let detail = `ML proxy ${res.status} for ${path}`;
    try {
      const body = (await res.json()) as { error?: string; detail?: unknown };
      // FastAPI 422 validation errors carry a detail[] array.
      if (typeof body.error === "string") detail = body.error;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d) => JSON.stringify(d)).join("; ");
    } catch {
      /* keep the generic detail */
    }
    throw new MlApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

/**
 * POST /api/predict — auto mode: coordinates only; the ML service engineers
 * the remaining 35 features server-side (§6–§7 of the SIH brief). `region`
 * is an optional tag persisted with the hotspot.
 */
export async function postPredict(
  latitude: number,
  longitude: number,
  region?: string,
): Promise<PredictionResponseDto> {
  const res = await fetch(`${ML_PROXY_BASE}/api/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(region ? { latitude, longitude, region } : { latitude, longitude }),
  });
  if (!res.ok) {
    let detail = `ML proxy ${res.status} for /api/predict`;
    try {
      const body = (await res.json()) as { error?: string; detail?: unknown };
      if (typeof body.error === "string") detail = body.error;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d) => JSON.stringify(d)).join("; ");
    } catch {
      /* keep the generic detail */
    }
    throw new MlApiError(res.status, detail);
  }
  return (await res.json()) as PredictionResponseDto;
}

/** GET /api/ml/hotspots — stored hotspots (historical seed + live predicts). */
export function fetchMlHotspots(params?: {
  source?: "historical" | "live";
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
}): Promise<MlHotspotsResponseDto> {
  const qs = new URLSearchParams();
  if (params?.source) qs.set("source", params.source);
  if (params?.minLat != null) qs.set("min_lat", String(params.minLat));
  if (params?.maxLat != null) qs.set("max_lat", String(params.maxLat));
  if (params?.minLng != null) qs.set("min_lng", String(params.minLng));
  if (params?.maxLng != null) qs.set("max_lng", String(params.maxLng));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return fetchMlJson<MlHotspotsResponseDto>(`/api/ml/hotspots${suffix}`);
}

/** GET /api/ml/health — ML service availability probe. */
export function fetchMlHealth(): Promise<MlHealthDto> {
  return fetchMlJson<MlHealthDto>(`/api/ml/health`);
}

/* ------------------------------------------------------------------ */
/* presentation helpers (labels/colours only — no computation)          */
/* ------------------------------------------------------------------ */

/** Muted category colours, distinct from the 5-tier risk palette. */
export const MODEL_CLASS_COLORS: Record<ModelClass, string> = {
  Agricultural_Vegetation: "#B99B5E",
  Industrial: "#C08A62",
  Mining_Extraction: "#9186C4",
  Other_Persistent_Thermal_Source: "#5CA0AD",
};
