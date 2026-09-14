/** Bounding-box definitions for region modes (§2, §4). */

/**
 * Classification window in days (§3). NASA's FIRMS Area API caps a single
 * request at 5 days (verified: dayRange 7/10 → "Invalid day range. Expects
 * [1..5]."), so app/api/firms/route.ts accumulates a rolling server-side
 * cache to serve this full window of real data.
 */
export const FIRMS_WINDOW_DAYS = 10;

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type RegionId = "india" | "global";

export const INDIA_BBOX: BBox = { west: 68, south: 6, east: 98, north: 36 };

export const bboxToString = (b: BBox): string =>
  `${b.west},${b.south},${b.east},${b.north}`;

/**
 * Global Live — continent-scale chunks instead of one giant world request:
 * Overpass has query-size limits and FIRMS caps rows per call, so we fetch
 * these 8 coarse boxes in parallel and merge the results (§4).
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
