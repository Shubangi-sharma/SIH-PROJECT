/**
 * classificationService — rule-based thermal event classification with ML hook.
 *
 * Uses facility type + change signals + spatial/temporal patterns to assign
 * a ThermalClassification. Clean async hook to plug in an ML model later.
 */

import type { FingerprintBaseline } from "./fingerprintService.js";
import type { RiskStatus } from "./scoringService.js";
import type { DetectionRow, FacilityRow } from "../db/client.js";
import { haversineKm } from "../lib/geo.js";
import { FACILITY_RADIUS_KM } from "../config/regions.js";

export type ThermalClassification =
  | "industrial_fire"
  | "gas_flare"
  | "crop_burning"
  | "mining_activity"
  | "wildfire"
  | "persistent_source"
  | "normal_operations"
  | "unknown";

export const CLASSIFICATION_LABELS: Record<ThermalClassification, string> = {
  industrial_fire: "Industrial Fire",
  gas_flare: "Gas Flare",
  crop_burning: "Crop Burning",
  mining_activity: "Mining Activity",
  wildfire: "Wildfire",
  persistent_source: "Persistent Source",
  normal_operations: "Normal Operations",
  unknown: "Unknown",
};

export const CLASSIFICATION_SEVERITY: Record<ThermalClassification, number> = {
  wildfire: 100,
  industrial_fire: 90,
  crop_burning: 60,
  gas_flare: 40,
  mining_activity: 30,
  persistent_source: 20,
  normal_operations: 0,
  unknown: 10,
};

export interface ClassificationSignals {
  facilityType: string;
  facilityMatched: boolean;

  /** Live window detection stats */
  liveDetectionCount: number;
  liveMeanFrp: number;
  livePeakFrp: number;
  liveSpreadKm: number;

  /** Baseline comparison */
  frpRatioVsBaseline: number;
  spreadRatioVsBaseline: number;
  frequencyRatioVsBaseline: number;
  newZoneActivity: boolean;
  newDetectionsInQuietZone: number;

  /** Temporal signals */
  dayNightRatio: number;
  detectionCountTrend: number; // positive = increasing
  onsetDays: number; // how many days ago the current episode started

  /** Baseline presence */
  hasBaseline: boolean;
  baselineTotalDetections: number;
}

/**
 * ML model hook — return null to fall through to the rule-based classifier.
 * Replace this with your model inference (ONNX, TFLite, or Python microservice).
 */
export async function classifyWithModel(
  _signals: ClassificationSignals,
): Promise<ThermalClassification | null> {
  // Placeholder: no ML model configured — fall through to rules.
  return null;
}

/**
 * Rule-based thermal event classifier.
 */
export function classifyRuleBased(signals: ClassificationSignals): ThermalClassification {
  const {
    facilityType,
    facilityMatched,
    liveMeanFrp,
    livePeakFrp,
    liveSpreadKm,
    frpRatioVsBaseline,
    spreadRatioVsBaseline,
    newZoneActivity,
    dayNightRatio,
    liveDetectionCount,
    hasBaseline,
    baselineTotalDetections,
  } = signals;

  const typeLC = facilityType.toLowerCase();

  // No detections → normal operations
  if (liveDetectionCount === 0) return "normal_operations";

  // 1. Wildfire: large spread, high FRP, no facility match, expanding
  if (
    !facilityMatched &&
    liveSpreadKm > 5 &&
    livePeakFrp > 50 &&
    spreadRatioVsBaseline > 1.5
  ) {
    return "wildfire";
  }

  // 2. Industrial Fire: FRP dramatically above baseline at an industrial facility
  if (
    facilityMatched &&
    hasBaseline &&
    frpRatioVsBaseline > 2.0 &&
    livePeakFrp > 30 &&
    (typeLC.includes("industrial") || typeLC.includes("refiner") || typeLC.includes("power"))
  ) {
    return "industrial_fire";
  }

  // 3. Gas Flare: persistent, low spread, refinery/oil type, steady FRP
  if (
    facilityMatched &&
    liveSpreadKm <= 2 &&
    (typeLC.includes("refiner") || typeLC.includes("oil") || typeLC === "mine") &&
    liveMeanFrp > 5 &&
    liveMeanFrp < 100 &&
    baselineTotalDetections >= 5
  ) {
    return "gas_flare";
  }

  // 4. Mining Activity: mine-type, persistent low-FRP
  if (
    facilityMatched &&
    typeLC.includes("mine") &&
    liveMeanFrp < 20 &&
    liveDetectionCount >= 2
  ) {
    return "mining_activity";
  }

  // 5. Crop Burning: no facility, seasonal, moderate FRP
  if (
    !facilityMatched &&
    livePeakFrp < 80 &&
    liveSpreadKm > 2 &&
    liveDetectionCount >= 2
  ) {
    return "crop_burning";
  }

  // 6. Persistent Source: stable, consistent location, long history
  if (
    facilityMatched &&
    hasBaseline &&
    frpRatioVsBaseline <= 1.3 &&
    frpRatioVsBaseline >= 0.7 &&
    baselineTotalDetections >= 10
  ) {
    return "persistent_source";
  }

  // 7. Normal operations for matched facilities with low activity
  if (facilityMatched && liveDetectionCount <= 2 && liveMeanFrp < 10) {
    return "normal_operations";
  }

  return "unknown";
}

