/**
 * scoringService — PURE scoring math (no DB access).
 *
 * ── RECENCY-WEIGHTED BASELINE (§4) ──────────────────────────────────────
 *
 * The baseline FRP mean is a full-history, recency-weighted mean so a
 * facility whose behaviour genuinely shifted this month is not masked by a
 * stale year-old average:
 *
 *   w(d) = exp(−ln(4) · d / 30)
 *
 *     d      = days before "today" of the detection's acquisition date
 *     30     = BASELINE_RECENT_DAYS — the mean age of the weighting kernel
 *     ln(4)  = ln(weightAtHorizon / weightToday), chosen so a detection
 *              BASELINE_RECENT_DAYS old carries exactly ¼ the weight of a
 *              detection from today. Half-life ≈ 15 days; weights decay to
 *              ~1/1000 by 5 months.
 *
 *   weightedMean     = Σ wᵢ·frpᵢ / Σ wᵢ
 *   weightedVariance = Σ wᵢ·(frpᵢ − μ)² / Σ wᵢ   (reliability-style weights)
 *
 * Documented in code because this is real analytical logic, not decoration.
 *
 * ── CLASSIFICATION ──────────────────────────────────────────────────────
 * The last LIVE_WINDOW_DAYS of detections are "recent behaviour"; they are
 * compared against the weighted baseline over the FULL stored history.
 */

import {
  BASELINE_RECENT_DAYS,
  FACILITY_RADIUS_KM,
  LIVE_WINDOW_DAYS,
} from "../config/regions.js";
import { haversineKm } from "../lib/geo.js";
import type { DetectionRow } from "../db/client.js";

/* ── tunables (single source of truth) ─────────────────────────────────── */

export const NEW_DETECTION_KM = 2;
export const SUSPICIOUS_FRP_RATIO = 1.3;
export const CRITICAL_FRP_RATIO = 2.0;
export const MIN_PERSISTENT_DETECTIONS = 2;
export const MAX_DETECTION_SPREAD_KM = 3;
export const PERSISTENT_FRP_CV = 0.45;
export const HEALTHY_BASELINE = 90;
/** Minimum weighted-sample count before a baseline is trusted. */
export const MIN_BASELINE_SAMPLES = 3;

export type RiskStatus = "normal" | "watch" | "suspicious" | "critical" | "unknown";

export const USABLE_CONFIDENCE = new Set(["h", "high", "m", "medium", "n", "nominal", ""]);

export const isUsable = (d: DetectionRow): boolean =>
  USABLE_CONFIDENCE.has(d.confidence.toLowerCase());

/* ── weighted baseline ─────────────────────────────────────────────────── */

export interface WeightedBaseline {
  mean: number;
  stdDev: number;
  weightSum: number;
  count: number;
  maxAgeDays: number;
}

export function baselineWeight(ageDays: number): number {
  return Math.exp((-Math.log(4) * ageDays) / BASELINE_RECENT_DAYS);
}

export function computeWeightedBaseline(
  frps: { frp: number; ageDays: number }[],
): WeightedBaseline | null {
  if (frps.length === 0) return null;
  let wsum = 0;
  let wfrp = 0;
  let maxAge = 0;
  for (const { frp, ageDays } of frps) {
    const w = baselineWeight(ageDays);
    wsum += w;
    wfrp += w * frp;
    if (ageDays > maxAge) maxAge = ageDays;
  }
  if (wsum <= 0) return null;
  const mean = wfrp / wsum;
  let wvar = 0;
  for (const { frp, ageDays } of frps) {
    const w = baselineWeight(ageDays);
    wvar += w * (frp - mean) ** 2;
  }
  return {
    mean,
    stdDev: Math.sqrt(Math.max(0, wvar / wsum)),
    weightSum: wsum,
    count: frps.length,
    maxAgeDays: maxAge,
  };
}

/* ── classification ────────────────────────────────────────────────────── */

export interface Classification {
  status: RiskStatus;
  score: number;
  latestFrp: number | null;
  latestTimestampUtc: string | null;
  latestConfidence: string | null;
  latestSatellite: string | null;
  nearestKm: number | null;
  detectionCount: number;
  liveCount: number;
  liveMeanFrp: number | null;
  livePeakFrp: number | null;
  baseline: WeightedBaseline | null;
  newDetectionsLast5d: number;
  newDetectionsPriorNearby: number;
}

