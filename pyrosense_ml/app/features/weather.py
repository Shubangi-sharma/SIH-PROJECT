"""Weather features — historical aggregates from the Open-Meteo ERA5 archive.

Fetches daily aggregates plus the hourly RH / shortwave-radiation series for a
point over a lookback window and derives ALL classifier weather features,
including the two previously-documented gaps:
- mean/min relative humidity ← hourly ``relative_humidity_2m`` (the archive
  API has no daily RH aggregate — verified 2026-09-19; same approach as
  pipeline/weather_fetch.py);
- mean/max solar radiation (ssrd, W/m²) ← hourly ``shortwave_radiation``
  (true per-hour irradiance — stronger than the pipeline's daily-sum ÷ 86400
  proxy, which stays in place for the H3 feature store).

Daily and hourly requests run concurrently over one shared client. The ERA5
archive tail (≈5-day publication lag) is learned from the API's 400 error
body once per process and every later request is clamped to it (same approach
as pipeline/weather_fetch.py — the previous ``today-1`` end date 400'd on
every fresh point, silently degrading weather to median fallback).

Responses are cached in-process (TTL from settings); failures return
None-features so the engineer can apply fallback and flag provenance.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import date, timedelta

import httpx

from app.config import settings

logger = logging.getLogger("pyrosense.ml.features.weather")

# Daily variables requested from Open-Meteo (archive API names). Daily
# aggregates have no RH and no irradiance — both come from the hourly series.
_DAILY_VARS = [
    "temperature_2m_mean",
    "temperature_2m_max",
    "temperature_2m_min",
    "wind_speed_10m_max",
    "wind_speed_10m_mean",
    "dew_point_2m_mean",
    "precipitation_sum",
]

_HOURLY_VARS = ["relative_humidity_2m", "shortwave_radiation"]

WEATHER_FEATURES = [
    "mean_temperature",
    "max_temperature",
    "min_temperature",
    "mean_wind_speed",
    "max_wind_speed",
    "mean_dewpoint",
    "mean_precipitation",
    "total_precipitation",
    "mean_relative_humidity",
    "min_relative_humidity",
    "mean_ssrd",
    "max_ssrd",
    "weather_observations",
]

_API_URL = "https://archive-api.open-meteo.com/v1/archive"
_CACHE_TTL = settings.WEATHER_CACHE_TTL
_cache: dict[str, tuple[float, dict]] = {}

# ERA5's real availability tail — learned once from a 400 error body, then
# clamped into every later request (module-level memo; None until discovered).
_archive_tail: date | None = None


@dataclass
class Weather:
    features: dict[str, float | None]
    provenance: str  # "open-meteo" | "cache" | "unavailable"


def _cache_key(lat: float, lng: float) -> str:
    return f"{round(lat, 2)}:{round(lng, 2)}"


def _parse_tail_from_error(body: str) -> date | None:
    """Max allowed date from an Open-Meteo 400 reason string.

    Their error bodies embed the allowed range, e.g.
    `Parameter "end_date" is out of allowed range ... (2026-09-04)`. The
    LAST date-like token is the tail we clamp to.
    """
    import re

    for token in re.findall(r"(\d{4}-\d{2}-\d{2})", body or ""):
        try:
            return date.fromisoformat(token)
        except ValueError:
            continue
    return None


async def _get_with_tail_clamp(
    client: httpx.AsyncClient, params: dict[str, object]
) -> dict:
    """GET one archive series, learning + applying the ERA5 tail on a 400."""
    global _archive_tail

    start = date.fromisoformat(str(params["start_date"]))
    end = date.fromisoformat(str(params["end_date"]))
    effective_end = min(end, _archive_tail) if _archive_tail else end
    if effective_end < start:
        return {}
    request_params = {**params, "end_date": effective_end.isoformat()}
    resp = await client.get(_API_URL, params=request_params)
    if resp.status_code == 400 and _archive_tail is None:
        tail = _parse_tail_from_error(resp.text)
        if tail is not None and tail < effective_end:
            _archive_tail = tail
            logger.warning(
                "open-meteo archive tail is %s — clamping all future fetches",
                tail.isoformat(),
            )
            effective_end = min(end, tail)
            if effective_end < start:
                return {}
            request_params = {**params, "end_date": effective_end.isoformat()}
            resp = await client.get(_API_URL, params=request_params)
    resp.raise_for_status()
    payload = resp.json() or {}
    return payload if isinstance(payload, dict) else {}


async def get_weather(
    lat: float,
    lng: float,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> Weather:
    """Weather aggregates for a point over the last WEATHER_LOOKBACK_DAYS days.

    The daily and hourly series are fetched concurrently; either failing
    alone degrades only its own features (None) while a daily failure makes
    the whole block "unavailable".
    """
    key = _cache_key(lat, lng)
    hit = _cache.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < _CACHE_TTL:
        return Weather(features=dict(hit[1]), provenance="cache")

    # ERA5 lags ~5 days; start conservative (today-6) and clamp on 400.
    end = date.today() - timedelta(days=6)
    start = end - timedelta(days=settings.WEATHER_LOOKBACK_DAYS)
    common: dict[str, object] = {
        "latitude": lat,
        "longitude": lng,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "timezone": "UTC",
    }

    daily: dict = {}
    hourly: dict = {}
    try:
        async with httpx.AsyncClient(timeout=30, transport=transport) as client:
            daily_res, hourly_res = await asyncio.gather(
                _get_with_tail_clamp(
                    client, {**common, "daily": ",".join(_DAILY_VARS)}
                ),
                _get_with_tail_clamp(
                    client, {**common, "hourly": ",".join(_HOURLY_VARS)}
                ),
                return_exceptions=True,
            )
        if isinstance(daily_res, BaseException):
            raise ValueError(f"daily series failed: {daily_res}") from daily_res
        daily = daily_res.get("daily", {}) or {}
        if isinstance(hourly_res, BaseException):
            # Core daily features still work; RH/ssrd fall back per-feature.
            logger.warning(
                "hourly RH/irradiance fetch failed for %.3f,%.3f: %s",
                lat,
                lng,
                hourly_res,
            )
        else:
            hourly = hourly_res.get("hourly", {}) or {}
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        logger.warning("open-meteo failed for %s,%s: %s", lat, lng, exc)
        return Weather(features={f: None for f in WEATHER_FEATURES}, provenance="unavailable")

    features = _derive(daily, hourly)
    if features is None:
        return Weather(features={f: None for f in WEATHER_FEATURES}, provenance="unavailable")

    _cache[key] = (now, features)
    return Weather(features=features, provenance="open-meteo")


def _derive(daily: dict, hourly: dict) -> dict[str, float | None] | None:
    """Aggregate the raw series into the feature dict; None when no daily data."""
    temps = daily.get("temperature_2m_mean") or []
    obs = sum(1 for v in temps if v is not None)
    if obs == 0:
        return None

    # Hourly RH + irradiance → per-day aggregates (mean/min RH, mean/max W/m²).
    rh_daily_mean: list[float] = []
    rh_daily_min: list[float] = []
    ssrd_daily_mean: list[float] = []
    ssrd_daily_max: list[float] = []
    times = hourly.get("time") or []
    rh_series = hourly.get("relative_humidity_2m") or []
    sw_series = hourly.get("shortwave_radiation") or []
    by_day: dict[str, dict[str, list[float]]] = {}
    for ts, rh, sw in zip(times, rh_series, sw_series):
        bucket = by_day.setdefault(str(ts)[:10], {"rh": [], "sw": []})
        if rh is not None:
            bucket["rh"].append(float(rh))
        if sw is not None:
            bucket["sw"].append(float(sw))
    for bucket in by_day.values():
        if bucket["rh"]:
            rh_daily_mean.append(sum(bucket["rh"]) / len(bucket["rh"]))
            rh_daily_min.append(min(bucket["rh"]))
        if bucket["sw"]:
            ssrd_daily_mean.append(sum(bucket["sw"]) / len(bucket["sw"]))
            ssrd_daily_max.append(max(bucket["sw"]))

    tmax = daily.get("temperature_2m_max") or []
    tmin = daily.get("temperature_2m_min") or []
    wmax = daily.get("wind_speed_10m_max") or []
    wmean = daily.get("wind_speed_10m_mean") or []
    dew = daily.get("dew_point_2m_mean") or []
    precip = daily.get("precipitation_sum") or []

    mean_wind = _mean(wmean) if wmean else None
    return {
        "mean_temperature": _mean(temps),
        # Window extremes: max of daily maxima / min of daily minima (the old
        # code averaged the daily series — a mislabel, fixed for parity with
        # the training aggregation).
        "max_temperature": _max(tmax),
        "min_temperature": _min(tmin),
        # Archive daily mean wind when present; fall back to the mean of the
        # daily maxima (documented approximation) when it is not.
        "mean_wind_speed": mean_wind if mean_wind is not None else _mean(wmax),
        "max_wind_speed": _max(wmax),
        "mean_dewpoint": _mean(dew),
        "mean_precipitation": _mean(precip),
        "total_precipitation": _sum(precip),
        "mean_relative_humidity": _mean(rh_daily_mean),
        "min_relative_humidity": _min(rh_daily_min),
        "mean_ssrd": _mean(ssrd_daily_mean),
        "max_ssrd": _max(ssrd_daily_max),
        "weather_observations": float(obs),
    }


def _clean(xs: list) -> list[float]:
    return [float(v) for v in xs if v is not None]


def _mean(xs: list) -> float | None:
    vals = _clean(xs)
    return round(sum(vals) / len(vals), 6) if vals else None


def _max(xs: list) -> float | None:
    vals = _clean(xs)
    return round(max(vals), 6) if vals else None


def _min(xs: list) -> float | None:
    vals = _clean(xs)
    return round(min(vals), 6) if vals else None


def _sum(xs: list) -> float | None:
    vals = _clean(xs)
    return round(sum(vals), 6) if vals else None
