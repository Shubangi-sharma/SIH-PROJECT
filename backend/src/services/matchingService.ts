/**
 * matchingService — geospatial join: FIRMS hotspot → nearest facility.
 *
 * For each detection, finds the nearest facility from the merged OSM + user
 * dataset within FACILITY_RADIUS_KM. If a user facility has a boundary_geojson
 * polygon, uses point-in-polygon test before falling back to centroid distance.
 *
 * Detections matching no facility → flagged as "Unidentified Thermal Source."
 */

import { FACILITY_RADIUS_KM } from "../config/regions.js";
import { haversineKm } from "../lib/geo.js";
import type { FacilityRow, DetectionRowWithId } from "../db/client.js";

export interface MatchResult {
  detectionId: number;
  facilityId: string;
  distanceKm: number;
  matchType: "boundary" | "proximity" | "unidentified";
}

/**
 * Simple ray-casting point-in-polygon test for a GeoJSON Polygon.
 * Handles only the first ring (no holes) for simplicity.
 */
function pointInPolygon(lat: number, lng: number, geojson: string): boolean {
  try {
    const parsed = JSON.parse(geojson) as {
      type?: string;
      coordinates?: number[][][];
    };
    if (!parsed.coordinates || parsed.type !== "Polygon") return false;
    const ring = parsed.coordinates[0];
    if (!ring || ring.length < 3) return false;

    // Ray-casting algorithm (lng = x, lat = y)
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i]![0]!, yi = ring[i]![1]!;
      const xj = ring[j]![0]!, yj = ring[j]![1]!;
      if (
        yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }
    return inside;
  } catch {
    return false;
  }
}

/**
 * Match a batch of detections to facilities. Returns one MatchResult per
 * detection, including unidentified sources.
 */
export function matchDetections(
  detections: DetectionRowWithId[],
  facilities: FacilityRow[],
  radiusKm: number = FACILITY_RADIUS_KM,
): MatchResult[] {
  const results: MatchResult[] = [];

  // Pre-compute facility bounding boxes for cheap prefilter
  const dLatPad = radiusKm / 111;

  for (const det of detections) {
    let bestFacility: FacilityRow | null = null;
    let bestDist = Infinity;
    let bestType: MatchResult["matchType"] = "unidentified";

    const dLngPad = radiusKm / (111 * Math.max(0.1, Math.cos((det.lat * Math.PI) / 180)));

    for (const fac of facilities) {
      // Cheap bbox prefilter
      if (
        Math.abs(fac.lat - det.lat) > dLatPad ||
        Math.abs(fac.lng - det.lng) > dLngPad
      ) {
        continue;
      }

      // Check boundary polygon first (user facilities may have them)
      if (fac.boundary_geojson) {
        if (pointInPolygon(det.lat, det.lng, fac.boundary_geojson)) {
          const dist = haversineKm(fac.lat, fac.lng, det.lat, det.lng);
          if (dist < bestDist || bestType !== "boundary") {
            bestFacility = fac;
            bestDist = dist;
            bestType = "boundary";
          }
          continue; // boundary match takes priority
        }
      }

      // Proximity match
      if (bestType !== "boundary") {
        const dist = haversineKm(fac.lat, fac.lng, det.lat, det.lng);
        if (dist <= radiusKm && dist < bestDist) {
          bestFacility = fac;
          bestDist = dist;
          bestType = "proximity";
        }
      }
    }

    if (bestFacility) {
      results.push({
        detectionId: det.id,
        facilityId: bestFacility.id,
        distanceKm: Math.round(bestDist * 100) / 100,
        matchType: bestType,
      });
    } else {
      // Unidentified thermal source — no facility within radius
      results.push({
        detectionId: det.id,
        facilityId: `UTS-${det.lat.toFixed(3)}-${det.lng.toFixed(3)}`,
        distanceKm: 0,
        matchType: "unidentified",
      });
    }
  }

  return results;
}
