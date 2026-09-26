/**
 * fireTagService — contextual "Predicted Fire Type" tagging (PURE, no DB).
 *
 * WHY: facility names like "Industrial Site #123456" are OSM fallbacks for
 * untagged polygons — the catalogue says nothing about what actually burns
 * there. A detection near such a site can be a farmer burning stubble, a
 * forest fire, a campfire, a structure fire near a settlement, a refinery
 * flare, an open waste dump fire, or a real industrial incident. This module
 * predicts WHICH from the same evidence an analyst would use:
 *
 *   • fire physics      — FRP magnitude, peak, day/night behaviour, spread,
 *                         brightness temperature (fire temperature proxy)
 *   • temporal pattern  — one-off vs persistent vs seasonal recurrence
 *   • environment       — land cover (crops/trees/built), distances to
 *                         industry/farmland, proximity flags (from the ML
 *                         service's /observations feature modules)
 *   • weather           — recent temperature/humidity/wind/rain at the site
 *                         (dry + windy + hot raises open-burning confidence;
 *                         sustained rain suppresses wildfire likelihood)
 *
 * The result is a PREDICTION with a confidence and the reasons that drove
 * it — never presented as a measurement. All inputs are optional; with no
 * evidence at all the tag is "unknown" (honest empty state, no fabrication).
 */

/* ── tags ────────────────────────────────────────────────────────────────── */

export type FireTag =
  | "crop_stubble_burn"
  | "forest_wildfire"
  | "grass_shrub_burn"
  | "campfire"
  | "structure_fire_settlement"
  | "industrial_incident"
  | "refinery_fire"
  | "gas_flare"
  | "mining_heat"
  | "waste_burning"
  | "unknown";

export const FIRE_TAG_META: Record<FireTag, { label: string; hex: string; blurb: string }> = {
  crop_stubble_burn: {
    label: "Agricultural burn",
    hex: "#E0A84C",
    blurb: "Stubble/crop-residue burning — seasonal, daytime, low-power, on farmland.",
  },
  forest_wildfire: {
    label: "Forest wildfire",
    hex: "#E06060",
    blurb: "Vegetation fire in wooded land — spreading, high radiant power.",
  },
  grass_shrub_burn: {
    label: "Grass/shrub burn",
    hex: "#CBB26A",
    blurb: "Open-land grass or scrub fire — moderate power, dispersed points.",
  },
  campfire: {
    label: "Campfire / small fire",
    hex: "#9CB86E",
    blurb: "Tiny, isolated, low-power heat source — human-scale, short-lived.",
  },
  structure_fire_settlement: {
    label: "Fire near settlement",
    hex: "#E08A52",
    blurb: "Hot, persistent heat close to built-up areas / housing.",
  },
  industrial_incident: {
    label: "Industrial incident",
    hex: "#E06060",
    blurb: "Elevated FRP at an industrial asset, above its own baseline.",
  },
  refinery_fire: {
    label: "Refinery / plant fire",
    hex: "#C46A6A",
    blurb: "Large sustained burning at a matched refinery or fuel-storage site.",
  },
  gas_flare: {
    label: "Gas flare",
    hex: "#9186C4",
    blurb: "Steady, single-point, continuous burning at energy infrastructure.",
  },
  mining_heat: {
    label: "Mining heat",
    hex: "#4FB3B3",
    blurb: "Persistent low-power heating at/near a mine or quarry.",
  },
  waste_burning: {
    label: "Waste burning",
    hex: "#A0927C",
    blurb: "Persistent low-to-moderate heat on open/bare ground near settlement — open dumping.",
  },
  unknown: {
    label: "Unclassified",
    hex: "#5D6570",
    blurb: "Not enough evidence to predict the fire type yet.",
  },
};

/* ── inputs ──────────────────────────────────────────────────────────────── */

/** Live environment block (verbatim from pyrosense_ml /observations). */
export interface FireTagEnvironment {
  landCover?: Record<string, number | null>;
  dominantLandCover?: string | null;
  vegetationRatio?: number | null;
  /** display-key → km (industrial, power, mining, fuel, transport, agriculture) */
  distancesKm?: Record<string, number | null>;
  /** display-key → flag (built etc. may appear; unknowns are null) */
  proximityFlags?: Record<string, boolean | null>;
  /** true when the environment blocks failed to load (reasons note it) */
  degraded?: boolean;
}