export interface ClassifyInput {
  facility: { lat: number; lng: number };
  /** ALL stored detections near the facility, any age (from the DB). */
  detections: DetectionRow[];
  todayUtc: Date;
  radiusKm?: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function ageDaysBetween(fromIsoDate: string, today: Date): number {
  const [y, m, d] = fromIsoDate.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.round((todayUtc - Date.UTC(y, m - 1, d)) / 86_400_000));
}

export function detectionTimestampUtc(acqDate: string, acqTime: string): string {
  const t = acqTime.padStart(4, "0");
  return `${acqDate} ${t.slice(0, 2)}:${t.slice(2, 4)}`;
}

/** Coefficient of variation (stdev/mean) — 0 for small or degenerate sets. */
export function coefficientOfVariation(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  if (m === 0) return 0;
  const variance = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(variance) / m;
}

/* ── Thermal Health Score (100 − penalties) ─────────────────────────── */

export interface HealthScoreInput {
  detectionCount: number;
  meanFrp: number;
  cvFrp: number;
  hasRecentDetection: boolean;
  /** recent mean FRP vs weighted baseline (ratio, >1 = elevated) */
  frpRatioVsBaseline: number;
}

/**
 * Thermal Health Score — 100 minus penalties, clamped to [0, 100].
 * Same weighting philosophy as Pass 5, but the magnitude/trend terms now
 * compare against the recency-weighted FULL-history baseline instead of a
 * 10-day mean, so a quiet-but-degraded site and a chronically-flaring site
 * are scored against their own history, not each other's.
 */
export function computeHealthScore(input: HealthScoreInput): number {
  const { detectionCount, meanFrp, cvFrp, hasRecentDetection, frpRatioVsBaseline } = input;
  if (detectionCount === 0) return HEALTHY_BASELINE;

  // frequency: persistent heating inside the radius (10+ dets saturate)
  const frequencyPenalty = 28 * Math.min(1, detectionCount / 10);
  // magnitude: MW of radiative power near the asset = raw exposure
  const magnitudePenalty = 30 * Math.min(1, meanFrp / 100);
  // instability: erratic FRP behaviour
  const instabilityPenalty = 22 * Math.min(1, cvFrp / 0.6);
  // recency: active heating in the last 24 h
  const recencyPenalty = hasRecentDetection ? 20 : 0;
  // trend: recent FRP elevated vs the site's own weighted baseline.
  // ratio 1.0 → 0 pts, ratio 2.0 → 20 pts (saturates at 2× baseline).
  const trendPenalty =
    frpRatioVsBaseline > 1 ? 20 * Math.min(1, frpRatioVsBaseline - 1) : 0;

  const score =
    100 - frequencyPenalty - magnitudePenalty - instabilityPenalty - recencyPenalty - trendPenalty;
  return Math.round(Math.max(0, Math.min(100, score)));
}

/* ── classification entry point ──────────────────────────────────────── */

/**
 * Classify one facility from its real stored detection history.
 * `detections` must be ALL stored rows within a generous bounding box of
 * the facility (see analysisService) — the km filter is re-applied here.
 * Pure: same inputs → same outputs, no clock reads (`todayUtc` is injected).
 */
