"""Per-cell daily weather fetch for the H3 feature store.

Fetches Open-Meteo ERA5 archive daily aggregates for one H3-r7 cell center
over the aggregation window and upserts raw values into `weather_daily`.
The forward-fill (<=7 days, the V3->V4 lesson from the handoff PDF) happens
at ROW-BUILD time in h3_aggregate.py — this module only fetches and stores
raw values, so fill policy can be re-derived without re-fetching.

Known source gaps (documented, matching feature_schema.py):
- relative_humidity_mean / relative_humidity_min: requested from Open-Meteo
  (available on the archive API) — NULL when the response lacks them.
- ssrd (solar radiation): the archive's `shortwave_radiation_sum` is a SUM
  (J/m²), not a mean irradiance (W/m²). It is stored as-is; the conversion
  (÷86400 → mean W/m² over the day) happens in h3_aggregate.py where the
  decision is visible and testable.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

import httpx
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import WeatherDaily

logger = logging.getLogger("pyrosense.ml.pipeline.weather")

_API_URL = "https://archive-api.open-meteo.com/v1/archive"

# Daily variables requested from Open-Meteo (archive API names).
# NOTE: relative_humidity_mean/min are NOT available as daily aggregates
# (the API 400s on them — verified 2026-09-19). They are derived from the
# HOURLY relative_humidity_2m series instead — see _fetch_hourly_rh.
_DAILY_VARS = [
    "temperature_2m_mean",
    "temperature_2m_max",
    "temperature_2m_min",
    "wind_speed_10m_max",
    "wind_speed_10m_mean",
    "dew_point_2m_mean",
    "precipitation_sum",
    "shortwave_radiation_sum",
]

_HOURLY_RH_VAR = "relative_humidity_2m"

_UPSERT_COLS = [
    "temperature_2m_mean",
    "temperature_2m_max",
    "temperature_2m_min",
    "wind_speed_10m_max",
    "wind_speed_10m_mean",
    "dew_point_2m_mean",
    "relative_humidity_mean",
    "relative_humidity_min",
    "precipitation_sum",
    "shortwave_radiation_sum",
    "observations",
]


# Open-Meteo archive end date: ERA5 lags ~5 days; never request today.
def archive_end_day(today: date | None = None) -> date:
    return (today or date.today()) - timedelta(days=6)


# ERA5's real availability tail (learned from the API's 400 error body when
# our `today-6d` assumption overshoots). Module-level memo so one discovery
# per process suffices; None until a 400 teaches us better.
_archive_tail: date | None = None


def _parse_tail_from_error(body: str) -> date | None:
    """Extract the max allowed date from an Open-Meteo 400 reason string.

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


async def _fetch_hourly_rh(
    client: "httpx.AsyncClient",
    *,
    lat: float,
    lng: float,
    start: date,
    end: date,
) -> dict[date, tuple[float | None, float | None]]:
    """Hourly relative_humidity_2m → per-day (mean, min).

    The archive API has no daily RH aggregate, but the GRU feature schema
    needs mean/min RH — derived here from the hourly series (same source,
    finer granularity; a real derivation, not a fill). {} on failure so the
    fill/exclusion contract downstream stays intact.
    """
    try:
        resp = await client.get(
            _API_URL,
            params={
                "latitude": round(lat, 4),
                "longitude": round(lng, 4),
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "hourly": _HOURLY_RH_VAR,
                "timezone": "UTC",
            },
        )
        resp.raise_for_status()
        hourly = resp.json().get("hourly", {})
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        logger.warning("hourly RH fetch failed (%.3f,%.3f): %s", lat, lng, exc)
        return {}

    times = hourly.get("time") or []
    values = hourly.get(_HOURLY_RH_VAR) or []
    by_day: dict[date, list[float]] = {}
    for ts, v in zip(times, values):
        if v is None:
            continue
        try:
            day = date.fromisoformat(str(ts)[:10])
            by_day.setdefault(day, []).append(float(v))
        except ValueError:
            continue
    return {
        day: (round(sum(vs) / len(vs), 6), round(min(vs), 6))
        for day, vs in by_day.items()
        if vs
    }


