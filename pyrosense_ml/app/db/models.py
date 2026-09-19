"""SQLAlchemy ORM models for the PyroSense ML store (PostgreSQL/PostGIS).

Table roles
-----------
hotspots             552 historical persistent hotspots (immutable seed) and
                     any live hotspots created via /predict.
predictions          Every inference result, with the full feature snapshot.
timeline_snapshots   Daily aggregated per-hotspot snapshots (slider support).
genai_explanations   Cached LLM explanations keyed by prediction + input hash.
live_detections      Live FIRMS detections ingested by THIS service (only used
                     when ENABLE_LIVE_INGEST_SCHEDULER is on).
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from geoalchemy2 import Geography
from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.feature_schema import (
    CLASSIFIER_FEATURES,
    CLASSIFIER_MODEL_VERSION,
    DATASET_VERSION,
    SCHEMA_VERSION,
)


class Base(DeclarativeBase):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# JSONB on PostgreSQL, plain JSON elsewhere (tests may run on SQLite? — no:
# tests use PostgreSQL via DATABASE_URL override; JSONB is fine).
JSONVariant = JSONB().with_variant(JSON(), "sqlite")


class Hotspot(Base):
    __tablename__ = "hotspots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hotspot_uid: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="historical")
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    geom = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=True)
    region: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Frozen feature values for historical rows (source of truth for seeding)
    feature_snapshot: Mapped[dict] = mapped_column(JSONVariant, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    predictions: Mapped[list["Prediction"]] = relationship(
        back_populates="hotspot", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("hotspot_uid", name="uq_hotspots_uid"),
        Index("ix_hotspots_source", "source"),
        Index("ix_hotspots_latlng", "latitude", "longitude"),
    )


class Prediction(Base):
    __tablename__ = "predictions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hotspot_id: Mapped[int] = mapped_column(
        ForeignKey("hotspots.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="live")

    predicted_class: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    probabilities: Mapped[dict] = mapped_column(JSONVariant, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    risk_score: Mapped[float] = mapped_column(Float, nullable=False, index=True)

    top_contributing_features: Mapped[list] = mapped_column(JSONVariant, nullable=False, default=list)

    model_version: Mapped[str] = mapped_column(String(32), nullable=False, default=CLASSIFIER_MODEL_VERSION)
    dataset_version: Mapped[str] = mapped_column(String(32), nullable=False, default=DATASET_VERSION)
    feature_schema_version: Mapped[str] = mapped_column(String(32), nullable=False, default=SCHEMA_VERSION)

    feature_snapshot: Mapped[dict] = mapped_column(JSONVariant, nullable=False)

    prediction_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    hotspot: Mapped["Hotspot"] = relationship(back_populates="predictions")
    explanations: Mapped[list["GenAIExplanation"]] = relationship(
        back_populates="prediction", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_predictions_hotspot_time", "hotspot_id", "prediction_timestamp"),
    )


class TimelineSnapshot(Base):
    __tablename__ = "timeline_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hotspot_id: Mapped[int] = mapped_column(
        ForeignKey("hotspots.id", ondelete="CASCADE"), nullable=False
    )
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False)

    predicted_class: Mapped[str] = mapped_column(String(64), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    risk_score: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    key_drivers: Mapped[list] = mapped_column(JSONVariant, nullable=False, default=list)

    __table_args__ = (
        UniqueConstraint("hotspot_id", "snapshot_date", name="uq_timeline_hotspot_date"),
        Index("ix_timeline_hotspot_date", "hotspot_id", "snapshot_date"),
    )


class GenAIExplanation(Base):
    __tablename__ = "genai_explanations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    prediction_id: Mapped[int | None] = mapped_column(
        ForeignKey("predictions.id", ondelete="CASCADE"), nullable=True, index=True
    )
    features_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="openrouter")
    model_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    grounded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    explanation: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    prediction: Mapped["Prediction | None"] = relationship(back_populates="explanations")

    __table_args__ = (
        UniqueConstraint("features_hash", name="uq_genai_features_hash"),
    )


class LiveDetection(Base):
    """FIRMS detection ingested by THIS service (scheduler mode only)."""

    __tablename__ = "live_detections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hotspot_id: Mapped[int | None] = mapped_column(
        ForeignKey("hotspots.id", ondelete="SET NULL"), nullable=True, index=True
    )

    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    bright_ti4: Mapped[float | None] = mapped_column(Float, nullable=True)
    bright_ti5: Mapped[float | None] = mapped_column(Float, nullable=True)
    frp: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    confidence: Mapped[str | None] = mapped_column(String(16), nullable=True)
    daynight: Mapped[str | None] = mapped_column(String(8), nullable=True)
    satellite: Mapped[str | None] = mapped_column(String(32), nullable=True)
    instrument: Mapped[str | None] = mapped_column(String(32), nullable=True)
    acq_date: Mapped[date] = mapped_column(Date, nullable=False)
    acq_time: Mapped[str] = mapped_column(String(8), nullable=False, default="0000")
    region: Mapped[str | None] = mapped_column(String(64), nullable=True)

    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "latitude",
            "longitude",
            "acq_date",
            "acq_time",
            "satellite",
            name="uq_live_detections_natural_key",
        ),
        Index("ix_live_detections_geo_date", "latitude", "longitude", "acq_date"),
    )


# Reference: the 43 frozen classifier features this store's snapshots carry.
# (Phase 2A: the old 36-feature GBM schema was replaced by the 43-feature
# classifier; risk-model sequences are a separate schema — see feature_schema.)
FEATURE_NAMES_REF = list(CLASSIFIER_FEATURES)