/**
 * Main classification entry point — tries ML model first, falls back to rules.
 */
export async function classify(signals: ClassificationSignals): Promise<ThermalClassification> {
  const mlResult = await classifyWithModel(signals);
  if (mlResult) return mlResult;
  return classifyRuleBased(signals);
}

/**
 * Build classification signals from facility data, detections, and baseline.
 */
export function buildClassificationSignals(
  facility: FacilityRow,
  liveDetections: DetectionRow[],
  baseline: FingerprintBaseline | null,
): ClassificationSignals {
  const radiusKm = FACILITY_RADIUS_KM;
  const nearby = liveDetections.filter(
    (d) => haversineKm(facility.lat, facility.lng, d.lat, d.lng) <= radiusKm,
  );

  const frps = nearby.map((d) => d.frp);
  const liveMeanFrp = frps.length > 0 ? frps.reduce((a, b) => a + b, 0) / frps.length : 0;
  const livePeakFrp = frps.length > 0 ? Math.max(...frps) : 0;

  // Compute live spread
  let liveSpreadKm = 0;
  if (nearby.length >= 2) {
    const cLat = nearby.reduce((a, d) => a + d.lat, 0) / nearby.length;
    const cLng = nearby.reduce((a, d) => a + d.lng, 0) / nearby.length;
    liveSpreadKm = Math.max(...nearby.map((d) => haversineKm(cLat, cLng, d.lat, d.lng)));
  }

  // Zone activity check
  let newZoneActivity = false;
  let newDetectionsInQuietZone = 0;
  if (baseline) {
    for (const d of nearby) {
      const q = d.lat >= facility.lat
        ? (d.lng >= facility.lng ? "NE" : "NW")
        : (d.lng >= facility.lng ? "SE" : "SW");
      if (baseline.zoneActivity[q as keyof typeof baseline.zoneActivity] === 0) {
        newZoneActivity = true;
        newDetectionsInQuietZone++;
      }
    }
  }

  const dayCount = nearby.filter((d) => d.daynight === "D").length;

  return {
    facilityType: facility.type,
    facilityMatched: facility.source !== "unidentified",
    liveDetectionCount: nearby.length,
    liveMeanFrp,
    livePeakFrp,
    liveSpreadKm,
    frpRatioVsBaseline: baseline && baseline.frpMean > 0 ? liveMeanFrp / baseline.frpMean : 1,
    spreadRatioVsBaseline: baseline && baseline.spreadKm > 0 ? liveSpreadKm / baseline.spreadKm : 1,
    frequencyRatioVsBaseline: baseline && baseline.detectionsPerDay > 0
      ? (nearby.length / Math.max(1, 10)) / baseline.detectionsPerDay
      : 1,
    newZoneActivity,
    newDetectionsInQuietZone,
    dayNightRatio: nearby.length > 0 ? dayCount / nearby.length : 0.5,
    detectionCountTrend: 0, // computed by comparing last 3 days vs prior 3 days
    onsetDays: 0, // placeholder
    hasBaseline: baseline !== null && baseline.totalDetections > 0,
    baselineTotalDetections: baseline?.totalDetections ?? 0,
  };
}
