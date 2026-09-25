"""GET /observations contract tests — display-shaped blocks, per-block provenance.

The endpoint must degrade each block independently (no 500s from one dead
source), keep unknowns as null (never the model's 0.0 priors), and surface
proximity flags derived from real distances.
"""

from __future__ import annotations

import pytest

from app.api.observations import (
    _land_cover_block,
    _surroundings_block,
    _weather_block,
    observations as observations_endpoint,
)
from app.features.land_cover import LandCover
from app.features.osm_distances import OsmDistances
from app.features.weather import Weather


def _lc_ok() -> LandCover:
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


def _osm_ok() -> OsmDistances:
    return OsmDistances(
        distances={
            "distance_to_industrial_km": 0.3,
            "distance_to_power_km": 14.0,
            "distance_to_mining_km": None,
            "distance_to_fuel_storage_km": 1.5,
            "distance_to_transport_km": 5.1,
            "distance_to_agriculture_km": 33.0,
        },
        cached=False,
    )


def _wx_ok() -> Weather:
    return Weather(
        features={
            "mean_temperature": 28.4,
            "max_temperature": 36.1,
            "min_temperature": 22.0,
            "mean_wind_speed": 2.5,
            "max_wind_speed": 6.0,
            "mean_dewpoint": 18.0,
            "mean_precipitation": 4.0,
            "total_precipitation": 120.0,
            "mean_relative_humidity": 62.5,
            "min_relative_humidity": 31.0,
            "mean_ssrd": 190.5,
            "max_ssrd": 880.0,
            "weather_observations": 30.0,
        },
        provenance="open-meteo",
    )


def test_land_cover_block_display_shape():
    block, warnings = _land_cover_block(_lc_ok())
    assert warnings == []
    assert block["dominant"] == "built"
    assert block["observations"] == 42.0
    assert block["provenance"] == "osm_derived"
    # every display class present, snow/ice pinned to the documented 0.0 prior
    assert set(block["ratios"]) == {
        "water", "trees", "grass", "flooded_vegetation", "crops",
        "shrub_and_scrub", "built", "bare", "snow_and_ice",
    }
    assert block["ratios"]["built"] == 0.70
    assert block["ratios"]["snow_and_ice"] == 0.0
    # vegetation aggregate = trees+grass+flooded+crops+shrub
    assert block["vegetation_ratio"] == pytest.approx(0.08 + 0.04 + 0.0 + 0.05 + 0.02)


def test_land_cover_block_unavailable_is_null_not_zero():
    block, warnings = _land_cover_block(
        LandCover(features={}, provenance="osm_derived")
    )
    assert block["provenance"] == "unavailable"
    assert all(v is None for v in block["ratios"].values())
    assert block["dominant"] is None
    assert warnings


def test_surroundings_block_distances_and_flags():
    block, warnings = _surroundings_block(_osm_ok())
    assert warnings == []
    d = block["distances_km"]
    assert d["industrial"] == 0.3
    assert d["fuel"] == 1.5  # display key keeps the module-era name
    assert d["mining"] is None  # unknown stays null — never 0
    flags = block["proximity_flags"]
    # thresholds: industrial 500 m → 0.3 km inside; fuel 2 km → 1.5 km inside;
    # power 1 km → 14 km clear; mining unknown → None
    assert flags["industrial"] is True
    assert flags["fuel"] is True
    assert flags["power"] is False
    assert flags["mining"] is None
    assert block["provenance"] == "overpass"


def test_surroundings_block_all_none_is_unavailable():
    block, _ = _surroundings_block(
        OsmDistances(
            distances={
                "distance_to_industrial_km": None,
                "distance_to_power_km": None,
                "distance_to_mining_km": None,
                "distance_to_fuel_storage_km": None,
                "distance_to_transport_km": None,
                "distance_to_agriculture_km": None,
            },
            cached=False,
        )
    )
    assert block["provenance"] == "unavailable"
    assert all(v is None for v in block["distances_km"].values())


def test_weather_block_maps_units_names():
    block, warnings = _weather_block(_wx_ok())
    assert warnings == []
    assert block["mean_temperature_c"] == 28.4
    assert block["mean_relative_humidity"] == 62.5
    assert block["max_ssrd"] == 880.0
    assert block["observation_count"] == 30.0
    assert block["lookback_days"] > 0
    assert block["provenance"] == "open-meteo"


def test_weather_block_unavailable():
    block, warnings = _weather_block(
        Weather(features={k: None for k in [
            "mean_temperature", "max_temperature", "min_temperature",
            "mean_wind_speed", "max_wind_speed", "mean_dewpoint",
            "mean_precipitation", "total_precipitation",
            "mean_relative_humidity", "min_relative_humidity",
            "mean_ssrd", "max_ssrd", "weather_observations",
        ]}, provenance="unavailable")
    )
    assert block["provenance"] == "unavailable"
    assert block["mean_temperature_c"] is None
    assert warnings


@pytest.mark.asyncio
async def test_endpoint_degrades_each_block_independently(monkeypatch):
    """One dead source must never 500 — its block degrades to unavailable."""

    async def _lc_fail(lat, lng):
        raise RuntimeError("boom")

    async def _osm_ok_async(lat, lng):
        return _osm_ok()

    async def _wx_fail(lat, lng):
        raise RuntimeError("boom")

    monkeypatch.setattr("app.api.observations.get_land_cover", _lc_fail)
    monkeypatch.setattr("app.api.observations.get_osm_distances", _osm_ok_async)
    monkeypatch.setattr("app.api.observations.get_weather", _wx_fail)

    out = await observations_endpoint(lat=28.6, lng=77.2)
    assert out["land_cover"]["provenance"] == "unavailable"
    assert out["surroundings"]["provenance"] == "overpass"
    assert out["surroundings"]["distances_km"]["industrial"] == 0.3
    assert out["weather"]["provenance"] == "unavailable"
    assert len(out["warnings"]) >= 2
    assert out["latitude"] == 28.6 and out["longitude"] == 77.2
    assert out["data_timestamp"]
