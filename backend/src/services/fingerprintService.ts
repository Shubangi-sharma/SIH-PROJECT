/**
 * fingerprintService — per-facility thermal fingerprint (rolling baseline).
 *
 * Computes and stores a multi-dimensional baseline for each facility:
 *   - FRP statistics (mean, std, p50, p90, p99)
 *   - Spatial signature (centroid, spread)
 *   - Temporal pattern (frequency, day/night ratio)
 *   - Zone activity (quadrant-level historical activity)
 *
 * Stored in facility_baselines table as JSON. Recomputed incrementally
 * when new detections arrive (not from scratch each time).
 */

import { FACILITY_RADIUS_KM, HISTORY_WINDOW_DAYS } from "../config/regions.js";
import {
  FacilityRow,
  DetectionRow,
  getDetectionsNear,
  upsertBaseline,
  BaselineRow,
} from "../db/client.js";
import { haversineKm } from "../lib/geo.js";
import { logger } from "../lib/logger.js";

const log = logger.child({ module: "fingerprint" });

/** A facility counts as "active" if it has detections in the last N days. */
const RECENT_ACTIVITY_DAYS = 5;

export interface FingerprintBaseline {
  /** Weighted FRP statistics */
  frpMean: number;
  frpStdDev: number;
  frpP50: number;
  frpP90: number;
  frpP99: number;

  /** Spatial signature */
  centroidLat: number;
  centroidLng: number;
  spreadKm: number; // max distance from centroid

  /** Temporal pattern */
  detectionsPerDay: number;
  dayNightRatio: number; // proportion of daytime detections
  totalDetections: number;

  /** Zone activity — quadrants (NE, NW, SE, SW) relative to facility centroid */
  zoneActivity: Record<"NE" | "NW" | "SE" | "SW", number>;

  /** Unique acquisition dates with detections */
  activeDays: number;

  /** History depth */
  windowDays: number;
  oldestDetection: string | null;
  newestDetection: string | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))]!;
}

function getQuadrant(
  facilityLat: number,
  facilityLng: number,
  detLat: number,
  detLng: number,
): "NE" | "NW" | "SE" | "SW" {
  const north = detLat >= facilityLat;
  const east = detLng >= facilityLng;
  if (north && east) return "NE";
  if (north && !east) return "NW";
  if (!north && east) return "SE";
  return "SW";
}

/**
 * Compute a thermal fingerprint for a facility from its detection history.
 */
