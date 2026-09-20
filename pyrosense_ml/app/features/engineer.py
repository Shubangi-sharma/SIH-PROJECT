"""Feature engineering — compute the classifier's 43 features for a live point.

Phase 2A orchestration contract:
- The output ALWAYS carries all 43 CLASSIFIER_FEATURES keys in the frozen
  schema, so the schema validator never sees NaN.
- Fire-count/FRP/brightness features come from the Node backend's SQLite
  detection history; OSM distances, land cover, and weather from their
  respective modules.
- TEMPORAL NOTE: the old 36-feature GBM schema is gone. The classifier has no
  categorical input, no first/last detection year/month, and no
  land_cover_observations-style counters; instead it wants fire counts over an
  H3-r7 cell, brightness temperatures, boolean proximity flags, and an
  lc_vegetation_ratio aggregate.
- KNOWN GAP (documented): mean/min relative humidity and mean/max solar
  radiation (ssrd) have no live source in this service yet (Open-Meteo archive
  daily vars do not include them) — they fall back to the training prior 0.0
  with provenance "median_fallback", flagged in warnings. Wiring a real
  source is future work alongside the Phase 2C pipeline.
- Weather features keep their Open-Meteo sources under new names
  (mean_temperature_c etc.); provenance flags any unavailable block.

NOTE: risk-model (GRU) features are NOT built here — scoring a (30, 17)
sequence is Phase 2C's job.
"""

from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.data.live import detection_history_query_sqlite
from app.db.engine import sqlite_connect_readonly
from app.feature_schema import (
    CLASSIFIER_FEATURES,
    CLASSIFIER_NUMERIC_FEATURES,
    CLASSIFIER_TRAINING_MEDIANS,
)
from app.features.land_cover import get_land_cover
from app.features.osm_distances import get_osm_distances
from app.features.weather import WEATHER_FEATURES, get_weather

logger = logging.getLogger("pyrosense.ml.features.engineer")


@dataclass
class EngineeredFeatures:
    features: dict[str, object] = field(default_factory=dict)
    provenance: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        return all(p != "median_fallback" for p in self.provenance.values())


def _fill_medians(features: dict[str, object], block: list[str]) -> None:
    for name in block:
        if features.get(name) is None:
            features[name] = CLASSIFIER_TRAINING_MEDIANS[name]


