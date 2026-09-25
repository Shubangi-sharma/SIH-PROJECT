/**
 * PYROSENSE — ML feature presentation helpers (client-safe).
 *
 * Display-only mirrors of pyrosense_ml/app/ml/risk_score.py::key_contributors
 * — the backend ranks contributors by  importance × deviation  where deviation
 * is the symmetric log-ratio vs the TRAINING_MEDIANS (land-cover ratios use an
 * absolute delta). To render proportional bars without re-fetching the
 * training medians, we recompute the same *shape* of deviation from the value
 * the backend already returned. These helpers never feed anything back into
 * the model or the ranking the backend shipped — they only size UI bars, and
 * the numeric contribution text always equals importance × this deviation.
 */

import { TRAINING_MEDIANS_CLIENT } from "./featureMedians";

/** Land-cover ratio features — bound to [0, 1], absolute-delta deviation. */
const RATIO_FEATURES = new Set(
  Object.keys(TRAINING_MEDIANS_CLIENT).filter((n) => n.startsWith("lc_")),
);

const EPS = 1e-9;

/**
 * Display deviation for one contributing feature — the same formula
 * risk_score.py uses, evaluated for the bar chart. Capped at 10 like the
 * backend (e^10 ≈ 22000× off-median is already maximal).
 *  - lc_* ratios: |v − median| (bound to [0,1] features)
 *  - everything else: |log((|v|+ε)/(|median|+ε))|
 *  - categorical (string) values: nominal 1.0, as upstream
 *  - unknown median: 0 (renders no bar rather than a fabricated one)
 */
export function contributionDeviationFor(feature: string, value: number | string): number {
  if (typeof value === "string") return 1.0;
  const median = TRAINING_MEDIANS_CLIENT[feature];
  if (median == null) return 0;
  if (RATIO_FEATURES.has(feature)) {
    return Math.min(Math.abs(value - median), 10);
  }
  return Math.min(Math.abs(Math.log((Math.abs(value) + EPS) / (Math.abs(median) + EPS))), 10);
}

/** Compact value formatting for feature readouts (mono, unit-aware). */
export function formatFeatureValue(v: number | string): string {
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  if (abs >= 1000) return `${Math.round(v).toLocaleString("en-US")}`;
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

/**
 * Human-readable names for the 36 model features (snake_case → words), with
 * hand-curated labels for the ones judges are most likely to ask about.
 * Unknown features fall through to their raw name — honest and readable.
 */
const CURATED: Record<string, string> = {
  distance_to_industrial_km: "Distance to industry",
  distance_to_power_plant_km: "Distance to power plant",
  distance_to_mining_km: "Distance to mining site",
  distance_to_fuel_storage_km: "Distance to fuel storage",
  distance_to_agriculture_km: "Distance to farmland",
  distance_to_transport_km: "Distance to roads / rail",
  nearest_settlement_km: "Nearest settlement",
  dominant_land_cover: "Dominant land cover",
  frp_mean: "Mean FRP",
  frp_max: "Peak FRP",
  frp_min: "Min FRP",
  frp_std: "FRP variability",
  frp_latest: "Latest FRP",
  detection_count: "Detection count",
  unique_days: "Unique active days",
  active_duration_days: "Active duration",
  mean_brightness: "Mean brightness",
  latest_brightness: "Latest brightness",
  daynight_ratio: "Day / night ratio",
  mean_confidence: "Mean confidence",
};

/** Curated label → raw name fallback, plus mechanical snake_case → Title Case. */
export function featureLabel(feature: string): string {
  if (CURATED[feature]) return CURATED[feature];
  const spaced = feature.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  // lc_* ratios read better with their prefix spelled out
  return spaced.replace(/^Lc /, "Land cover: ");
}

export const FEATURE_LABELS = CURATED;
