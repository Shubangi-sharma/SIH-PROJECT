/**
 * analysisService — orchestration layer: loads detections from the DB,
 * classifies every facility, builds What-Changed diffs and timelines
 * (§3's point: all of this queries SQLite in milliseconds, no external API).
 */

import { FACILITY_RADIUS_KM, HISTORY_WINDOW_DAYS, LIVE_WINDOW_DAYS } from "../config/regions.js";
import {
  DetectionRow,
  FacilityRow,
  getAllFacilities,
  getAllFacilitiesMerged,
  getDetectionsInBox,
  getDetectionsNear,
  getBaseline,
} from "../db/client.js";
import { haversineKm } from "../lib/geo.js";
import {
  Classification,
  classifyFromDetections,
  CRITICAL_FRP_RATIO,
  formatDeltaPct,
  isUsable,
  RiskStatus,
  SUSPICIOUS_FRP_RATIO,
  USABLE_CONFIDENCE,
} from "./scoringService.js";
import { SummaryFacts } from "./facts.js";
import { parseBaseline, type FingerprintBaseline } from "./fingerprintService.js";
import {
  classify as classifyThermal,
  buildClassificationSignals,
  CLASSIFICATION_LABELS,
  type ThermalClassification,
} from "./classificationService.js";

export interface FacilityAnalysis {
  facility: FacilityRow;
  status: RiskStatus;
  score: number;
  latestFrp: number | null;
  latestTimestampUtc: string | null;
  nearestKm: number | null;
  detectionCount: number;
  liveCount: number;
  liveMeanFrp: number | null;
  baselineMeanFrp: number | null;
}

export interface WhatChangedRow {
  kind: "ok" | "warning";
  text: string;
  value?: string;
  severity?: RiskStatus;
}

export interface DetectionEvent {
  time: string;
  text: string;
  severity: RiskStatus;
}