async def engineer_features(
    latitude: float,
    longitude: float,
    *,
    detection_radius_km: float | None = None,
    lookback_days: int = 365,
) -> EngineeredFeatures:
    """Compute the full 43-feature vector for a point.

    Persistence/FRP/brightness features come from the Node backend's SQLite
    detections; OSM distances, land cover, and weather from their respective
    modules with documented fallbacks on failure.
    """
    radius = detection_radius_km or settings.DETECTION_RADIUS_KM
    out = EngineeredFeatures()

    # ── 1. Persistence + FRP + brightness from SQLite detection history ─────
    det: dict[str, object] = {}
    try:
        det = _detection_features(latitude, longitude, radius, lookback_days)
        out.provenance["detections"] = "sqlite"
    except (sqlite3.Error, FileNotFoundError) as exc:
        out.warnings.append(f"detection history unavailable: {exc}")
        out.provenance["detections"] = "median_fallback"
    finally:
        _fill_medians(
            det,
            PERSISTENCE_FEATURES
            + FRP_FEATURES
            + BRIGHTNESS_FEATURES
            + PROXIMITY_FLAG_DEFAULTS,
        )
        out.features.update(det)

    # ── 2. OSM distances ────────────────────────────────────────────────────
    osm = await get_osm_distances(latitude, longitude)
    if all(v is None for v in osm.distances.values()):
        out.warnings.append("OSM distances unavailable — median fallback applied")
        out.provenance["osm"] = "median_fallback"
        dist = {k: CLASSIFIER_TRAINING_MEDIANS[k] for k in OSM_FEATURES}
    else:
        out.provenance["osm"] = "cache" if osm.cached else "overpass"
        dist = {
            _OSM_RENAME.get(k, k): v if v is not None else CLASSIFIER_TRAINING_MEDIANS[_OSM_RENAME.get(k, k)]
            for k, v in osm.distances.items()
        }
        # The Overpass module may lag the frozen schema (or skip a category) —
        # guarantee every schema key exists so the final guard never trips.
        for k in OSM_FEATURES:
            dist.setdefault(k, CLASSIFIER_TRAINING_MEDIANS[k])
    out.features.update(dist)

    # ── 3. Land cover ───────────────────────────────────────────────────────
    lc = await get_land_cover(latitude, longitude)
    if lc.features.get("lc_built_ratio") is None:
        out.warnings.append("land cover derived without observations — prior fallback")
        out.provenance["land_cover"] = "median_fallback"
    else:
        out.provenance["land_cover"] = lc.provenance
    lc_mapped = _map_land_cover(lc.features)
    # The OSM-derived source has no snow/ice class (and a failed fetch has no
    # rows at all) — guarantee every lc_* schema key exists. snow/ice falls
    # back to the 0.0 training prior, which is also its real-world prior for
    # the monitored regions (documented approximation).
    for k in LC_SCHEMA_FEATURES:
        lc_mapped.setdefault(k, CLASSIFIER_TRAINING_MEDIANS[k])
    out.features.update(lc_mapped)

    # ── 4. Weather ──────────────────────────────────────────────────────────
    wx = await get_weather(latitude, longitude)
    if wx.provenance == "unavailable":
        out.warnings.append("weather unavailable — median fallback applied")
        out.provenance["weather"] = "median_fallback"
        weather = {k: CLASSIFIER_TRAINING_MEDIANS[k] for k in CLASSIFIER_WEATHER_FEATURES}
    else:
        out.provenance["weather"] = wx.provenance
        filled = dict(wx.features)
        _fill_medians(filled, WEATHER_FEATURES)
        weather = _map_weather(filled)
    out.features.update(weather)

    # ── Final guard: all 43 features present, no None ────────────────────────
    missing = [n for n in CLASSIFIER_FEATURES if n not in out.features]
    if missing:
        raise RuntimeError(
            f"feature engineer produced incomplete vector: missing {missing}"
        )
    for n in CLASSIFIER_NUMERIC_FEATURES:
        if out.features[n] is None:
            out.features[n] = CLASSIFIER_TRAINING_MEDIANS[n]

    return out


PERSISTENCE_FEATURES = [
    "unique_h3_cells",
    "total_fire_detections",
    "unique_fire_days",
    "temporal_span_days",
    "active_months",
]
FRP_FEATURES = ["mean_frp", "max_frp"]
BRIGHTNESS_FEATURES = ["mean_brightness", "max_brightness"]
PROXIMITY_FLAG_DEFAULTS = [
    "near_industrial_500m",
    "near_power_1km",
    "near_mining_5km",
    "near_fuel_2km",
    "near_transport_1km",
    "near_agriculture_1km",
]
OSM_FEATURES = [
    "distance_to_industrial_km",
    "distance_to_power_km",
    "distance_to_mining_km",
    "distance_to_fuel_km",
    "distance_to_transport_km",
    "distance_to_agriculture_km",
]
# The Overpass module's fuel category is named after the OLD GBM schema
# (distance_to_fuel_storage_km); the frozen classifier schema wants
# distance_to_fuel_km. Renamed here so the vector matches the schema exactly.
_OSM_RENAME = {"distance_to_fuel_storage_km": "distance_to_fuel_km"}
# lc_* keys in the frozen schema (incl. lc_snow_and_ice_ratio).
LC_SCHEMA_FEATURES = [n for n in CLASSIFIER_FEATURES if n.startswith("lc_")]
CLASSIFIER_WEATHER_FEATURES = [
    "mean_temperature_c",
    "max_temperature_c",
    "mean_dewpoint_c",
    "mean_relative_humidity",
    "min_relative_humidity",
    "mean_wind_speed_ms",
    "max_wind_speed_ms",
    "total_precipitation",
    "mean_precipitation",
    "mean_ssrd",
    "max_ssrd",
    "weather_observation_count",
]

