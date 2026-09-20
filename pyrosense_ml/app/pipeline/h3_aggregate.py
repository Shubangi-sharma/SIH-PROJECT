"""Daily H3-7 aggregation — turns raw FIRMS detections + weather into the
GRU feature store (`firms_daily_h3`, 17 features in RISK_FEATURES order).

Contract (Phase 2C):
- One row per (H3-r7 cell, day). feature_vector is a JSONB list of 17 floats
  in EXACTLY app.feature_schema.RISK_FEATURES order — the risk pipeline
  scales and stacks these directly into (30, 17) windows.
- Weather forward-fill ONLY, max 7 days, never backward-fill (the V3→V4
  lesson from the handoff PDF). A cell-day whose weather is still missing
  after the allowed fill is EXCLUDED from the store (never guessed).
- The day's fire features describe THAT day only (fire_count, frp, brightness
  aggregates over detections whose acq_date == day, h3.latlng_to_cell of the
  detection coordinates).
- Weather features describe the same calendar day (UTC) from weather_daily.

The aggregation is idempotent: re-running a day recomputes and upserts.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, timedelta

import h3
import numpy as np
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import FirmsDailyH3, LiveDetection, WeatherDaily
from app.feature_schema import RISK_FEATURES

logger = logging.getLogger("pyrosense.ml.pipeline.aggregate")

# The one documented failure mode we must never regress on:
WEATHER_FORWARD_FILL_MAX_DAYS = 7

# Raw weather fields consumed from WeatherDaily rows.
_WX_FIELDS = [
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
]

# GRU feature name → raw weather source column.
_WX_SOURCE = {
    "mean_temperature_c": "temperature_2m_mean",
    "min_temperature_c": "temperature_2m_min",
    "max_temperature_c": "temperature_2m_max",
    "mean_dewpoint_c": "dew_point_2m_mean",
    "mean_wind_speed_ms": "wind_speed_10m_mean",
    "max_wind_speed_ms": "wind_speed_10m_max",
    "mean_relative_humidity": "relative_humidity_mean",
    "min_relative_humidity": "relative_humidity_min",
    "total_precipitation": "precipitation_sum",
    "mean_precipitation": "precipitation_sum",
    "mean_ssrd": "shortwave_radiation_sum",
    "max_ssrd": "shortwave_radiation_sum",
}


def cell_centroid(h3_cell: str) -> tuple[float, float]:
    """(lat, lng) of an H3 cell's centroid."""
    lat, lng = h3.cell_to_latlng(h3_cell)
    return float(lat), float(lng)


def _fire_aggregates(dets: list) -> dict[str, float]:
    """Per-day fire aggregates for one cell's detections (that day only)."""
    if not dets:
        return {
            "fire_count": 0.0,
            "mean_frp": 0.0,
            "max_frp": 0.0,
            "mean_brightness": 0.0,
            "max_brightness": 0.0,
        }
    frps = [float(d.frp or 0.0) for d in dets]
    brightness = [b for d in dets for b in (d.bright_ti4, d.bright_ti5) if b is not None]
    return {
        "fire_count": float(len(dets)),
        "mean_frp": round(float(np.mean(frps)), 6),
        "max_frp": round(float(np.max(frps)), 6),
        "mean_brightness": round(float(np.mean(brightness)), 6) if brightness else 0.0,
        "max_brightness": round(float(np.max(brightness)), 6) if brightness else 0.0,
    }


