"use client";

/**
 * PYROSENSE — ops + v1 BFF client (service health, ML pipeline, risk tiles,
 * hotspot clusters).
 *
 * Covers the backend endpoints that previously had NO frontend surface:
 *   - GET  /health               → backend uptime + SQLite ingest coverage
 *   - GET  /api/ml/health        → pyrosense_ml model/DB status (via proxy)
 *   - POST /api/v1/pipeline/run  → manual "run the ML pipeline now" handle
 *   - GET  /api/v1/risk          → viewport GRU risk-signal tiles (H3 res-7)
 *   - GET  /api/v1/hotspots      → classified hotspot clusters
 *
 * Mirrors backend/src/routes/{health,predict,v1}.route.ts and
 * backend/src/services/mlClient.ts (Zod shapes). Degradation honesty: v1
 * responses carry `meta.stale` — surfaced verbatim, never hidden.
 */

import { API_BASE } from "./api";

/* ------------------------------------------------------------------ */
/* backend /health                                                     */
/* ------------------------------------------------------------------ */

export interface BackendHealthDto {
  status: string;
  uptimeSec: number;
  db: { minDate: string | null; maxDate: string | null; rows: number };
  lastRefresh: string | null;
  lastArchive: string | null;
  lastFacilityIngest: string | null;
}

export async function fetchBackendHealth(): Promise<BackendHealthDto> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`backend ${res.status} for /health`);
  return (await res.json()) as BackendHealthDto;
}

/* ------------------------------------------------------------------ */
/* ML service /api/ml/health (via Node proxy)                          */
/* ------------------------------------------------------------------ */

export interface MlHealthDto {
  status: string;
  service: string;
  model_loaded: boolean;
  postgres_connected: boolean;
  model_version: string;
  dataset_version: string;
  feature_schema_version: string;
  feature_count: number;
  classifiers_available?: string[];
  legacy_gbm_features?: number;
}

export async function fetchMlHealth(): Promise<MlHealthDto> {
  const res = await fetch(`${API_BASE}/api/ml/health`);
  if (!res.ok) throw new Error(`backend ${res.status} for /api/ml/health`);
  return (await res.json()) as MlHealthDto;
}

/* ------------------------------------------------------------------ */
/* POST /api/v1/pipeline/run — manual ML pipeline trigger              */
/* ------------------------------------------------------------------ */

/** The pipeline report is free-shaped ops output — surfaced verbatim. */
export type PipelineReport = Record<string, unknown>;

export async function runPipeline(days = 10): Promise<PipelineReport> {
  // Long-running by design (ingest → weather → aggregate → risk → hotspots):
  // the backend allows up to ~10 min; match it and surface progress upstream.
  const res = await fetch(`${API_BASE}/api/v1/pipeline/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days }),
  });
  if (!res.ok) {
    let detail = `pipeline ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === "string") detail = body.error;
    } catch {
      /* keep generic */
    }
    throw new Error(detail);
  }
  const body = (await res.json()) as { report?: PipelineReport };
  return body.report ?? {};
}

/* ------------------------------------------------------------------ */
/* GET /api/v1/risk — viewport GRU risk-signal tiles                   */
/* ------------------------------------------------------------------ */

export interface ViewportRiskHorizon {
  probability: number;
  level: "HIGH" | "LOW";
  threshold: number;
}

/** One H3 cell's risk signals — mirrors mlClient's RiskEntrySchema. */
export interface ViewportRiskEntry {
  h3_cell?: string;
  status?: string;
  horizons: Record<string, ViewportRiskHorizon>;
  overall: string;
  data_timestamp?: string | null;
  model_version?: string;
}

export interface ViewportRiskResponse {
  risks: Record<string, ViewportRiskEntry>;
  missing: { h3_cell: string; status: string }[];
  meta: { data_timestamp: string; stale: boolean; cached?: boolean; model_version?: string | null };
}

export class ViewportRiskError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ViewportRiskError";
  }
}

export async function fetchViewportRisk(bbox: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}): Promise<ViewportRiskResponse> {
  const qs = new URLSearchParams({
    minLat: String(bbox.minLat),
    maxLat: String(bbox.maxLat),
    minLng: String(bbox.minLng),
    maxLng: String(bbox.maxLng),
  });
  const res = await fetch(`${API_BASE}/api/v1/risk?${qs.toString()}`);
  if (!res.ok) {
    let detail = `API ${res.status} for /api/v1/risk`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === "string") detail = body.error;
    } catch {
      /* keep generic */
    }
    throw new ViewportRiskError(res.status, detail);
  }
  return (await res.json()) as ViewportRiskResponse;
}

/* ------------------------------------------------------------------ */
/* GET /api/v1/hotspots — classified hotspot clusters                  */
/* ------------------------------------------------------------------ */

/** Mirrors v1.route.ts's hotspot mapping + HotspotSummarySchema. */
export interface HotspotClusterSummary {
  hotspot_id: string;
  h3_cell: string;
  latitude: number;
  longitude: number;
  unique_fire_days: number;
  total_detections: number;
  first_seen: string;
  last_seen: string;
  is_persistent: boolean;
  class: string | null;
  confidence: number | null;
  needs_review: boolean;
  model_version: string | null;
  contextual_note?: string;
}

export interface HotspotClustersResponse {
  count: number;
  hotspots: HotspotClusterSummary[];
  classes: string[];
  meta: { data_timestamp: string; stale: boolean; model_version?: string; feature_schema_version?: string };
}

export async function fetchHotspotClusters(params?: {
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
  persistent?: boolean;
  limit?: number;
}): Promise<HotspotClustersResponse> {
  const qs = new URLSearchParams();
  if (params?.minLat != null) qs.set("minLat", String(params.minLat));
  if (params?.maxLat != null) qs.set("maxLat", String(params.maxLat));
  if (params?.minLng != null) qs.set("minLng", String(params.minLng));
  if (params?.maxLng != null) qs.set("maxLng", String(params.maxLng));
  if (params?.persistent != null) qs.set("persistent", String(params.persistent));
  if (params?.limit != null) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${API_BASE}/api/v1/hotspots${suffix}`);
  if (!res.ok) {
    let detail = `API ${res.status} for /api/v1/hotspots`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === "string") detail = body.error;
    } catch {
      /* keep generic */
    }
    throw new Error(detail);
  }
  return (await res.json()) as HotspotClustersResponse;
}
