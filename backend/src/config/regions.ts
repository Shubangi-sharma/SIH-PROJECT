/**
 * Region definitions shared by the backend services and jobs.
 * (Mirrors the frontend's lib/regions.ts so both sides agree.)
 */

/** NASA's FIRMS Area API hard-caps a single NRT request at 5 days. */
export const FIRMS_MAX_REQUEST_DAYS = 5;

/**
 * How far back the service promises history. NASA's NRT archive is a rolling
 * window; we ingest up to this many days and store what it actually serves.
 */
export const HISTORY_WINDOW_DAYS = 365;

/**
 * Recomputed live status window (§4): classifications compare recent
 * behaviour against the full ingested baseline.
 */
export const LIVE_WINDOW_DAYS = 10;

/** Detection → facility corroboration radius, km. */
export const FACILITY_RADIUS_KM = 5;

/** Baseline FRP weighting: last N days are the "recent" band. */
export const BASELINE_RECENT_DAYS = 30;

/** How far back the incident "What Changed" diff window reaches. */
export const INCIDENT_WINDOW_DAYS = 14;

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type RegionId = "india" | "global";

export const INDIA_BBOX: BBox = { west: 68, south: 6, east: 98, north: 36 };

export const bboxToString = (b: BBox): string => `${b.west},${b.south},${b.east},${b.north}`;

/**
 * Global Live — continent-scale chunks (Overpass query-size limits, FIRMS row
 * caps), same geometry as the frontend's GLOBAL_CHUNKS.
 */
export const GLOBAL_CHUNKS: { id: string; label: string; bbox: BBox }[] = [
  { id: "af", label: "Africa", bbox: { west: -20, south: -35, east: 52, north: 37 } },
  { id: "eu", label: "Europe", bbox: { west: -25, south: 34, east: 60, north: 71 } },
  { id: "as", label: "Asia", bbox: { west: 52, south: 0, east: 150, north: 55 } },
  { id: "me", label: "Middle East", bbox: { west: 34, south: 12, east: 63, north: 42 } },
  { id: "na", label: "N. America", bbox: { west: -170, south: 12, east: -50, north: 72 } },
  { id: "sa", label: "S. America", bbox: { west: -85, south: -56, east: -34, north: 13 } },
  { id: "oc", label: "Oceania", bbox: { west: 110, south: -50, east: 180, north: 0 } },
];

/** Every chunk, or just India's box, for the active region mode. */
export const REGION_BBOXES: Record<RegionId, BBox[]> = {
  india: [INDIA_BBOX],
  global: GLOBAL_CHUNKS.map((c) => c.bbox),
};