def build_feature_vector(
    fire: dict[str, float],
    wx_today: dict[str, float | None],
    wx_history: dict[date, dict[str, float | None]],
    day: date,
) -> tuple[list[float] | None, dict[str, str]]:
    """Assemble the 17-feature day vector in RISK_FEATURES order.

    Args:
        fire: per-day fire aggregates (see _fire_aggregates).
        wx_today: raw weather values for `day` itself (any may be None).
        wx_history: past days' raw weather for the same cell
            (day → {field: value}); used ONLY for the ≤7-day forward-fill.
        day: the day being built (bounds the fill's lookback).

    Returns:
        (vector, fill_applied). vector is None when a weather feature is
        still missing after the ≤7-day forward-fill — exclude the cell-day,
        never guess (backward-fill is not permitted by the contract).
    """
    fill_applied: dict[str, str] = {}
    vec_map: dict[str, float] = dict(fire)

    # Every weather-derived feature starts explicitly None so the fill pass
    # (and the exclusion check) sees them, even when today's row lacks them.
    for dst in _WX_SOURCE:
        vec_map[dst] = None

    wx_filled = {k: float(v) for k, v in wx_today.items() if v is not None}

    def take(dst: str, src: str) -> float | None:
        v = wx_filled.get(src)
        if v is None:
            return None
        vec_map[dst] = v
        return v

    take("mean_temperature_c", "temperature_2m_mean")
    take("min_temperature_c", "temperature_2m_min")
    take("max_temperature_c", "temperature_2m_max")
    take("mean_dewpoint_c", "dew_point_2m_mean")
    # Wind: prefer the archive's daily mean; documented max-as-mean fallback
    # (engineer.py makes the same approximation for the classifier).
    if take("mean_wind_speed_ms", "wind_speed_10m_mean") is None:
        take("mean_wind_speed_ms", "wind_speed_10m_max")
    take("max_wind_speed_ms", "wind_speed_10m_max")
    take("mean_relative_humidity", "relative_humidity_mean")
    take("min_relative_humidity", "relative_humidity_min")
    take("total_precipitation", "precipitation_sum")

    # Daily precipitation SUM → mean-per-hour as the "mean_precipitation"
    # derivation (documented; training used daily aggregates).
    precip = wx_filled.get("precipitation_sum")
    vec_map["mean_precipitation"] = round(precip / 24.0, 6) if precip is not None else None

    # Solar radiation: shortwave_radiation_sum (J/m²/day) → mean W/m².
    ssrd_sum = wx_filled.get("shortwave_radiation_sum")
    if ssrd_sum is not None:
        w_m2 = round(ssrd_sum / 86400.0, 6)
        vec_map["mean_ssrd"] = w_m2
        vec_map["max_ssrd"] = w_m2  # conservative: daily mean as max proxy (documented)
    else:
        vec_map["mean_ssrd"] = None
        vec_map["max_ssrd"] = None

    # Forward-fill pass: past days only, ≤ MAX days, per weather feature.
    for name in [k for k, v in vec_map.items() if v is None and k not in fire]:
        for age in range(1, WEATHER_FORWARD_FILL_MAX_DAYS + 1):
            hist = wx_history.get(date.fromordinal(day.toordinal() - age), {})
            v = hist.get(_WX_SOURCE[name])
            if v is not None:
                vec_map[name] = float(v)
                fill_applied[name] = f"forward_fill_{age}d"
                break

    if any(v is None for v in vec_map.values()):
        return None, fill_applied

    return [float(vec_map[name]) for name in RISK_FEATURES], fill_applied


async def aggregate_day(session: AsyncSession, day: date) -> dict:
    """Aggregate one calendar day for all cells with fire that day.

    Reads that day's detections + each cell's weather history (fill source),
    builds firms_daily_h3 rows, and upserts them. Idempotent.

    Returns {cells, rows_upserted, rows_excluded} counters.
    """
    cells = sorted(
        {
            h3.latlng_to_cell(float(r.latitude), float(r.longitude), 7)
            for r in (
                session.execute(
                    select(LiveDetection.latitude, LiveDetection.longitude).where(
                        LiveDetection.acq_date == day
                    )
                )
            ).all()
        }
    )
    counters = {"cells": len(cells), "rows_upserted": 0, "rows_excluded": 0}
    if not cells:
        return counters

    # Weather history per cell: day-7 .. day (fill needs up to 7 days back).
    hist_start = day - timedelta(days=WEATHER_FORWARD_FILL_MAX_DAYS)
    wx_rows = (
        (
            await session.execute(
                select(WeatherDaily).where(
                    WeatherDaily.h3_cell.in_(cells),
                    WeatherDaily.day >= hist_start,
                    WeatherDaily.day <= day,
                )
            )
        )
        .scalars()
        .all()
    )
    wx_by_cell: dict[str, dict[date, dict]] = defaultdict(dict)
    for w in wx_rows:
        wx_by_cell[w.h3_cell][w.day] = {f: getattr(w, f) for f in _WX_FIELDS}

    det_rows = (
        (await session.execute(select(LiveDetection).where(LiveDetection.acq_date == day)))
        .scalars()
        .all()
    )
    dets_by_cell: dict[str, list] = defaultdict(list)
    for d in det_rows:
        dets_by_cell[h3.latlng_to_cell(float(d.latitude), float(d.longitude), 7)].append(d)

    rows_to_upsert: list[dict] = []
    for cell in cells:
        fire = _fire_aggregates(dets_by_cell.get(cell, []))
        history = wx_by_cell.get(cell, {})
        vec, fill_applied = build_feature_vector(
            fire, history.get(day, {}), history, day
        )
        if vec is None:
            counters["rows_excluded"] += 1
            continue
        rows_to_upsert.append(
            {
                "h3_cell": cell,
                "day": day,
                "feature_vector": vec,
                "fire_count": int(fire["fire_count"]),
                "contributing_detections": int(fire["fire_count"]),
                "fill_applied": fill_applied,
            }
        )

    if rows_to_upsert:
        stmt = pg_insert(FirmsDailyH3).values(rows_to_upsert)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_firms_daily_h3_cell_day",
            set_={
                "feature_vector": stmt.excluded.feature_vector,
                "fire_count": stmt.excluded.fire_count,
                "contributing_detections": stmt.excluded.contributing_detections,
                "fill_applied": stmt.excluded.fill_applied,
            },
        )
        await session.execute(stmt)
        await session.flush()
        counters["rows_upserted"] = len(rows_to_upsert)

    return counters