export function computeFingerprint(
  facility: FacilityRow,
  detections: DetectionRow[],
  todayUtc: Date,
): FingerprintBaseline {
  const radiusKm = FACILITY_RADIUS_KM;

  // Filter to detections within the corroboration radius
  const nearby = detections.filter(
    (d) => haversineKm(facility.lat, facility.lng, d.lat, d.lng) <= radiusKm,
  );

  if (nearby.length === 0) {
    return {
      frpMean: 0, frpStdDev: 0, frpP50: 0, frpP90: 0, frpP99: 0,
      centroidLat: facility.lat, centroidLng: facility.lng, spreadKm: 0,
      detectionsPerDay: 0, dayNightRatio: 0.5, totalDetections: 0,
      zoneActivity: { NE: 0, NW: 0, SE: 0, SW: 0 },
      activeDays: 0, windowDays: 0, oldestDetection: null, newestDetection: null,
    };
  }

  // FRP statistics
  const frps = nearby.map((d) => d.frp).sort((a, b) => a - b);
  const frpMean = frps.reduce((a, b) => a + b, 0) / frps.length;
  const frpVariance = frps.reduce((a, v) => a + (v - frpMean) ** 2, 0) / frps.length;

  // Spatial centroid + spread
  const centroidLat = nearby.reduce((a, d) => a + d.lat, 0) / nearby.length;
  const centroidLng = nearby.reduce((a, d) => a + d.lng, 0) / nearby.length;
  const spreadKm = Math.max(
    ...nearby.map((d) => haversineKm(centroidLat, centroidLng, d.lat, d.lng)),
    0,
  );

  // Temporal pattern
  const dates = new Set(nearby.map((d) => d.acq_date));
  const activeDays = dates.size;
  const sortedDates = [...dates].sort();
  const oldestDetection = sortedDates[0] ?? null;
  const newestDetection = sortedDates[sortedDates.length - 1] ?? null;

  let windowDays = 0;
  if (oldestDetection) {
    const [y, m, d] = oldestDetection.split("-").map(Number);
    if (y && m && d) {
      const todayMs = Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate());
      windowDays = Math.max(1, Math.round((todayMs - Date.UTC(y, m - 1, d)) / 86_400_000));
    }
  }

  const detectionsPerDay = windowDays > 0 ? nearby.length / windowDays : 0;
  const dayCount = nearby.filter((d) => d.daynight === "D").length;
  const dayNightRatio = nearby.length > 0 ? dayCount / nearby.length : 0.5;

  // Zone activity
  const zoneActivity: Record<"NE" | "NW" | "SE" | "SW", number> = { NE: 0, NW: 0, SE: 0, SW: 0 };
  for (const d of nearby) {
    zoneActivity[getQuadrant(facility.lat, facility.lng, d.lat, d.lng)]++;
  }

  return {
    frpMean,
    frpStdDev: Math.sqrt(Math.max(0, frpVariance)),
    frpP50: percentile(frps, 50),
    frpP90: percentile(frps, 90),
    frpP99: percentile(frps, 99),
    centroidLat,
    centroidLng,
    spreadKm: Math.round(spreadKm * 100) / 100,
    detectionsPerDay: Math.round(detectionsPerDay * 1000) / 1000,
    dayNightRatio: Math.round(dayNightRatio * 100) / 100,
    totalDetections: nearby.length,
    zoneActivity,
    activeDays,
    windowDays,
    oldestDetection,
    newestDetection,
  };
}

/**
 * Update fingerprint baselines for a batch of facilities.
 * Called after ingestion/refresh to keep baselines current.
 *
 * With `onlyActive` (the default), only facilities with detections inside
 * the recent refresh window are recomputed — the common 15-min pipeline run
 * touches a handful of sites instead of re-scanning the whole catalogue.
 * Pass `onlyActive: false` for a full rebuild (e.g. after first ingest).
 */
export function updateFingerprints(
  facilities: FacilityRow[],
  todayUtc: Date = new Date(),
  options: { onlyActive?: boolean } = {},
): number {
  const { onlyActive = true } = options;
  let updated = 0;
  const fromDate = new Date(todayUtc.getTime() - HISTORY_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const recentFrom = new Date(todayUtc.getTime() - RECENT_ACTIVITY_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  for (const fac of facilities) {
    try {
      if (onlyActive) {
        // Skip facilities with nothing new — their stored fingerprint is
        // still correct. One indexed query per facility, ~ms each.
        const recent = getDetectionsNear(fac.lat, fac.lng, FACILITY_RADIUS_KM + 1, recentFrom);
        if (recent.length === 0) continue;
      }

      const dets = getDetectionsNear(fac.lat, fac.lng, FACILITY_RADIUS_KM + 1, fromDate);
      const fp = computeFingerprint(fac, dets, todayUtc);

      upsertBaseline({
        facility_id: fac.id,
        baseline_json: JSON.stringify(fp),
        window_days: fp.windowDays,
        detection_count: fp.totalDetections,
        computed_at: new Date().toISOString(),
      });
      updated++;
    } catch (err) {
      log.warn({ facilityId: fac.id, err: String(err) }, "fingerprint computation failed");
    }
  }

  log.info({ updated, total: facilities.length, onlyActive }, "fingerprints updated");
  return updated;
}

/** Parse a stored baseline JSON back into a FingerprintBaseline. */
export function parseBaseline(row: BaselineRow | null): FingerprintBaseline | null {
  if (!row) return null;
  try {
    return JSON.parse(row.baseline_json) as FingerprintBaseline;
  } catch {
    return null;
  }
}
