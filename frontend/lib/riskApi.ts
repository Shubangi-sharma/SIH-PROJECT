"use client";

/**
 * PYROSENSE — /api/v1 BFF client (risk + hotspot clusters + cells).
 *
 * Mirrors docs/api-contract-v2.md and backend/src/routes/v1.route.ts.
 * The BFF validates the ML service with Zod and serves stale-but-labeled
 * data on degradation; this client surfaces that honesty via `meta`
 * (data_timestamp, stale flag) instead of hiding it.
 *
 * Vocabulary guard: RISK LEVELS here are the GRU models' threshold signals
 * (HIGH/MODERATE/LOW) — NOT the monitoring backend's rule-based status
 * (normal/watch/suspicious/critical in lib/types.ts), and NOT calibrated
 * probabilities (LIMITATIONS.md §3).
 */

import { API_BASE } from "./api";

/* ------------------------------------------------------------------ */
/* meta (Phase 3 §3.3 contract discipline)                              */
/* ------------------------------------------------------------------ */

export interface ResponseMeta {
  data_timestamp: string;
  stale: boolean;
  cached?: boolean;
  age_ms?: number;
  model_version?: string | null;
  feature_schema_version?: string | null;
}

/* ------------------------------------------------------------------ */
/* DTOs (mirror backend/src/routes/v1.route.ts + mlClient Zod schemas)  */
/* ------------------------------------------------------------------ */

export type RiskHorizon = "1day" | "3day" | "7day";

export interface RiskHorizonEntry {
  probability: number;
  /** Threshold signal — never present as a probability in the UI. */
  level: "HIGH" | "LOW";
  threshold: number;
}

export interface RiskEntry {
  h3_cell?: string;
  horizons: Record<string, RiskHorizonEntry>;
  overall: string;
  status: string;
  data_timestamp: string | null;
  model_version?: string;
  feature_schema_version?: string;
}

export interface RiskBatchResponse {
  risks: Record<string, RiskEntry>;
  missing: { h3_cell: string; status: string }[];
  meta: ResponseMeta;
}

/** The five contextual hotspot classes (frozen feature_schema). */
export const HOTSPOT_CLASSES = [
  "Agricultural",
  "Forest_Vegetation",
  "Industrial",
  "Infrastructure_Energy",
  "Mining",
] as const;

export type HotspotClass = (typeof HOTSPOT_CLASSES)[number];

export interface HotspotClusterDto {
  cluster_id: string;
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
  /** Surfaced verbatim from the BFF (LIMITATIONS.md §1). */
  contextual_note?: string;
}

export interface HotspotsResponse {
  count: number;
  hotspots: HotspotClusterDto[];
  classes: string[];
  meta: ResponseMeta;
}

export interface CellDetailResponse {
  h3_cell: string;
  risk:
    | { status: "ok"; horizons: Record<string, RiskHorizonEntry>; overall: string; data_timestamp: string | null }
    | { status: "unavailable" | "insufficient_history"; note?: string };
  hotspots: HotspotClusterDto[];
  classes: string[];
  meta: ResponseMeta;
}

/* ------------------------------------------------------------------ */
/* fetchers                                                             */
/* ------------------------------------------------------------------ */

async function fetchV1Json<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    let detail = `API ${res.status} for ${path}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === "string") detail = body.error;
    } catch {
      /* keep generic */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

function bboxParams(bbox: { west: number; south: number; east: number; north: number }): URLSearchParams {
  const qs = new URLSearchParams();
  qs.set("minLat", String(bbox.south));
  qs.set("maxLat", String(bbox.north));
  qs.set("minLng", String(bbox.west));
  qs.set("maxLng", String(bbox.east));
  return qs;
}

/** GET /api/v1/risk — viewport risk (bbox auto-filled to H3-r7 cells). */
export function fetchRiskForBbox(bbox: {
  west: number;
  south: number;
  east: number;
  north: number;
}): Promise<RiskBatchResponse> {
  return fetchV1Json<RiskBatchResponse>(`/api/v1/risk?${bboxParams(bbox).toString()}`);
}

/** GET /api/v1/hotspots — persistent/recent clusters for the viewport. */
export function fetchHotspotClusters(
  bbox?: Partial<{ west: number; south: number; east: number; north: number }> & {
    type?: string;
    persistent?: boolean;
    limit?: number;
  },
): Promise<HotspotsResponse> {
  const qs = bboxParams({
    west: bbox?.west ?? -180,
    south: bbox?.south ?? -90,
    east: bbox?.east ?? 180,
    north: bbox?.north ?? 90,
  });
  if (bbox?.type) qs.set("type", bbox.type);
  if (bbox?.persistent !== undefined) qs.set("persistent", String(bbox.persistent));
  if (bbox?.limit) qs.set("limit", String(bbox.limit));
  return fetchV1Json<HotspotsResponse>(`/api/v1/hotspots?${qs.toString()}`);
}

/** GET /api/v1/cells/:h3 — one cell: risk + clusters (click-panel payload). */
export function fetchCellDetail(h3Cell: string): Promise<CellDetailResponse> {
  return fetchV1Json<CellDetailResponse>(`/api/v1/cells/${encodeURIComponent(h3Cell)}`);
}

/* ------------------------------------------------------------------ */
/* presentation helpers (labels/wording only — no computation)          */
/* ------------------------------------------------------------------ */

/** Legend wording: thresholds, not probabilities (LIMITATIONS.md §3). */
export const RISK_LEVEL_LABELS: Record<string, string> = {
  HIGH: "High signal",
  MODERATE: "Moderate signal",
  LOW: "Low signal",
};

export const HORIZON_LABELS: Record<RiskHorizon, string> = {
  "1day": "Next 1 day",
  "3day": "Next 3 days",
  "7day": "Next 7 days",
};

export const HOTSPOT_CLASS_LABELS: Record<string, string> = {
  Agricultural: "Agricultural",
  Forest_Vegetation: "Forest / Vegetation",
  Industrial: "Industrial",
  Infrastructure_Energy: "Infrastructure / Energy",
  Mining: "Mining",
};

/** Overall-level chip colours (muted, distinct from FRP palette). */
export const RISK_LEVEL_COLORS: Record<string, string> = {
  HIGH: "#D97757",
  MODERATE: "#B99B5E",
  LOW: "#5CA0AD",
};
