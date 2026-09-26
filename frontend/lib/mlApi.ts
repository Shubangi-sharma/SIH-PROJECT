"use client";

/**
 * PYROSENSE — ML service API client (pyrosense_ml, FastAPI).
 *
 * Transport is ALWAYS the Node backend's pass-through proxy (POST
 * /api/predict, GET /api/ml/hotspots) — the browser never talks to the ML
 * service directly and never sees a second origin. The DTOs below mirror
 * pyrosense_ml's FastAPI responses verbatim (see backend/src/routes/predict.route.ts):
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
 * The trained MLP model's 5 output classes — feature_schema.py
 * CLASSIFIER_CLASSES, exact order of predict_proba columns. NOT the
 * monitoring risk vocabulary. The legacy GBM (model_version="old") still
 * answers with the old 4-class set, so the label/colour maps cover both.
 */
export const MODEL_CLASSES = [
  "Agricultural",
  "Forest_Vegetation",
  "Industrial",
  "Infrastructure_Energy",
  "Mining",
] as const;

export type ModelClass = (typeof MODEL_CLASSES)[number];

/** Human labels for the model's classes (PDF §8 wording). */
export const MODEL_CLASS_LABELS: Record<string, string> = {
  // MLP (default, model_version="new")
  Agricultural: "Agricultural",
  Forest_Vegetation: "Forest / Vegetation",
  Industrial: "Industrial",
  Infrastructure_Energy: "Infrastructure / Energy",
  Mining: "Mining",
  // Legacy GBM (model_version="old") — kept so old-model answers never
  // render as a blank label.
  Agricultural_Vegetation: "Agricultural Vegetation",
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
  /**
   * Analyzed coordinates, echoed from the request. Always present on values
   * returned by postPredict — it backfills them from the submitted request
   * when an older service build omits the echo.
   */
  latitude: number;
  longitude: number;
  /** Predicted Hotspot Category — one of MODEL_CLASSES. */
  class: ModelClass;
  probabilities: Record<ModelClass, number>;
  /**
   * 0–100 scalar risk score — classification-derived. Computed as a weighted
   * sum of class probabilities × domain risk weights (not the GRU temporal
   * model). `null` only from legacy service builds that predate the weighted-
   * probability computation. Current builds always return a real number.
   */
  risk_score: number | null;
  /** GRU per-horizon signals — always null on /predict until Phase 2C. */
  risk?: null;
  risk_unavailable?: string;
  /** Winning-class probability (0–1). */
  confidence: number;
  /** Per-feature importances — not exposed by the MLP; currently always []. */
  top_contributing_features: ContributingFeatureDto[];
  /** Grounded GenAI narrative, or deterministic template fallback. */
  explanation: string;
  /** "openrouter"/"cache" when LLM-generated, "template" for the fallback. */
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

/* ------------------------------------------------------------------ */
/* observations (GET /api/ml/observations — live per-point environment)  */
/* ------------------------------------------------------------------ */

/** Land-cover ratios per class; null when the source had no data. */
export interface LandCoverBlockDto {
  ratios: Record<string, number | null>;
  dominant: string | null;
  observations: number | null;
  vegetation_ratio: number | null;
  provenance: string;
}

/** Six nearest-infrastructure distances + 0/1 proximity flags. */
export interface SurroundingsBlockDto {
  distances_km: Record<string, number | null>;
  proximity_flags: Record<string, boolean | null>;
  provenance: string;
}

/** Weather aggregates over the lookback window; null = source gap. */
export interface WeatherBlockDto {
  mean_temperature_c: number | null;
  max_temperature_c: number | null;
  mean_dewpoint_c: number | null;
  mean_relative_humidity: number | null;
  min_relative_humidity: number | null;
  mean_wind_speed_ms: number | null;
  max_wind_speed_ms: number | null;
  total_precipitation: number | null;
  mean_precipitation: number | null;
  mean_ssrd: number | null;
  max_ssrd: number | null;
  observation_count: number | null;
  lookback_days: number;
  provenance: string;
}

/**
 * GET /api/ml/observations response — live land cover / surroundings /
 * weather for one point, computed on demand by pyrosense_ml's feature
 * modules (nothing persisted, no inference). `null` values are real source
 * gaps — render "—", never coerce to 0.
 */
export interface ObservationsResponseDto {
  latitude: number;
  longitude: number;
  land_cover: LandCoverBlockDto;
  surroundings: SurroundingsBlockDto;
  weather: WeatherBlockDto;
  warnings: string[];
  note: string;
  data_timestamp: string;
}

/**
 * GET /api/ml/observations?lat=…&lng=… — live environmental observations.
 * External sources are queried upstream with per-block caching, so repeated
 * calls for nearby points are cheap. `refresh=true` forwards the flag so the
 * ML service re-queries Overpass/Open-Meteo instead of serving its cache —
 * used by the observations UI's refresh button.
 */
export async function fetchObservations(
  lat: number,
  lng: number,
  opts?: { refresh?: boolean },
): Promise<ObservationsResponseDto> {
  const qs = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  if (opts?.refresh) qs.set("refresh", "1");
  const res = await fetch(`${ML_PROXY_BASE}/api/ml/observations?${qs.toString()}`);
  if (!res.ok) {
    let detail = `ML proxy ${res.status} for /api/ml/observations`;
    try {
      const body = (await res.json()) as { error?: string; detail?: unknown };
      if (typeof body.error === "string") detail = body.error;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d) => JSON.stringify(d)).join("; ");
    } catch {
      /* keep the generic detail */
    }
    throw new MlApiError(res.status, detail);
  }
  return (await res.json()) as ObservationsResponseDto;
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
  // Normalize before the cast: this function OWNS the PredictionResponseDto
  // invariant. The coordinate echo was added to pyrosense_ml later, so older
  // running builds may omit it — backfill from the submitted request. Other
  // collection fields the result page dereferences are defaulted so a
  // degraded/older payload degrades the UI, never crashes it.
  const raw = (await res.json()) as Partial<PredictionResponseDto>;
  return {
    ...raw,
    latitude: typeof raw.latitude === "number" ? raw.latitude : latitude,
    longitude: typeof raw.longitude === "number" ? raw.longitude : longitude,
    probabilities: raw.probabilities ?? ({} as PredictionResponseDto["probabilities"]),
    warnings: raw.warnings ?? [],
    top_contributing_features: raw.top_contributing_features ?? [],
    feature_provenance: raw.feature_provenance ?? {},
    prediction_timestamp: raw.prediction_timestamp ?? new Date().toISOString(),
  } as PredictionResponseDto;
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

/* ------------------------------------------------------------------ */
/* presentation helpers (labels/colours only — no computation)          */
/* ------------------------------------------------------------------ */

/** Vibrant category colours, distinct from the 5-tier risk palette. */
export const MODEL_CLASS_COLORS: Record<string, string> = {
  // MLP (default)
  Agricultural: "#E0A84C",
  Forest_Vegetation: "#4ECBA0",
  Industrial: "#E08A52",
  Infrastructure_Energy: "#9186C4",
  Mining: "#4FB3B3",
  // Legacy GBM — kept so old-model answers never render uncoloured.
  Agricultural_Vegetation: "#E0A84C",
  Mining_Extraction: "#9186C4",
  Other_Persistent_Thermal_Source: "#4FB3B3",
};