/**
 * Live weather aggregates for the fire's location (from the ML service's
 * /observations weather block — recent past over the lookback window).
 * Every field optional; null = source gap (never fabricate).
 */
export interface FireTagWeather {
  meanTemperatureC?: number | null;
  maxTemperatureC?: number | null;
  meanRelativeHumidity?: number | null;
  minRelativeHumidity?: number | null;
  meanWindSpeedMs?: number | null;
  maxWindSpeedMs?: number | null;
  totalPrecipitation?: number | null;
}

export interface FireTagInput {
  /** confidence-weighted mean FRP of the live window, MW (null = none) */
  liveMeanFrp: number | null;
  /** peak FRP of the live window, MW */
  livePeakFrp: number | null;
  /** usable detections in the live window */
  liveDetectionCount: number;
  /** usable detections across the whole stored history */
  totalDetections: number;
  /** distinct acquisition dates across history */
  uniqueDays: number;
  /** max pairwise-ish spread of live detections, km (0 for single point) */
  spreadKm: number | null;
  /** share of live detections from night passes (0–1); null when unknown */
  nightRatio: number | null;
  /** facility type from the catalogue, when the fire matches a facility */
  facilityType: string | null;
  /** true when the detection is NOT inside any facility corroboration radius */
  unmatched: boolean;
  environment?: FireTagEnvironment | null;
  /** live weather at the point (optional; strengthens open-burn vs flare splits) */
  weather?: FireTagWeather | null;
  /** latest VIIRS brightness (channel I4, Kelvin) — fire-temperature proxy */
  latestBrightnessK?: number | null;
  /** the facility's own coordinates, when known (contextual reasons) */
  facilityLat?: number | null;
  facilityLng?: number | null;
}

