"""Phase 2C pipeline unit tests — pure functions, no DB or models required.

Covers the two behaviours the plan calls load-bearing:
1. The weather forward-fill rule (≤7 days, forward only, never backward;
   still-missing → the cell-day is EXCLUDED, not guessed).
2. Window eligibility (exactly 30 consecutive days ending as_of; anything
   less is insufficient_history — never a fabricated sequence).
Plus DBSCAN clustering + the persistence rule (≥5 unique fire days).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import pytest

from app.pipeline.h3_aggregate import (
    WEATHER_FORWARD_FILL_MAX_DAYS,
    build_feature_vector,
)
from app.pipeline.hotspots_pipeline import (
    PERSISTENT_MIN_FIRE_DAYS,
    build_clusters,
    cluster_detections,
)
from app.pipeline.risk_batch import eligible_cells


# ── helpers ──────────────────────────────────────────────────────────────


def _wx_all(v: float) -> dict[str, float | None]:
    return {
        "temperature_2m_mean": v,
        "temperature_2m_max": v + 5,
        "temperature_2m_min": v - 5,
        "wind_speed_10m_max": v,
        "wind_speed_10m_mean": v / 2,
        "dew_point_2m_mean": v - 8,
        "relative_humidity_mean": 60.0,
        "relative_humidity_min": 30.0,
        "precipitation_sum": 2.4,
        "shortwave_radiation_sum": 86400.0,
    }


FIRE_ZERO = {
    "fire_count": 0.0,
    "mean_frp": 0.0,
    "max_frp": 0.0,
    "mean_brightness": 0.0,
    "max_brightness": 0.0,
}


# ── weather forward-fill rules ───────────────────────────────────────────


def test_build_vector_full_weather_no_fill():
    vec, fill = build_feature_vector(FIRE_ZERO, _wx_all(20.0), {}, date(2026, 9, 10))
    assert vec is not None
    assert fill == {}
    assert len(vec) == 17
    # ssrd derivation: 86400 J/m² / 86400 s = 1.0 W/m² at mean + max positions
    from app.feature_schema import RISK_FEATURES

    m = dict(zip(RISK_FEATURES, vec))
    assert m["mean_ssrd"] == pytest.approx(1.0)
    assert m["mean_precipitation"] == pytest.approx(0.1)


def test_build_vector_forward_fills_within_7_days():
    day = date(2026, 9, 10)
    today = _wx_all(20.0)
    today["relative_humidity_mean"] = None  # one gap today
    hist = {day - timedelta(days=3): _wx_all(18.0)}
    vec, fill = build_feature_vector(FIRE_ZERO, today, hist, day)
    assert vec is not None
    assert fill == {"mean_relative_humidity": "forward_fill_3d"}
    from app.feature_schema import RISK_FEATURES

    m = dict(zip(RISK_FEATURES, vec))
    assert m["mean_relative_humidity"] == 60.0  # from the 3-day-old row


def test_build_vector_excludes_when_gap_exceeds_7_days():
    day = date(2026, 9, 10)
    today = _wx_all(20.0)
    today["relative_humidity_mean"] = None
    hist = {day - timedelta(days=8): _wx_all(18.0)}  # 8 days back — beyond limit
    vec, fill = build_feature_vector(FIRE_ZERO, today, hist, day)
    assert vec is None  # excluded, never guessed


def test_build_vector_never_fills_backward():
    day = date(2026, 9, 10)
    today = _wx_all(20.0)
    today["relative_humidity_mean"] = None
    hist = {day + timedelta(days=1): _wx_all(18.0)}  # FUTURE day — must be ignored
    vec, fill = build_feature_vector(FIRE_ZERO, today, hist, day)
    assert vec is None


def test_fill_limit_is_seven_days_documented():
    assert WEATHER_FORWARD_FILL_MAX_DAYS == 7


def test_fire_features_are_never_filled_from_weather_history():
    day = date(2026, 9, 10)
    today = _wx_all(20.0)
    fire = {**FIRE_ZERO, "fire_count": 3.0, "mean_frp": 5.0}
    vec, _ = build_feature_vector(fire, today, {}, day)
    from app.feature_schema import RISK_FEATURES

    m = dict(zip(RISK_FEATURES, vec))
    assert m["fire_count"] == 3.0
    assert m["mean_frp"] == 5.0


# ── risk window eligibility ──────────────────────────────────────────────


def test_eligible_requires_exactly_30_consecutive_days():
    as_of = date(2026, 9, 19)
    full = [(f"cell-{i:03x}", as_of - timedelta(days=k)) for i in range(3) for k in range(30)]
    eligible, insufficient = eligible_cells(full, as_of)
    assert len(eligible) == 3
    assert insufficient == []
    # window ordered oldest-first
    days = eligible["cell-000"]
    assert days[0] == as_of - timedelta(days=29)
    assert days[-1] == as_of


def test_gap_makes_cell_insufficient():
    as_of = date(2026, 9, 19)
    rows = [("cellA", as_of - timedelta(days=k)) for k in range(30)]
    rows = [r for r in rows if r[1] != as_of - timedelta(days=15)]  # punch a hole
    eligible, insufficient = eligible_cells(rows, as_of)
    assert eligible == {}
    assert insufficient == ["cellA"]


def test_short_history_is_insufficient():
    as_of = date(2026, 9, 19)
    rows = [("cellA", as_of - timedelta(days=k)) for k in range(29)]
    eligible, insufficient = eligible_cells(rows, as_of)
    assert eligible == {}
    assert insufficient == ["cellA"]


def test_extra_older_days_do_not_qualify():
    as_of = date(2026, 9, 19)
    rows = [("cellA", as_of - timedelta(days=k)) for k in range(45)]
    eligible, insufficient = eligible_cells(rows, as_of)
    assert len(eligible) == 1  # window is exactly the last 30
    assert len(eligible["cellA"]) == 30


# ── DBSCAN clustering + persistence ──────────────────────────────────────


@dataclass
class FakeDet:
    latitude: float
    longitude: float
    acq_date: date
    frp: float = 0.0
    bright_ti4: float | None = None
    bright_ti5: float | None = None


def test_cluster_detections_two_spatial_groups():
    pts = np.array(
        [
            [20.0, 78.0],
            [20.01, 78.01],  # ~1.5 km apart → same cluster
            [22.0, 80.0],
            [22.01, 80.01],  # second cluster
            [25.0, 85.0],  # far away, single point → noise (min_samples=2)
        ]
    )
    labels = cluster_detections(pts)
    assert labels[0] == labels[1] != labels[2]
    assert labels[2] == labels[3]
    assert labels[4] == -1


def test_cluster_detections_empty_and_tiny():
    assert cluster_detections(np.zeros((0, 2))).size == 0
    labels = cluster_detections(np.array([[20.0, 78.0]]))
    assert list(labels) == [-1]  # below min_samples


def test_persistence_rule_five_fire_days():
    base = date(2026, 9, 1)
    dets = [
        FakeDet(20.0 + i * 0.001, 78.0, base + timedelta(days=i))
        for i in range(5)  # 5 unique days, tight cluster
    ]
    clusters = build_clusters(dets)
    assert len(clusters) == 1
    assert clusters[0].unique_fire_days == 5
    assert clusters[0].is_persistent is True


def test_four_days_is_not_persistent():
    base = date(2026, 9, 1)
    dets = [
        FakeDet(20.0 + i * 0.001, 78.0, base + timedelta(days=i))
        for i in range(4)
    ]
    clusters = build_clusters(dets)
    assert clusters[0].is_persistent is False


def test_persistent_threshold_constant():
    assert PERSISTENT_MIN_FIRE_DAYS == 5
