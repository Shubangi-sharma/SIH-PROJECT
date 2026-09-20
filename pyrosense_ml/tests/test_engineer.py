"""Regression tests — engineer_features must emit the EXACT frozen 43-key vector.

The live /predict endpoint 500s whenever the engineered vector diverges from
CLASSIFIER_FEATURES (set-equality guard in inference.py). This bit for real:
the Overpass module produces the OLD GBM-era name `distance_to_fuel_storage_km`
(schema wants `distance_to_fuel_km`), the land-cover module has no
`lc_snow_and_ice_ratio`, and the weather module's `weather_observations` was
never renamed to `weather_observation_count` — so every successful fetch
paradoxically produced an incomplete vector while the median-fallback paths
mostly worked. These tests pin the contract on all three paths.
"""

from __future__ import annotations

import sqlite3

import pytest

from app.feature_schema import (
    CLASSIFIER_FEATURES,
    validate_classifier_features,
)
from app.features import engineer as eng
from app.features.land_cover import LandCover
from app.features.osm_distances import OsmDistances
from app.features.weather import WEATHER_FEATURES, Weather


def _detection_features_ok(*_a, **_kw) -> dict[str, float]:
    return {
        "unique_h3_cells": 3.0,
        "total_fire_detections": 27.0,
        "unique_fire_days": 9.0,
        "temporal_span_days": 21.0,
        "active_months": 1.0,
        "mean_frp": 8.1,
        "max_frp": 19.4,
        "mean_brightness": 322.5,
        "max_brightness": 341.0,
    }


def _osm_success() -> OsmDistances:
    """Module-shaped success payload — note the OLD fuel-storage name."""
    return OsmDistances(
        distances={
            "distance_to_industrial_km": 1.2,
            "distance_to_power_km": 14.0,
            "distance_to_mining_km": None,
            "distance_to_fuel_storage_km": 3.6,
            "distance_to_transport_km": 5.1,
            "distance_to_agriculture_km": 33.0,
        },
        cached=False,
    )


def _lc_success() -> LandCover:
    """Module-shaped success payload — no snow/ice key, extra counters present."""
    return LandCover(
        features={
            "dominant_land_cover": "built",
            "land_cover_observations": 42.0,
            "lc_water_ratio": 0.01,
            "lc_trees_ratio": 0.08,
            "lc_grass_ratio": 0.04,
            "lc_flooded_vegetation_ratio": 0.0,
            "lc_crops_ratio": 0.05,
            "lc_shrub_and_scrub_ratio": 0.02,
            "lc_built_ratio": 0.70,
            "lc_bare_ratio": 0.10,
        },
        provenance="osm_derived",
    )


def _weather_success() -> Weather:
    """Module-shaped success payload — OLD-era names incl. weather_observations."""
    return Weather(
        features={
            "mean_temperature": 28.4,
            "max_temperature": 34.1,
            "min_temperature": 22.0,
            "mean_wind_speed": 2.5,
            "max_wind_speed": 6.0,
            "mean_dewpoint": 18.0,
            "mean_precipitation": 4.2,
            "total_precipitation": 120.0,
            "mean_solar_radiation": 19.7,
            "weather_observations": 30.0,
        },
        provenance="open-meteo",
    )


def _patch_modules(monkeypatch, osm, lc, wx, det=_detection_features_ok):
    monkeypatch.setattr(eng, "_detection_features", det)
    monkeypatch.setattr(eng, "get_osm_distances", lambda lat, lng: _awaitable(osm))
    monkeypatch.setattr(eng, "get_land_cover", lambda lat, lng: _awaitable(lc))
    monkeypatch.setattr(eng, "get_weather", lambda lat, lng: _awaitable(wx))


def _awaitable(value):
    async def _inner():
        return value

    return _inner()


@pytest.mark.asyncio
async def test_success_path_produces_exact_frozen_schema(monkeypatch):
    _patch_modules(monkeypatch, _osm_success(), _lc_success(), _weather_success())
    out = await eng.engineer_features(28.6, 77.2)
    assert set(out.features) == set(CLASSIFIER_FEATURES)
    validate_classifier_features(out.features)  # must not raise


@pytest.mark.asyncio
async def test_success_path_renames_old_era_names(monkeypatch):
    _patch_modules(monkeypatch, _osm_success(), _lc_success(), _weather_success())
    out = await eng.engineer_features(28.6, 77.2)
    # OSM: fuel-storage → fuel, no old name leaks through.
    assert out.features["distance_to_fuel_km"] == 3.6
    assert "distance_to_fuel_storage_km" not in out.features
    # Weather: observation counter renamed, not dropped.
    assert out.features["weather_observation_count"] == 30.0
    assert "weather_observations" not in out.features
    # Land cover: snow/ice prior present, dominant-class string still dropped.
    assert out.features["lc_snow_and_ice_ratio"] == 0.0
    assert "dominant_land_cover" not in out.features
    assert "land_cover_observations" not in out.features


@pytest.mark.asyncio
async def test_unavailable_path_produces_exact_frozen_schema(monkeypatch):
    _patch_modules(
        monkeypatch,
        OsmDistances(
            distances={name: None for name in eng.OSM_FEATURES}, cached=False
        ),
        LandCover(features={}, provenance="osm_derived"),
        Weather(features={f: None for f in WEATHER_FEATURES}, provenance="unavailable"),
        det=_raise_sqlite,
    )
    out = await eng.engineer_features(28.6, 77.2)
    assert set(out.features) == set(CLASSIFIER_FEATURES)
    validate_classifier_features(out.features)  # must not raise
    assert out.provenance["osm"] == "median_fallback"
    assert out.provenance["land_cover"] == "median_fallback"
    assert out.provenance["weather"] == "median_fallback"
    assert out.provenance["detections"] == "median_fallback"


def _raise_sqlite(*_a, **_kw):
    raise sqlite3.OperationalError("no such table")


@pytest.mark.asyncio
async def test_partial_osm_success_backfills_missing_categories(monkeypatch):
    """OSM answers but skips a category entirely → median backfill, not 500."""
    osm = OsmDistances(
        distances={
            "distance_to_industrial_km": 2.0,
            "distance_to_power_km": 9.0,
        },
        cached=True,
    )
    _patch_modules(monkeypatch, osm, _lc_success(), _weather_success())
    out = await eng.engineer_features(28.6, 77.2)
    assert set(out.features) == set(CLASSIFIER_FEATURES)
    assert out.features["distance_to_mining_km"] == 0.0  # training median
    assert out.features["distance_to_fuel_km"] == 0.0  # renamed + backfilled