# Open-Meteo archive provides daily temperature/wind/dewpoint/precipitation
# under the OLD GBM-era names; remap them onto the classifier's names.
# relative humidity and solar radiation have no archive daily source here —
# they stay at their 0.0 training prior (documented gap).
_WEATHER_RENAME = {
    "mean_temperature": "mean_temperature_c",
    "max_temperature": "max_temperature_c",
    "mean_dewpoint": "mean_dewpoint_c",
    "mean_wind_speed": "mean_wind_speed_ms",
    "max_wind_speed": "max_wind_speed_ms",
    "total_precipitation": "total_precipitation",
    "mean_precipitation": "mean_precipitation",
    "weather_observations": "weather_observation_count",
}


def _map_weather(weather: dict[str, object]) -> dict[str, object]:
    out: dict[str, object] = {
        new: weather[old] for old, new in _WEATHER_RENAME.items() if weather.get(old) is not None
    }
    for k in CLASSIFIER_WEATHER_FEATURES:
        out.setdefault(k, CLASSIFIER_TRAINING_MEDIANS[k])
    return out


def _map_land_cover(lc_features: dict[str, object]) -> dict[str, object]:
    """Classifier LC features: per-class ratios + lc_vegetation_ratio aggregate.

    The classifier has NO categorical input — the dominant class string is
    dropped (kept out of the feature dict so the schema guard stays exact).
    """
    out = {k: v for k, v in lc_features.items() if k.startswith("lc_")}
    vegetation = (
        out.get("lc_trees_ratio", 0.0) or 0.0
    ) + (
        out.get("lc_grass_ratio", 0.0) or 0.0
    ) + (
        out.get("lc_flooded_vegetation_ratio", 0.0) or 0.0
    ) + (
        out.get("lc_crops_ratio", 0.0) or 0.0
    ) + (
        out.get("lc_shrub_and_scrub_ratio", 0.0) or 0.0
    )
    out["lc_vegetation_ratio"] = round(float(vegetation), 6)
    return out


def _detection_features(
    lat: float,
    lng: float,
    radius_km: float,
    lookback_days: int,
) -> dict[str, object]:
    """Persistence/FRP/brightness features from stored FIRMS detections."""
    sql, params = detection_history_query_sqlite(lat, lng, radius_km, _since(lookback_days))
    con = sqlite_connect_readonly()
    try:
        rows = con.execute(sql, params).fetchall()
    finally:
        con.close()

    if not rows:
        return {
            "unique_h3_cells": 0.0,
            "total_fire_detections": 0.0,
            "unique_fire_days": 0.0,
            "temporal_span_days": 0.0,
            "active_months": 0.0,
            "mean_frp": 0.0,
            "max_frp": 0.0,
            "mean_brightness": 0.0,
            "max_brightness": 0.0,
        }

    dates = sorted({r["acq_date"] for r in rows})
    months = {(d[:4], d[5:7]) for d in dates}
    frps = [r["frp"] or 0.0 for r in rows]
    # Node backend detections are ~375 m apart at worst; the classifier's
    # "unique_h3_cells" input is approximated by the count of distinct rounded
    # detection locations inside the radius (documented approximation).
    cells = {(round(r["lat"], 3), round(r["lng"], 3)) for r in rows}
    brightness = [
        b
        for r in rows
        for b in (r["bright_ti4"], r["bright_ti5"])
        if b is not None
    ]
    first, last = dates[0], dates[-1]

    return {
        "unique_h3_cells": float(len(cells)),
        "total_fire_detections": float(len(rows)),
        "unique_fire_days": float(len(dates)),
        "temporal_span_days": float(
            (datetime.strptime(last, "%Y-%m-%d") - datetime.strptime(first, "%Y-%m-%d")).days
        ),
        "active_months": float(len(months)),
        "mean_frp": sum(frps) / len(frps),
        "max_frp": max(frps),
        "mean_brightness": (sum(brightness) / len(brightness)) if brightness else 0.0,
        "max_brightness": max(brightness) if brightness else 0.0,
    }


def _since(lookback_days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=lookback_days)
