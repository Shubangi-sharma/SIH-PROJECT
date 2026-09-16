/**
 * PYROSENSE — training medians (client display copy).
 *
 * Mirrors pyrosense_ml/app/feature_schema.py::TRAINING_MEDIANS — the values
 * the model's feature engineering uses as deviation reference points. Kept in
 * the frontend ONLY to size explainability bars and format feature values;
 * the authoritative copy lives in the ML service. If a feature is missing
 * here, its deviation renders as 0 rather than a fabricated number.
 *
 * NOTE: keep in sync when pyrosense_ml re-trains (feature_schema_version bump).
 */

export const TRAINING_MEDIANS_CLIENT: Record<string, number> = {
  // detection history (from pyrosense_ml SQLite)
  detection_count: 12,
  unique_days: 8,
  active_duration_days: 9,
  frp_mean: 18.5,
  frp_max: 34.2,
  frp_min: 6.1,
  frp_std: 9.4,
  frp_latest: 21.3,
  mean_brightness: 318.2,
  latest_brightness: 321.5,
  daynight_ratio: 0.58,
  mean_confidence: 0.72,

  // OSM surroundings (km to nearest matching infrastructure)
  distance_to_industrial_km: 2.4,
  distance_to_power_plant_km: 18.7,
  distance_to_mining_km: 27.3,
  distance_to_fuel_storage_km: 9.8,
  distance_to_agriculture_km: 1.2,
  distance_to_transport_km: 0.6,
  nearest_settlement_km: 3.9,

  // Dynamic World land-cover ratios (bound to [0, 1])
  lc_built_ratio: 0.18,
  lc_crops_ratio: 0.34,
  lc_forest_ratio: 0.22,
  lc_water_ratio: 0.04,
  lc_grass_ratio: 0.12,
  lc_bare_ratio: 0.07,

  // Open-Meteo aggregates
  temp_mean_c: 27.4,
  humidity_mean: 62,
  wind_mean_ms: 2.8,
  precipitation_mm: 3.1,
};