export function classifyFromDetections(input: ClassifyInput): Classification {
  const { facility, detections, todayUtc } = input;
  const radiusKm = input.radiusKm ?? FACILITY_RADIUS_KM;

  const withDist = detections
    .map((d) => ({ d, dist: haversineKm(facility.lat, facility.lng, d.lat, d.lng) }))
    .filter((x) => x.dist <= radiusKm)
    .sort((a, b) => a.dist - b.dist);

  const nearestKm = withDist.length ? withDist[0]!.dist : null;

  const newest = [...withDist].sort((a, b) =>
    a.d.acq_date < b.d.acq_date
      ? 1
      : a.d.acq_date > b.d.acq_date
        ? -1
        : b.d.acq_time.localeCompare(a.d.acq_time),
  )[0];

  const latestTimestampUtc = newest
    ? detectionTimestampUtc(newest.d.acq_date, newest.d.acq_time)
    : null;

  const usable = withDist.filter((x) => isUsable(x.d));

  if (usable.length === 0) {
    // Detections nearby but all unusable → unknown; nothing nearby → normal.
    const hasAny = withDist.length > 0;
    return {
      status: hasAny ? "unknown" : "normal",
      score: hasAny ? 40 : HEALTHY_BASELINE,
      latestFrp: newest ? newest.d.frp : null,
      latestTimestampUtc,
      latestConfidence: newest ? newest.d.confidence : null,
      latestSatellite: newest ? newest.d.satellite : null,
      nearestKm,
      detectionCount: 0,
      liveCount: 0,
      liveMeanFrp: null,
      livePeakFrp: null,
      baseline: null,
      newDetectionsLast5d: 0,
      newDetectionsPriorNearby: 0,
    };
  }

  const ages = new Map(
    usable.map((x) => [x, ageDaysBetween(x.d.acq_date, todayUtc)] as const),
  );

  // LIVE window = recent behaviour; BASELINE = full stored history.
  const live = usable.filter((x) => ages.get(x)! < LIVE_WINDOW_DAYS);
  const liveFrps = live.map((x) => x.d.frp);
  const liveMean = liveFrps.length ? mean(liveFrps) : mean(usable.map((x) => x.d.frp));
  const livePeak = liveFrps.length ? Math.max(...liveFrps) : Math.max(...usable.map((x) => x.d.frp));

  const baseline = computeWeightedBaseline(
    usable.map((x) => ({ frp: x.d.frp, ageDays: ages.get(x)! })),
  );

  // ── new detection (vs the FULL prior baseline, not a 10-day early half) ──
  const last5 = usable.filter((x) => ages.get(x)! < 5);
  const prior = usable.filter((x) => ages.get(x)! >= 5);
  const newDetections = last5.filter(
    (x) => !prior.some((p) => haversineKm(p.d.lat, p.d.lng, x.d.lat, x.d.lng) <= NEW_DETECTION_KM),
  );

  // ── persistent-source pattern (watch) ──
  const spreadKm =
    usable.length >= 2
      ? Math.max(
          ...usable.map((x) => {
            const cLat = mean(usable.map((u) => u.d.lat));
            const cLng = mean(usable.map((u) => u.d.lng));
            return haversineKm(cLat, cLng, x.d.lat, x.d.lng);
          }),
        )
      : 0;
  const cv = coefficientOfVariation(usable.map((x) => x.d.frp));
  const persistentPattern =
    usable.length >= MIN_PERSISTENT_DETECTIONS &&
    spreadKm <= MAX_DETECTION_SPREAD_KM &&
    cv <= PERSISTENT_FRP_CV;

  // ── escalation vs the facility's OWN weighted baseline ──
  const trustedBaseline = baseline && baseline.count >= MIN_BASELINE_SAMPLES ? baseline : null;
  const ratioVsBaseline = trustedBaseline && trustedBaseline.mean > 0 ? livePeak / trustedBaseline.mean : 0;
  const maxRatio = mean(usable.map((x) => x.d.frp)) > 0 ? livePeak / mean(usable.map((x) => x.d.frp)) : 0;

  let status: RiskStatus;
  if (trustedBaseline && ratioVsBaseline > CRITICAL_FRP_RATIO) {
    status = "critical";
  } else if (trustedBaseline && ratioVsBaseline >= SUSPICIOUS_FRP_RATIO) {
    status = "suspicious";
  } else if (newDetections.length > 0) {
    status = "suspicious";
  } else if (persistentPattern) {
    status = "watch";
  } else {
    status = "watch";
  }

  const score = computeHealthScore({
    detectionCount: live.length || usable.length,
    meanFrp: liveMean,
    cvFrp: cv,
    hasRecentDetection: ages.get(usable[0]!)! <= 1,
    frpRatioVsBaseline: ratioVsBaseline || maxRatio,
  });

  return {
    status,
    score,
    latestFrp: newest ? newest.d.frp : null,
    latestTimestampUtc,
    latestConfidence: newest ? newest.d.confidence : null,
    latestSatellite: newest ? newest.d.satellite : null,
    nearestKm,
    detectionCount: usable.length,
    liveCount: live.length,
    liveMeanFrp: liveFrps.length ? liveMean : null,
    livePeakFrp: liveFrps.length ? livePeak : null,
    baseline: trustedBaseline,
    newDetectionsLast5d: newDetections.length,
    newDetectionsPriorNearby: prior.length,
  };
}

/** Format a real delta as a signed percentage, e.g. "+40%" or "−18%". */
export function formatDeltaPct(current: number, baseline: number): string {
  if (baseline === 0) return current === 0 ? "±0%" : "n/a";
  const pct = Math.round(((current - baseline) / baseline) * 100);
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct)}%`;
}