async def fetch_weather_rows(
    *,
    lat: float,
    lng: float,
    h3_cell: str,
    start: date,
    end: date,
) -> list[dict]:
    """Fetch raw daily weather rows for one cell (pure HTTP, no DB).

    On the archive's 400 (our end_date beyond the ERA5 tail), parse the
    allowed tail from the error body, memoize it, and retry ONCE clamped —
    so a single discovery request fixes every later cell in the run.
    Returns [] on any failure (gap handling is downstream's job).
    """
    global _archive_tail

    effective_end = min(end, _archive_tail) if _archive_tail else end
    if effective_end < start:
        return []
    params = {
        "latitude": round(lat, 4),
        "longitude": round(lng, 4),
        "start_date": start.isoformat(),
        "end_date": effective_end.isoformat(),
        "daily": ",".join(_DAILY_VARS),
        "timezone": "UTC",
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(_API_URL, params=params)
            if resp.status_code == 400 and _archive_tail is None:
                # Learn the tail once, then retry this request clamped.
                tail = _parse_tail_from_error(resp.text)
                if tail is not None and tail < effective_end:
                    _archive_tail = tail
                    logger.warning(
                        "open-meteo archive tail is %s — clamping all future fetches",
                        tail.isoformat(),
                    )
                    effective_end = min(end, tail)
                    if effective_end < start:
                        return []
                    params["end_date"] = effective_end.isoformat()
                    resp = await client.get(_API_URL, params=params)
            resp.raise_for_status()
            daily = resp.json().get("daily", {})
            # Daily aggregates lack RH — derive mean/min from the hourly series.
            rh_by_day = await _fetch_hourly_rh(
                client, lat=lat, lng=lng, start=start, end=effective_end
            )
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        logger.warning("weather fetch failed for %s (%.3f,%.3f): %s", h3_cell, lat, lng, exc)
        return []

    series = {k: daily.get(k) or [] for k in _DAILY_VARS}
    days = daily.get("time") or []
    if not days:
        return []

    rows: list[dict] = []
    for i, day_str in enumerate(days):
        try:
            day = date.fromisoformat(day_str)
        except ValueError:
            continue
        if day < start or day > effective_end:
            continue

        def _val(name: str, _i: int = i) -> float | None:
            vals = series.get(name) or []
            v = vals[_i] if _i < len(vals) else None
            if v is None:
                return None
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        obs = sum(
            1
            for name in ("temperature_2m_mean", "temperature_2m_max", "temperature_2m_min")
            if _val(name) is not None
        )
        rh_mean, rh_min = rh_by_day.get(day, (None, None))
        rows.append(
            {
                "h3_cell": h3_cell,
                "day": day,
                "temperature_2m_mean": _val("temperature_2m_mean"),
                "temperature_2m_max": _val("temperature_2m_max"),
                "temperature_2m_min": _val("temperature_2m_min"),
                "wind_speed_10m_max": _val("wind_speed_10m_max"),
                "wind_speed_10m_mean": _val("wind_speed_10m_mean"),
                "dew_point_2m_mean": _val("dew_point_2m_mean"),
                "relative_humidity_mean": rh_mean,
                "relative_humidity_min": rh_min,
                "precipitation_sum": _val("precipitation_sum"),
                "shortwave_radiation_sum": _val("shortwave_radiation_sum"),
                "observations": obs,
            }
        )
    return rows


def _upsert_statement(rows: list[dict]):
    """INSERT … ON CONFLICT DO UPDATE that only backfills NULLs."""
    stmt = pg_insert(WeatherDaily).values(rows)
    return stmt.on_conflict_do_update(
        constraint="uq_weather_daily_cell_day",
        set_={
            col: func.coalesce(getattr(WeatherDaily, col), getattr(stmt.excluded, col))
            for col in _UPSERT_COLS
        },
    )


async def store_weather_rows(session: AsyncSession, rows: list[dict]) -> int:
    """Upsert fetched rows into weather_daily (call from ONE task only —
    a single AsyncSession must never be used concurrently)."""
    if not rows:
        return 0
    await session.execute(_upsert_statement(rows))
    await session.flush()
    return len(rows)


async def fetch_and_store_weather(
    session: AsyncSession,
    *,
    lat: float,
    lng: float,
    h3_cell: str,
    start: date,
    end: date,
) -> int:
    """Sequential convenience wrapper: fetch one cell, then upsert it.

    The pipeline uses fetch_weather_rows + store_weather_rows (fetches fan
    out concurrently; the DB write stays on one session).
    """
    rows = await fetch_weather_rows(lat=lat, lng=lng, h3_cell=h3_cell, start=start, end=end)
    return await store_weather_rows(session, rows)


# Settings passthrough kept for testability.
WEATHER_LOOKBACK_DAYS = settings.WEATHER_LOOKBACK_DAYS
