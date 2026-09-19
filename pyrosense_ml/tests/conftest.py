"""Shared pytest fixtures."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.feature_schema import CLASSIFIER_FEATURES  # noqa: E402


@pytest.fixture
def valid_features() -> dict:
    """A complete, valid 43-feature classifier payload (industrial-ish profile)."""
    feats = {name: 0.0 for name in CLASSIFIER_FEATURES}
    feats.update(
        {
            "unique_h3_cells": 12.0,
            "total_fire_detections": 84.0,
            "unique_fire_days": 31.0,
            "mean_frp": 6.5,
            "max_frp": 18.2,
            "mean_brightness": 320.0,
            "max_brightness": 360.0,
            "temporal_span_days": 120.0,
            "active_months": 4.0,
            "distance_to_industrial_km": 0.8,
            "distance_to_power_km": 12.0,
            "distance_to_mining_km": 95.0,
            "distance_to_fuel_km": 3.2,
            "distance_to_transport_km": 5.5,
            "distance_to_agriculture_km": 40.0,
            "near_industrial_500m": 1.0,
            "near_power_1km": 1.0,
            "near_mining_5km": 0.0,
            "near_fuel_2km": 0.0,
            "near_transport_1km": 1.0,
            "near_agriculture_1km": 0.0,
            "lc_built_ratio": 0.62,
            "lc_crops_ratio": 0.02,
            "lc_trees_ratio": 0.10,
            "lc_vegetation_ratio": 0.15,
            "mean_temperature_c": 28.4,
            "max_temperature_c": 34.1,
            "mean_dewpoint_c": 18.0,
            "mean_wind_speed_ms": 2.5,
            "max_wind_speed_ms": 6.0,
            "total_precipitation": 120.0,
        }
    )
    return feats


@pytest.fixture
def client(valid_features):
    """FastAPI TestClient with the real models; DB-dependent routes will
    fail without PostgreSQL, so tests that hit /predict or /hotspots should
    override get_db or mock — here we only mount the app for schema-level
    tests."""
    from fastapi.testclient import TestClient

    from app.main import create_app
    from app.ml.model_loader import load_model

    load_model()
    app = create_app()
    return TestClient(app)
