"""Shared pytest fixtures."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.feature_schema import CATEGORICAL_FEATURES, FEATURE_NAMES  # noqa: E402


@pytest.fixture
def valid_features() -> dict:
    """A complete, valid 36-feature payload (industrial-ish profile)."""
    feats = {name: 0.0 for name in FEATURE_NAMES}
    feats.update(
        {
            "total_detections": 42.0,
            "unique_days": 22.0,
            "unique_months": 8.0,
            "mean_FRP": 6.5,
            "max_FRP": 18.2,
            "active_duration_days": 420.0,
            "distance_to_industrial_km": 0.8,
            "distance_to_power_km": 12.0,
            "distance_to_mining_km": 95.0,
            "distance_to_fuel_storage_km": 3.2,
            "distance_to_agriculture_km": 40.0,
            "distance_to_transport_km": 5.5,
            "dominant_land_cover": "built",
            "land_cover_observations": 24.0,
            "lc_built_ratio": 0.72,
            "lc_crops_ratio": 0.02,
            "lc_trees_ratio": 0.1,
            "mean_temperature": 28.4,
            "max_temperature": 34.1,
            "min_temperature": 22.9,
            "mean_wind_speed": 2.5,
            "max_wind_speed": 6.0,
            "mean_dewpoint": 18.0,
            "mean_precipitation": 0.4,
            "total_precipitation": 120.0,
            "mean_solar_radiation": 17_400_000.0,
            "weather_observations": 30.0,
            "first_detection_year": 2025.0,
            "first_detection_month": 3.0,
            "last_detection_year": 2026.0,
            "last_detection_month": 8.0,
        }
    )
    return feats


@pytest.fixture
def client(valid_features):
    """FastAPI TestClient with the real model; DB-dependent routes will
    fail without PostgreSQL, so tests that hit /predict or /hotspots should
    override get_db or mock — here we only mount the app for schema-level
    tests."""
    from fastapi.testclient import TestClient

    from app.main import create_app
    from app.ml.model_loader import load_model

    load_model()
    app = create_app()
    return TestClient(app)
