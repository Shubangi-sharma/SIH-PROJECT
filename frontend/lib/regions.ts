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

/**
 * North / West macro-regions (PDF §2 dashboard counters). Points inside
 * INDIA_BBOX but in neither region are counted as "Other India".
 */
export function northOrWestRegion(lat: number, lng: number): "north" | "west" | "other" {
  if (lat >= 24 && lng >= 72 && lng <= 89) return "north";
  if (lat >= 15 && lat <= 30 && lng >= 66 && lng <= 77) return "west";
  return "other";
}

/**
 * Coarse state/UT bounding boxes for the map's state filter (§3). Assign a
 * point to the first state whose box contains it — coarse by design, honest
 * by design: it filters only what the backend actually serves.
 */
export const INDIA_STATE_BBOXES: { id: string; label: string; bbox: BBox }[] = [
  { id: "jammu-kashmir", label: "Jammu & Kashmir", bbox: { west: 73.4, south: 32.2, east: 80.3, north: 37.1 } },
  { id: "himachal-pradesh", label: "Himachal Pradesh", bbox: { west: 75.5, south: 30.3, east: 79.0, north: 33.3 } },
  { id: "punjab", label: "Punjab", bbox: { west: 73.8, south: 29.5, east: 76.9, north: 32.6 } },
  { id: "chandigarh", label: "Chandigarh", bbox: { west: 76.6, south: 30.6, east: 76.96, north: 30.8 } },
  { id: "uttarakhand", label: "Uttarakhand", bbox: { west: 77.6, south: 28.7, east: 81.1, north: 31.5 } },
  { id: "haryana", label: "Haryana", bbox: { west: 74.4, south: 27.6, east: 77.6, north: 30.95 } },
  { id: "delhi", label: "Delhi", bbox: { west: 76.8, south: 28.3, east: 77.4, north: 28.9 } },
  { id: "rajasthan", label: "Rajasthan", bbox: { west: 69.4, south: 23.0, east: 78.3, north: 30.2 } },
  { id: "uttar-pradesh", label: "Uttar Pradesh", bbox: { west: 77.0, south: 23.8, east: 84.7, north: 30.5 } },
  { id: "bihar", label: "Bihar", bbox: { west: 83.2, south: 24.2, east: 88.3, north: 27.6 } },
  { id: "sikkim", label: "Sikkim", bbox: { west: 88.0, south: 27.0, east: 89.0, north: 28.2 } },
  { id: "assam", label: "Assam", bbox: { west: 89.6, south: 24.0, east: 96.1, north: 28.0 } },
  { id: "west-bengal", label: "West Bengal", bbox: { west: 85.8, south: 21.4, east: 89.9, north: 27.3 } },
  { id: "jharkhand", label: "Jharkhand", bbox: { west: 83.2, south: 21.9, east: 87.9, north: 25.4 } },
  { id: "odisha", label: "Odisha", bbox: { west: 81.3, south: 17.7, east: 87.6, north: 22.6 } },
  { id: "chhattisgarh", label: "Chhattisgarh", bbox: { west: 80.2, south: 17.7, east: 84.4, north: 24.2 } },
  { id: "madhya-pradesh", label: "Madhya Pradesh", bbox: { west: 74.0, south: 21.0, east: 82.9, north: 26.9 } },
  { id: "gujarat", label: "Gujarat", bbox: { west: 68.1, south: 20.0, east: 74.5, north: 24.7 } },
  { id: "maharashtra", label: "Maharashtra", bbox: { west: 72.6, south: 15.6, east: 80.9, north: 22.1 } },
  { id: "telangana", label: "Telangana", bbox: { west: 77.2, south: 15.8, east: 81.8, north: 19.9 } },
  { id: "andhra-pradesh", label: "Andhra Pradesh", bbox: { west: 76.7, south: 12.6, east: 84.9, north: 19.9 } },
  { id: "karnataka", label: "Karnataka", bbox: { west: 74.0, south: 11.5, east: 78.6, north: 18.5 } },
  { id: "goa", label: "Goa", bbox: { west: 73.6, south: 14.8, east: 74.4, north: 15.8 } },
  { id: "kerala", label: "Kerala", bbox: { west: 74.7, south: 8.3, east: 77.4, north: 12.8 } },
  { id: "tamil-nadu", label: "Tamil Nadu", bbox: { west: 76.2, south: 8.0, east: 80.4, north: 13.6 } },
  { id: "puducherry", label: "Puducherry", bbox: { west: 79.3, south: 10.8, east: 79.9, north: 12.0 } },
];

/** First state bbox containing the point, or null when outside every box. */
export function stateForPoint(lat: number, lng: number): string | null {
  for (const s of INDIA_STATE_BBOXES) {
    const b = s.bbox;
    if (lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east) return s.id;
  }
  return null;
}

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
