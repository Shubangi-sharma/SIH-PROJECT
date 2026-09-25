"""GET /observations — live environmental observations for one point.

The facility detail page's Land cover / Surroundings / Weather groups (and
any other per-point consumer) read from here. It runs EXACTLY the same
feature modules as /predict's engineering step (land_cover, osm_distances,
weather — fetched concurrently) but:

- persists nothing (no hotspot, no prediction, no GenAI call);
- is display-shaped and display-honest: unknown values are ``null``, never
  the model's 0.0 training prior;
- carries per-block provenance so the UI can show where each number came
  from, and degrades each block independently (one dead source never 500s
  the whole response).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from app.config import settings
from app.features.engineer import PROXIMITY_RULES, _OSM_RENAME
from app.features.land_cover import get_land_cover
from app.features.osm_distances import get_osm_distances
from app.features.weather import get_weather

logger = logging.getLogger("pyrosense.api.observations")

router = APIRouter(prefix="/observations")

# osm_distances module keys → display keys (the fuel category keeps its
# module-era name; the model schema renames it to distance_to_fuel_km).
_DISPLAY_KEYS = {
    "industrial": "distance_to_industrial_km",
    "power": "distance_to_power_km",
    "mining": "distance_to_mining_km",
    "fuel": "distance_to_fuel_storage_km",
    "transport": "distance_to_transport_km",
    "agriculture": "distance_to_agriculture_km",
}

# Dynamic-Earth-style classes surfaced by the UI. snow_and_ice has no
# OSM-derived source — it is always the 0.0 prior (documented approximation).
_LC_CLASSES = [
    "water", "trees", "grass", "flooded_vegetation", "crops",
    "shrub_and_scrub", "built", "bare",
]
_VEG_CLASSES = {"trees", "grass", "flooded_vegetation", "crops", "shrub_and_scrub"}

_WEATHER_DISPLAY = [
    "mean_temperature_c", "max_temperature_c", "mean_dewpoint_c",
    "mean_relative_humidity", "min_relative_humidity",
    "mean_wind_speed_ms", "max_wind_speed_ms",
    "total_precipitation", "mean_precipitation",
    "mean_ssrd", "max_ssrd",
]

_WEATHER_MAPPING = {
    "mean_temperature_c": "mean_temperature",
    "max_temperature_c": "max_temperature",
    "mean_dewpoint_c": "mean_dewpoint",
    "mean_relative_humidity": "mean_relative_humidity",
    "min_relative_humidity": "min_relative_humidity",
    "mean_wind_speed_ms": "mean_wind_speed",
    "max_wind_speed_ms": "max_wind_speed",
    "total_precipitation": "total_precipitation",
    "mean_precipitation": "mean_precipitation",
    "mean_ssrd": "mean_ssrd",
    "max_ssrd": "max_ssrd",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _land_cover_block(lc) -> tuple[dict, list[str]]:
    warnings: list[str] = []
    ratios: dict[str, float | None] = {c: None for c in _LC_CLASSES}
    if lc is None or lc.features.get("lc_built_ratio") is None:
        warnings.append("land cover unavailable — no observations for this point")
        return {
            "ratios": ratios,
            "dominant": None,
            "observations": None,
            "vegetation_ratio": None,
            "provenance": "unavailable",
        }, warnings

    features = lc.features
    for cls in _LC_CLASSES:
        v = features.get(f"lc_{cls}_ratio")
        ratios[cls] = round(float(v), 6) if v is not None else None
    # No OSM-derived snow/ice class — always the 0.0 prior (documented).
    ratios["snow_and_ice"] = 0.0
    vegetation = sum(ratios[c] or 0.0 for c in _VEG_CLASSES)
    return {
        "ratios": ratios,
        "dominant": features.get("dominant_land_cover"),
        "observations": features.get("land_cover_observations"),
        "vegetation_ratio": round(vegetation, 6),
        "provenance": lc.provenance,
    }, warnings


def _surroundings_block(osm) -> tuple[dict, list[str]]:
    warnings: list[str] = []
    distances: dict[str, float | None] = {k: None for k in _DISPLAY_KEYS}
    flags: dict[str, bool | None] = {f.removeprefix("near_"): None for f in PROXIMITY_RULES}
    if osm is None:
        warnings.append("surroundings unavailable — Overpass unreachable")
        return {
            "distances_km": distances,
            "proximity_flags": flags,
            "provenance": "unavailable",
        }, warnings

    raw = osm.distances
    if all(v is None for v in raw.values()):
        warnings.append(
            "no OSM infrastructure data for this point (nothing within 50 km, or Overpass unreachable)"
        )
    # module key → display key (fuel keeps its module-era name here).
    module_to_display = {m: d for d, m in _DISPLAY_KEYS.items()}
    for display, module_key in _DISPLAY_KEYS.items():
        v = raw.get(module_key)
        distances[display] = round(float(v), 4) if v is not None else None

    for flag, (dist_key, threshold_m) in PROXIMITY_RULES.items():
        # PROXIMITY_RULES is keyed by schema names; the module may still use
        # the old-era name (fuel storage) — resolve through _OSM_RENAME.
        module_key = next(
            (m for m, renamed in _OSM_RENAME.items() if renamed == dist_key),
            dist_key,
        )
        v = raw.get(module_key)
        display_key = module_to_display.get(module_key, dist_key)
        flags[display_key] = (v * 1000.0 <= threshold_m) if v is not None else None

    provenance = (
        "unavailable"
        if all(v is None for v in raw.values())
        else ("cache" if osm.cached else "overpass")
    )
    return {"distances_km": distances, "proximity_flags": flags, "provenance": provenance}, warnings


def _weather_block(wx) -> tuple[dict, list[str]]:
    warnings: list[str] = []
    if wx is None or wx.provenance == "unavailable":
        warnings.append("weather unavailable — Open-Meteo unreachable")
        out: dict[str, object] = {k: None for k in _WEATHER_DISPLAY}
        out["observation_count"] = None
        out["lookback_days"] = settings.WEATHER_LOOKBACK_DAYS
        out["provenance"] = "unavailable"
        return out, warnings

    out = {display: wx.features.get(module) for display, module in _WEATHER_MAPPING.items()}
    out["observation_count"] = wx.features.get("weather_observations")
    out["lookback_days"] = settings.WEATHER_LOOKBACK_DAYS
    out["provenance"] = wx.provenance
    gaps = [d for d in _WEATHER_DISPLAY if out.get(d) is None]
    if gaps:
        warnings.append("weather gaps (null): " + ", ".join(gaps))
    return out, warnings


@router.get("")
async def observations(
    lat: float = Query(..., ge=-90, le=90, description="Point latitude"),
    lng: float = Query(..., ge=-180, le=180, description="Point longitude"),
):
    """Live land-cover / surroundings / weather observations for one point.

    Computed on demand by the same feature-engineering modules /predict uses
    (in parallel); nothing is persisted and no model inference runs here.
    """
    lc_res, osm_res, wx_res = await asyncio.gather(
        get_land_cover(lat, lng),
        get_osm_distances(lat, lng),
        get_weather(lat, lng),
        return_exceptions=True,
    )
    if isinstance(lc_res, BaseException):
        logger.warning("observations land cover failed: %s", lc_res)
    if isinstance(osm_res, BaseException):
        logger.warning("observations surroundings failed: %s", osm_res)
    if isinstance(wx_res, BaseException):
        logger.warning("observations weather failed: %s", wx_res)

    # Module failures degrade their own block to unavailable — one dead
    # source must never 500 the whole response.
    lc = None if isinstance(lc_res, BaseException) else lc_res
    osm = None if isinstance(osm_res, BaseException) else osm_res
    wx = None if isinstance(wx_res, BaseException) else wx_res

    land_cover, w1 = _land_cover_block(lc)
    surroundings, w2 = _surroundings_block(osm)
    weather, w3 = _weather_block(wx)

    return {
        "latitude": lat,
        "longitude": lng,
        "land_cover": land_cover,
        "surroundings": surroundings,
        "weather": weather,
        "warnings": [*w1, *w2, *w3],
        "note": (
            "Observations are computed on demand by the ML feature-engineering "
            "modules (the same sources /predict uses) — never stored per facility."
        ),
        "data_timestamp": _now_iso(),
    }