export interface FireTagResult {
  tag: FireTag;
  confidence: number; // 0–1 — model-style belief, not a probability
  /** human-readable reasons: the evidence that drove this prediction */
  reasons: string[];
  /** short label for chips (FIRE_TAG_META[tag].label) */
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function landShare(env: FireTagEnvironment | null | undefined, keys: string[]): number | null {
  if (!env?.landCover) return null;
  let sum = 0;
  let any = false;
  for (const k of keys) {
    const v = env.landCover[k];
    if (isNum(v)) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : null;
}

/** Environment-based leanings — each returns evidence weight and a reason. */
function environmentEvidence(
  env: FireTagEnvironment | null | undefined,
): { crop: number; forest: number; settlement: number; industrial: number; reasons: string[] } {
  const out = { crop: 0, forest: 0, settlement: 0, industrial: 0, reasons: [] as string[] };
  if (!env) return out;

  const veg = landShare(env, ["trees", "grass", "flooded_vegetation", "crops", "shrub_and_scrub"]);
  const trees = env.landCover ? env.landCover["trees"] : null;
  const crops = env.landCover ? env.landCover["crops"] : null;
  const built = env.landCover ? env.landCover["built"] : null;

  if (isNum(crops) && crops >= 0.25) {
    out.crop += 1.5;
    out.reasons.push(`cropland dominates the surroundings (${Math.round(crops * 100)}%)`);
  } else if (isNum(crops) && crops >= 0.1) {
    out.crop += 0.6;
    out.reasons.push(`some cropland nearby (${Math.round(crops * 100)}%)`);
  }
  if (isNum(trees) && trees >= 0.3) {
    out.forest += 1.5;
    out.reasons.push(`wooded land dominates (${Math.round(trees * 100)}% tree cover)`);
  } else if (isNum(trees) && trees >= 0.12) {
    out.forest += 0.6;
    out.reasons.push(`trees nearby (${Math.round(trees * 100)}% cover)`);
  }
  if (isNum(built) && built >= 0.15) {
    out.settlement += 1.2;
    out.reasons.push(`built-up area close by (${Math.round(built * 100)}%)`);
  }
  if (isNum(veg) && veg < 0.08 && isNum(built) && built < 0.05) {
    // bare/desert/industrial dirt — weak vegetation signal, slight industrial lean
    out.industrial += 0.3;
  }

  const dist = env.distancesKm ?? {};
  const dAgri = dist["distance_to_agriculture_km"];
  const dInd = dist["distance_to_industrial_km"] ?? dist["distance_to_power_km"] ?? dist["distance_to_fuel_storage_km"];
  const dMine = dist["distance_to_mining_km"];

  if (isNum(dAgri) && dAgri <= 2) {
    out.crop += 1.2;
    out.reasons.push(`farmland within ${dAgri < 1 ? `${Math.round(dAgri * 1000)} m` : `${dAgri.toFixed(1)} km`}`);
  }
  if (isNum(dInd) && dInd <= 2) {
    out.industrial += 1.2;
    out.reasons.push(`industrial infrastructure within ${dInd < 1 ? `${Math.round(dInd * 1000)} m` : `${dInd.toFixed(1)} km`}`);
  }
  if (isNum(dMine) && dMine <= 5) {
    out.industrial += 0.4;
    out.reasons.push(`mining site within ${dMine.toFixed(1)} km`);
  }

  const flags = env.proximityFlags ?? {};
  if (flags["near_agriculture_1km"] === true) out.crop += 0.5;
  if (flags["near_industrial_500m"] === true) out.industrial += 0.8;
  if (flags["near_power_1km"] === true) out.industrial += 0.5;

  return out;
}

/* ── the scorer ──────────────────────────────────────────────────────────── */

/**
 * Score every candidate fire type from the evidence and pick the winner.
 * Deterministic, explainable, and total: with zero evidence it returns
 * "unknown" at confidence 0.
 */
export function predictFireTag(input: FireTagInput): FireTagResult {
  const {
    liveMeanFrp,
    livePeakFrp,
    liveDetectionCount,
    totalDetections,
    uniqueDays,
    spreadKm,
    nightRatio,
    facilityType,
    unmatched,
    environment,
    weather,
    latestBrightnessK,
  } = input;

  const reasons: string[] = [];

  // No thermal evidence at all → honest unknown.
  if (liveDetectionCount === 0 || liveMeanFrp == null || livePeakFrp == null) {
    return { tag: "unknown", confidence: 0, reasons: ["no usable thermal detections in the live window"] };
  }

  const env = environmentEvidence(environment);
  reasons.push(...env.reasons);

  // ── physical evidence shaping ────────────────────────────────────────────
  const tiny = livePeakFrp < 5 && liveMeanFrp < 3;
  const lowPower = liveMeanFrp < 20 && livePeakFrp < 60;
  const highPower = liveMeanFrp >= 60 || livePeakFrp >= 120;
  const veryHot = livePeakFrp >= 150;
  const wideSpread = spreadKm != null && spreadKm > 3;
  const multiPoint = liveDetectionCount >= 3;
  const persistent = totalDetections >= 10 && uniqueDays >= 5;
  const mostlyNight = nightRatio != null && nightRatio >= 0.6;
  const mostlyDay = nightRatio != null && nightRatio <= 0.25;

  // Brightness is a fire-temperature proxy: very bright mid-IR (I4) rows
  // (>360 K) indicate flaming combustion, not passive industrial heating.
  const hotBright = latestBrightnessK != null && latestBrightnessK >= 360;
  const coolBright = latestBrightnessK != null && latestBrightnessK > 0 && latestBrightnessK < 325;

  // Weather shaping — recent conditions at the site (Open-Meteo via the ML
  // service). Dry + windy + hot raises open-burning confidence (any outdoor
  // fire spreads easier and burns hotter); sustained rain suppresses it.
  const dryAir = weather?.minRelativeHumidity != null && weather.minRelativeHumidity <= 35;
  const windy = weather?.maxWindSpeedMs != null && weather.maxWindSpeedMs >= 5;
  const wetWeek = weather?.totalPrecipitation != null && weather.totalPrecipitation >= 40;
  const hotDays = weather?.maxTemperatureC != null && weather.maxTemperatureC >= 35;

  if (tiny) reasons.push(`very low heat output (peak ${livePeakFrp.toFixed(1)} MW)`);
  else if (highPower) reasons.push(`high radiant power (peak ${livePeakFrp.toFixed(0)} MW, mean ${liveMeanFrp.toFixed(0)} MW)`);
  if (wideSpread) reasons.push(`detections spread over ${spreadKm!.toFixed(1)} km`);
  if (multiPoint) reasons.push(`${liveDetectionCount} detections in the live window`);
  if (persistent) reasons.push(`recurring across ${uniqueDays} distinct days of history`);
  if (mostlyNight) reasons.push("mostly night-time passes");
  if (mostlyDay) reasons.push("mostly day-time passes");
  if (hotBright) reasons.push(`hot combustion signature (${latestBrightnessK!.toFixed(0)} K brightness)`);
  if (dryAir && windy) reasons.push("dry, windy weather favouring fire spread");
  if (wetWeek) reasons.push("recent heavy rain suppressing open burning");

  // ── candidate scores ─────────────────────────────────────────────────────
  const typeLC = (facilityType ?? "").toLowerCase();
  const matchedRefinery =
    !unmatched &&
    (typeLC.includes("refin") || typeLC.includes("petro") || typeLC.includes("gas") || typeLC.includes("fuel"));
  const matchedIndustrial =
    !unmatched && (typeLC.includes("power") || typeLC.includes("industrial"));
  const matchedMine = !unmatched && (typeLC.includes("mine") || typeLC.includes("quarry"));

  let crop = env.crop * 1.4;
  let forest = env.forest * 1.4;
  let grass = 0;
  let camp = 0;
  let structure = env.settlement * 1.2;
  let industrial = env.industrial * 0.8;
  let refinery = 0;
  let flare = 0;
  let mining = 0;
  let waste = 0;

  // Weather nudges (small, physical — never decisive alone): dry, windy,
  // hot conditions favour open burning; sustained rain suppresses it.
  const openBurnBoost =
    (dryAir ? 0.5 : 0) + (windy ? 0.4 : 0) + (hotDays ? 0.3 : 0) - (wetWeek ? 0.8 : 0);
  if (openBurnBoost > 0) {
    crop += openBurnBoost * 0.6;
    grass += openBurnBoost * 0.5;
    forest += openBurnBoost * 0.4;
    waste += openBurnBoost * 0.4;
  }

  // crop stubble burning: farmland + low/moderate power + day + tight cluster
  if (lowPower) crop += 1.2;
  if (mostlyDay) crop += 0.8;
  if (!wideSpread) crop += 0.4;
  if (liveDetectionCount <= 6) crop += 0.3;

  // forest wildfire: treed env + high power and/or wide spread
  if (highPower) forest += 1.2;
  if (wideSpread) forest += 1.4;
  if (veryHot) forest += 0.6;
  if (hotBright && env.forest > 0) forest += 0.5;
  if (wetWeek && env.forest > 0) forest -= 0.8; // sustained rain: wildfire unlikely
  if (liveDetectionCount >= 2) forest += 0.2;

  // grass/shrub burn: open vegetation, moderate power, some spread, no trees
  if (!wideSpread && spreadKm != null && spreadKm > 0.5) grass += 0.6;
  if (lowPower || highPower) grass += 0.3;
  const grassShare = landShare(environment, ["grass", "shrub_and_scrub"]);
  if (grassShare != null && grassShare >= 0.15) {
    grass += 1.0;
    reasons.push(`grass/scrub land nearby (${Math.round(grassShare * 100)}%)`);
  }

  // campfire: tiny, isolated, any env
  if (tiny) camp += 1.6;
  if (liveDetectionCount === 1) camp += 0.8;
  if (!wideSpread) camp += 0.2;
  if (spreadKm == null || spreadKm < 0.3) camp += 0.3;

  // structure fire near settlement: built env + hot + persistent-ish.
  // A MATCHED industrial/mine facility is by definition not a settlement —
  // the settlement tag is suppressed there (built-up ratios around plants
  // otherwise steal the prediction from gas_flare / industrial_incident).
  // Fire IN built-up area (structures) vs fire ON open ground NEAR a
  // settlement (dumps): when bare ground dominates the built share, the
  // heat sits on open land — the settlement-fire pattern is suppressed.
  const builtShare = environment?.landCover ? environment.landCover["built"] : null;
  const bareShare = environment?.landCover ? environment.landCover["bare"] : null;
  const openGround = isNum(bareShare) && bareShare >= 0.35 && (!isNum(builtShare) || bareShare > builtShare);
  if (isNum(builtShare)) {
    if (builtShare >= 0.15 && !openGround && (livePeakFrp >= 30 || persistent)) structure += 1.0;
  }
  if (persistent && env.settlement > 0) structure += 0.6;
  if (openGround) structure -= 0.6;
  if (matchedIndustrial || matchedMine || matchedRefinery) structure *= 0.3;

  // waste burning: open/bare ground at settlement edges + low-moderate
  // steady heat. Open dumps sit on bare ground and burn persistently at
  // low power — distinct from an acute structural fire (hot) and from
  // agricultural burning (cropland, seasonal).
  if (env.settlement > 0 && openGround) waste += 1.4;
  if (env.settlement > 0 && lowPower && persistent) waste += 1.2;
  if (coolBright && env.settlement > 0) waste += 0.4;
  if (matchedIndustrial || matchedRefinery || matchedMine) waste *= 0.4;

  // industrial incident: matched facility + elevated power, or strong industrial env + very hot
  if (matchedIndustrial && livePeakFrp >= 30) industrial += 2.0;
  if (matchedIndustrial && !lowPower) industrial += 0.8;
  if (env.industrial >= 1.5 && veryHot) industrial += 1.4;

  // refinery fire: matched refinery/fuel site + LARGE sustained burning —
  // distinct from a routine flare (low steady point) and from a generic
  // industrial incident (any industrial asset).
  if (matchedRefinery && highPower) refinery += 2.2;
  if (matchedRefinery && veryHot) refinery += 1.0;
  if (matchedRefinery && hotBright) refinery += 0.6;
  if (matchedRefinery && wideSpread) refinery += 0.4;

  // gas flare: matched energy/industrial asset + low power + persistent + tight point
  if ((matchedRefinery || matchedIndustrial) && lowPower && persistent) flare += 1.6;
  if ((matchedRefinery || matchedIndustrial) && persistent && spreadKm != null && spreadKm <= 0.5) flare += 0.8;
  if ((matchedRefinery || matchedIndustrial) && liveDetectionCount <= 2 && persistent) flare += 0.6;

  // mining heat: matched mine + low power persistent
  if (matchedMine && lowPower) mining += 1.8;
  if (matchedMine && persistent) mining += 0.5;

  const scores: [FireTag, number][] = [
    ["crop_stubble_burn", crop],
    ["forest_wildfire", forest],
    ["grass_shrub_burn", grass],
    ["campfire", camp],
    ["structure_fire_settlement", structure],
    ["industrial_incident", industrial],
    ["refinery_fire", refinery],
    ["gas_flare", flare],
    ["mining_heat", mining],
    ["waste_burning", waste],
  ];
  scores.sort((a, b) => b[1] - a[1]);

  const [topTag, topScore] = scores[0]!;
  const runnerUp = scores[1]![1];

  // No candidate gathered meaningful evidence → unknown (never guess wildly).
  if (topScore < 1.0) {
    return {
      tag: "unknown",
      confidence: 0,
      reasons: ["environment and fire signals did not match a known burn pattern"],
    };
  }

  // Confidence: dominance over the runner-up, saturating ~0.92. Brightness
  // and weather evidence each add a small trust bump when present (capped).
  const margin = topScore - runnerUp;
  let confidence = 0.35 + margin * 0.28 + Math.min(topScore, 4) * 0.05;
  if (latestBrightnessK != null) confidence += 0.04;
  if (weather && Object.values(weather).some((v) => isNum(v))) confidence += 0.04;
  confidence = Math.max(0.15, Math.min(0.92, confidence));

  return { tag: topTag, confidence: Math.round(confidence * 100) / 100, reasons: reasons.slice(0, 6) };
}
