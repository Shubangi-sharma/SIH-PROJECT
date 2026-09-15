"""Weather features — historical aggregates from the Open-Meteo ERA5 archive.

Fetches daily aggregates for a point over a lookback window and derives the
eight model weather features. Responses are cached in-process (TTL from
settings); failures return None-features so the engineer can apply median
fallback and flag provenance.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import date, timedelta

import httpx

from app.config import settings

logger = logging.getLogger("pyrosense.ml.features.weather")

WEATHER_FEATURES = [
    "mean_temperature",
    "max_temperature",
    "min_temperature",
    "mean_wind_speed",
    "max_wind_speed",
    "mean_dewpoint",
    "mean_precipitation",
    "total_precipitation",
    "mean_solar_radiation",
    "weather_observations",
]

_API_URL = "https://archive-api.open-meteo.com/v1/archive"
_CACHE_TTL = settings.WEATHER_CACHE_TTL
_cache: dict[str, tuple[float, dict | None]] = {}


@dataclass
class Weather:
    features: dict[str, float | None]
    provenance: str  # "open-meteo" | "cache" | "unavailable"


def _cache_key(lat: float, lng: float) -> str:
    return f"{round(lat, 2)}:{round(lng, 2)}"


async def get_weather(lat: float, lng: float) -> Weather:
    """Eight weather features for a point over the last lookback_days days."""
    key = _cache_key(lat, lng)
    hit = _cache.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < _CACHE_TTL:
        return Weather(features=dict(hit[1]), provenance="cache")

    end = date.today() - timedelta(days=1)  # ERA5 lags ~5 days; archive clips
    start = end - timedelta(days=settings.WEATHER_LOOKBACK_DAYS)

    params = {
        "latitude": lat,
        "longitude": lng,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "daily": ",".join(
            [
                "temperature_2m_mean",
                "temperature_2m_max",
                "temperature_2m_min",
                "wind_speed_10m_max",
                "dew_point_2m_mean",
                "precipitation_sum",
                "shortwave_radiation_sum",
            ]
        ),
        "timezone": "UTC",
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(_API_URL, params=params)
            resp.raise_for_status()
        daily = resp.json().get("daily", {})
        temps = daily.get("temperature_2m_mean") or []
        tmax = daily.get("temperature_2m_max") or []
        tmin = daily.get("temperature_2m_min") or []
        wmax = daily.get("wind_speed_10m_max") or []
        dew = daily.get("dew_point_2m_mean") or []
        precip = daily.get("precipitation_sum") or []
        rad = daily.get("shortwave_radiation_sum") or []
        obs = sum(1 for v in temps if v is not None)

        if obs == 0:
            raise ValueError("empty daily series")

        # Wind: archive provides daily max; mean wind speed is approximated by
        # averaging the daily maxima (documented approximation).
        features: dict[str, float | None] = {
            "mean_temperature": _mean(temps),
            "max_temperature": _mean(tmax),
            "min_temperature": _mean(tmin),
            "mean_wind_speed": _mean(wmax) if wmax else None,
            "max_wind_speed": max(v for v in wmax if v is not None) if wmax else None,
            "mean_dewpoint": _mean(dew),
            "mean_precipitation": _mean(precip),
            "total_precipitation": sum(v for v in precip if v is not None),
            "mean_solar_radiation": _mean(rad),
            "weather_observations": float(obs),
        }
        _cache[key] = (now, features)
        return Weather(features=features, provenance="open-meteo")
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        logger.warning("open-meteo failed for %s,%s: %s", lat, lng, exc)
        return Weather(features={f: None for f in WEATHER_FEATURES}, provenance="unavailable")


def _mean(xs: list) -> float | None:
    vals = [v for v in xs if v is not None]
    return round(sum(vals) / len(vals), 6) if vals else None