export interface FacilityNarrative {
  whatChanged: WhatChangedRow[];
  timeline: DetectionEvent[];
  facts: SummaryFacts;
  templatedSummary: string;
  classification?: ThermalClassification;
  classificationLabel?: string;
  riskScore?: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function dateDaysAgo(days: number, today: Date): string {
  const d = new Date(today.getTime() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Classify facilities in bulk, sharing one indexed DB query per 1° tile.
 *
 * Facilities are grouped into 1° tiles; each tile's detections are fetched
 * ONCE (with a pad so edge facilities still see neighbours' detections) and
 * filtered per facility — first by cheap bbox check, then by haversine in
 * the classifier. `bbox` filters facilities BEFORE classification so a
 * regional request never classifies the whole planet.
 */
const TILE_DEG = 1.0;
/** pad in degrees ≈ 11 km — covers the 5 km corroboration radius + slack */
const TILE_PAD_DEG = 0.1;

export function analyzeAllFacilities(
  todayUtc: Date,
  bbox?: { west: number; south: number; east: number; north: number },
): FacilityAnalysis[] {
  let facilities = getAllFacilitiesMerged();
  if (bbox) {
    facilities = facilities.filter(
      (f) =>
        f.lat >= bbox.south &&
        f.lat <= bbox.north &&
        f.lng >= bbox.west &&
        f.lng <= bbox.east,
    );
  }
  if (facilities.length === 0) return [];

  // group facilities into tiles
  const tiles = new Map<string, FacilityRow[]>();
  for (const f of facilities) {
    const tLat = Math.floor(f.lat / TILE_DEG) * TILE_DEG;
    const tLng = Math.floor(f.lng / TILE_DEG) * TILE_DEG;
    const key = `${tLat},${tLng}`;
    const list = tiles.get(key);
    if (list) list.push(f);
    else tiles.set(key, [f]);
  }

  const fromDate = dateDaysAgo(HISTORY_WINDOW_DAYS, todayUtc);
  const toDate = todayUtc.toISOString().slice(0, 10);

  const out: FacilityAnalysis[] = [];
  for (const [key, group] of tiles) {
    const [tLat, tLng] = key.split(",").map(Number);
    const rows = getDetectionsInBox({
      minLat: tLat! - TILE_PAD_DEG,
      maxLat: tLat! + TILE_DEG + TILE_PAD_DEG,
      minLng: tLng! - TILE_PAD_DEG,
      maxLng: tLng! + TILE_DEG + TILE_PAD_DEG,
      fromDate,
      toDate,
    });

    for (const f of group) {
      // cheap bbox prefilter (≈ FACILITY_RADIUS_KM + slack) before haversine
      const pad = FACILITY_RADIUS_KM / 111 + 0.02;
      const det = rows.filter(
        (d) => Math.abs(d.lat - f.lat) <= pad && Math.abs(d.lng - f.lng) <= pad,
      );
      const c = classifyFromDetections({
        facility: f,
        detections: det,
        todayUtc,
        radiusKm: FACILITY_RADIUS_KM,
      });
      out.push({
        facility: f,
        status: c.status,
        score: c.score,
        latestFrp: c.latestFrp,
        latestTimestampUtc: c.latestTimestampUtc,
        nearestKm: c.nearestKm,
        detectionCount: c.detectionCount,
        liveCount: c.liveCount,
        liveMeanFrp: c.liveMeanFrp,
        baselineMeanFrp: c.baseline ? c.baseline.mean : null,
      });
    }
  }
  return out;
}

/** Classify + build facts + narrative for ONE facility. */
export function analyzeFacility(
  facility: FacilityRow,
  todayUtc0: Date,
  radiusKm: number = FACILITY_RADIUS_KM,
): { classification: Classification; narrative: FacilityNarrative; facts: SummaryFacts } {
  const todayUtc = todayUtc0;
  const fromDate = dateDaysAgo(HISTORY_WINDOW_DAYS, todayUtc);
  const box = getDetectionsNear(facility.lat, facility.lng, radiusKm + 1, fromDate);
  const c = classifyFromDetections({ facility, detections: box, todayUtc, radiusKm });

  const near = box
    .map((d) => ({ d, dist: haversineKm(facility.lat, facility.lng, d.lat, d.lng) }))
    .filter((x) => x.dist <= radiusKm)
    .sort((a, b) =>
      a.d.acq_date < b.d.acq_date ? 1 : a.d.acq_date > b.d.acq_date ? -1 : b.d.acq_time.localeCompare(a.d.acq_time),
    )
    .map((x) => x.d);

  const usable = near.filter((d) => USABLE_CONFIDENCE.has(d.confidence.toLowerCase()));
  const ages = new Map<DetectionRow, number>(
    usable.map((d) => {
      const [y, m, dd] = d.acq_date.split("-").map(Number);
      const today = Date.UTC(todayUtc0.getUTCFullYear(), todayUtc0.getUTCMonth(), todayUtc0.getUTCDate());
      const age = y && m && dd ? Math.max(0, Math.round((today - Date.UTC(y, m - 1, dd)) / 86_400_000)) : 0;
      return [d, age] as const;
    }),
  );

  const live = usable.filter((d) => ages.get(d)! < LIVE_WINDOW_DAYS);
  const last5 = usable.filter((d) => ages.get(d)! < 5);
  const prior = usable.filter((d) => ages.get(d)! >= 5);
  const newDets = last5.filter(
    (x) => !prior.some((p) => haversineKm(p.lat, p.lng, x.lat, x.lng) <= 2),
  );

  const minDate = usable.length ? usable[usable.length - 1]!.acq_date : null;
  const maxDate = usable.length ? usable[0]!.acq_date : null;
  let historyDays: number | null = null;
  if (minDate) {
    const [y, m, d] = minDate.split("-").map(Number);
    if (y && m && d) {
      const todayUtc = Date.UTC(todayUtc0.getUTCFullYear(), todayUtc0.getUTCMonth(), todayUtc0.getUTCDate());
      historyDays = Math.round((todayUtc - Date.UTC(y, m - 1, d)) / 86_400_000);
    }
  }

  const facts: SummaryFacts = {
    facilityId: facility.id,
    facilityName: facility.name,
    facilityType: facility.type,
    radiusKm,
    historyDays,
    historyFromDate: minDate,
    historyToDate: maxDate,
    baselineFrpMean: c.baseline ? c.baseline.mean : null,
    baselineFrpStdDev: c.baseline ? c.baseline.stdDev : null,
    baselineDetectionCount: c.baseline ? c.baseline.count : 0,
    rawMeanFrp: usable.length ? mean(usable.map((d) => d.frp)) : null,
    liveWindowDays: LIVE_WINDOW_DAYS,
    liveDetectionCount: live.length,
    liveMeanFrp: live.length ? mean(live.map((d) => d.frp)) : null,
    livePeakFrp: live.length ? Math.max(...live.map((d) => d.frp)) : null,
    latestFrp: c.latestFrp,
    latestDetection: c.latestTimestampUtc
      ? {
          timestampUtc: c.latestTimestampUtc,
          confidence: c.latestConfidence ?? "unknown",
          satellite: c.latestSatellite ?? "unknown",
        }
      : null,
    newDetectionsLast5d: newDets.length,
    newDetectionsPrior30dSameLocation: prior.length,
    nearestKm: c.nearestKm,
    status: c.status,
    healthScore: c.score,
  };

  const narrative = buildNarrative(facility, c, usable, ages, facts);
  return { classification: c, narrative, facts };
}

/* ── What Changed? + timeline (computed diffs, no template bank) ───────── */

function buildNarrative(
  facility: FacilityRow,
  c: Classification,
  usable: DetectionRow[],
  ages: Map<DetectionRow, number>,
  facts: SummaryFacts,
): FacilityNarrative {
  const whatChanged: WhatChangedRow[] = [];
  const radiusKm = FACILITY_RADIUS_KM;

  if (usable.length === 0) {
    whatChanged.push({
      kind: "ok",
      text: `No usable thermal detections within ${radiusKm} km in the last ${LIVE_WINDOW_DAYS} days`,
    });
  } else {
    const live = usable.filter((d) => ages.get(d)! < LIVE_WINDOW_DAYS);
    const priorAll = usable.filter((d) => ages.get(d)! >= LIVE_WINDOW_DAYS);
    const deltaCount = live.length - priorAll.length;

    whatChanged.push({
      kind: deltaCount > 0 ? "warning" : "ok",
      text: `Detections in the last ${LIVE_WINDOW_DAYS} days vs all prior history`,
      value: `${deltaCount >= 0 ? "+" : "−"}${Math.abs(deltaCount)}`,
      severity: deltaCount > 0 ? "watch" : undefined,
    });

    if (c.baseline && c.baseline.mean > 0 && c.liveMeanFrp != null) {
      const delta = formatDeltaPct(c.liveMeanFrp, c.baseline.mean);
      whatChanged.push({
        kind: c.liveMeanFrp > c.baseline.mean ? "warning" : "ok",
        text: "Mean FRP vs recency-weighted baseline",
        value: delta,
        severity:
          c.liveMeanFrp / c.baseline.mean > CRITICAL_FRP_RATIO
            ? "critical"
            : c.liveMeanFrp / c.baseline.mean > SUSPICIOUS_FRP_RATIO
              ? "suspicious"
              : undefined,
      });
    }

    if (c.newDetectionsLast5d > 0) {
      whatChanged.push({
        kind: "warning",
        text: "New detections in the last 5 days with no prior activity within 2 km",
        value: `+${c.newDetectionsLast5d}`,
        severity: "suspicious",
      });
    }

    if (c.baseline && c.baseline.stdDev != null && c.baseline.mean > 0) {
      const cv = c.baseline.stdDev / c.baseline.mean;
      whatChanged.push({
        kind: cv <= 0.45 ? "ok" : "warning",
        text: "FRP stability across the stored history (coefficient of variation)",
        value: `±${Math.round(cv * 100)}%`,
      });
    }

    if (c.nearestKm != null) {
      whatChanged.push({
        kind: "ok",
        text: "Nearest live detection to the asset",
        value: `${c.nearestKm.toFixed(1)} km`,
      });
    }

    // Fingerprint-aware signals — compare against stored baseline
    const baselineRow = getBaseline(facility.id);
    const fp = parseBaseline(baselineRow);
    if (fp && fp.totalDetections > 0) {
      // Spatial spread check
      if (fp.spreadKm > 0) {
        const liveDetsList = usable.filter((d) => ages.get(d)! < LIVE_WINDOW_DAYS);
        if (liveDetsList.length >= 2) {
          const cLat = liveDetsList.reduce((a, d) => a + d.lat, 0) / liveDetsList.length;
          const cLng = liveDetsList.reduce((a, d) => a + d.lng, 0) / liveDetsList.length;
          const liveSpread = Math.max(...liveDetsList.map((d) => haversineKm(cLat, cLng, d.lat, d.lng)));
          const spreadRatio = liveSpread / fp.spreadKm;
          if (spreadRatio > 1.3) {
            whatChanged.push({
              kind: "warning",
              text: "Thermal footprint expanding beyond historical spread",
              value: `+${Math.round((spreadRatio - 1) * 100)}%`,
              severity: spreadRatio > 2 ? "critical" : "suspicious",
            });
          }
        }
      }

      // Zone activity check
      const liveDetsList = usable.filter((d) => ages.get(d)! < LIVE_WINDOW_DAYS);
      for (const d of liveDetsList) {
        const q = d.lat >= facility.lat
          ? (d.lng >= facility.lng ? "NE" : "NW")
          : (d.lng >= facility.lng ? "SE" : "SW");
        if (fp.zoneActivity[q as keyof typeof fp.zoneActivity] === 0) {
          whatChanged.push({
            kind: "warning",
            text: `New activity detected in previously quiet ${q} zone`,
            value: "new",
            severity: "suspicious",
          });
          break; // one signal is enough
        }
      }

      // Detection frequency change
      if (fp.detectionsPerDay > 0) {
        const liveRate = liveDetsList.length / Math.max(1, LIVE_WINDOW_DAYS);
        const freqRatio = liveRate / fp.detectionsPerDay;
        if (freqRatio > 1.5) {
          whatChanged.push({
            kind: "warning",
            text: "Detection frequency elevated vs historical rate",
            value: `${freqRatio.toFixed(1)}×`,
            severity: freqRatio > 3 ? "critical" : "watch",
          });
        }
      }
    }
  }

  // newest-first real timeline rows
  const timeline: DetectionEvent[] = usable.slice(0, 12).map((d, i) => {
    const t = d.acq_time.padStart(4, "0");
    return {
      time: `${d.acq_date} ${t.slice(0, 2)}:${t.slice(2, 4)}`,
      text: `VIIRS detection · FRP ${d.frp.toFixed(1)} MW · brightness ${(d.bright_ti4 ?? 0).toFixed(0)} K · ${d.daynight === "N" ? "night" : "day"} pass${i === 0 ? " (most recent)" : ""}`,
      severity: c.status,
    };
  });

  // Classification from the new rule-based + ML hook pipeline
  const baselineRow = getBaseline(facility.id);
  const fp = parseBaseline(baselineRow);
  const classSignals = buildClassificationSignals(facility, usable, fp);
  const classification = classifyRuleBasedSync(classSignals);
  const classificationLabel = CLASSIFICATION_LABELS[classification];

  return {
    whatChanged,
    timeline,
    facts,
    templatedSummary: buildTemplatedSummary(facts),
    classification,
    classificationLabel,
  };
}

import { classifyRuleBased } from "./classificationService.js";
function classifyRuleBasedSync(signals: Parameters<typeof classifyRuleBased>[0]): ThermalClassification {
  return classifyRuleBased(signals);
}

/** Deterministic non-AI summary built ONLY from computed facts (§5 fallback). */
function buildTemplatedSummary(f: SummaryFacts): string {
  const s: string[] = [];
  if (f.baselineFrpMean != null) {
    s.push(
      `Across ${f.historyDays ?? "the available"} days of stored history, ${f.facilityName} has a recency-weighted baseline FRP of ${f.baselineFrpMean.toFixed(1)} MW from ${f.baselineDetectionCount} detections.`,
    );
  } else {
    s.push(
      `${f.facilityName} has no thermal detections in its stored FIRMS history within ${f.radiusKm} km.`,
    );
  }
  s.push(
    f.liveDetectionCount > 0
      ? `The last ${f.liveWindowDays} days show ${f.liveDetectionCount} detection${f.liveDetectionCount === 1 ? "" : "s"}${f.liveMeanFrp != null ? ` with mean FRP ${f.liveMeanFrp.toFixed(1)} MW` : ""}${f.latestDetection ? `, most recently ${f.latestDetection.timestampUtc} UTC` : ""}.`
      : `The last ${f.liveWindowDays} days show no thermal detections within ${f.radiusKm} km.`,
  );
  if (f.newDetectionsLast5d > 0) {
    s.push(
      `${f.newDetectionsLast5d} detection${f.newDetectionsLast5d === 1 ? "" : "s"} in the last 5 days appeared where no prior activity was recorded within 2 km.`,
    );
  }
  s.push(`Classification: ${f.status} · Thermal Health Score ${f.healthScore}/100.`);
  return s.join(" ");
}
