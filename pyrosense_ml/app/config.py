"""Application settings — typed environment configuration.

Every credential enters the process HERE and nowhere else: modules import
`settings`, never `os.environ`. Pydantic Settings validates on first import; a
missing required value crashes the process at startup with a clear, actionable
error — never a silent failure at request time (mirrors backend/src/config/env.ts).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── HTTP ────────────────────────────────────────────────────────────────
    HOST: str = "0.0.0.0"
    PORT: int = 5000

    # ── PostgreSQL (predictions, timelines, explanations — owned by us) ─────
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://pyrosense:pyrosense@localhost:5432/pyrosense_ml",
        description="SQLAlchemy async URL for the PostgreSQL ML store",
    )

    # ── Existing SQLite (read-only: hotspots, detections, facilities) ───────
    SQLITE_PATH: Path = Field(
        default=Path("../backend/data/terra-watch.db"),
        description="Path to the Node.js backend's SQLite DB (opened read-only)",
    )

    # ── Model ───────────────────────────────────────────────────────────────
    MODEL_PATH: Path = Field(
        default=Path("../FINAL_GRADIENT_BOOSTING_MODEL.pkl"),
        description="Path to the trained Gradient Boosting pipeline pickle",
    )

    # ── GenAI (OpenRouter, same provider/key as the Node.js backend) ────────
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_API_URL: str = "https://openrouter.ai/api/v1"
    OPENROUTER_MODEL: str = "nvidia/nemotron-3-super-120b-a12b:free"
    OPENROUTER_FALLBACK_MODELS: str = "nvidia/nemotron-3.5-lightning:free"
    GENAI_TIMEOUT_SECONDS: float = 30.0

    # ── FIRMS (only needed if this service ingests live data itself) ────────
    FIRMS_MAP_KEY: str = ""
    FIRMS_BASE_URL: str = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"

    # ── Feature engineering ─────────────────────────────────────────────────
    OVERPASS_API_URL: str = "https://overpass-api.de/api/interpreter"
    # Cache TTLs (seconds) for external feature sources
    OSM_FACILITIES_CACHE_TTL: int = 86400
    LAND_COVER_CACHE_TTL: int = 2592000  # 30 days — static raster
    WEATHER_CACHE_TTL: int = 86400
    # Historical window used to compute temporal/persistence features
    DETECTION_RADIUS_KM: float = 1.0
    # Open-Meteo archive lookback (days) for weather aggregates
    WEATHER_LOOKBACK_DAYS: int = 30

    # ── CORS (same policy as the Node.js backend) ───────────────────────────
    CORS_ORIGIN: str = (
        "http://localhost:*,http://127.0.0.1:*,http://192.168.*:*,http://10.*:*,http://172.16.*:*"
    )

    # ── Behaviour switches ──────────────────────────────────────────────────
    # Seed the 552 historical hotspots at startup when the table is empty.
    SEED_ON_STARTUP: bool = True
    # Optional FIRMS polling scheduler (Node.js cron is the primary ingest).
    ENABLE_LIVE_INGEST_SCHEDULER: bool = False
    LIVE_INGEST_INTERVAL_MINUTES: int = 15

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGIN.split(",") if o.strip()]

    @property
    def fallback_models(self) -> list[str]:
        return [m.strip() for m in self.OPENROUTER_FALLBACK_MODELS.split(",") if m.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
