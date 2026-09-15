"""Initial PyroSense ML schema.

Revision ID: 0001
Revises:
Create Date: 2026-09-15

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    op.create_table(
        "hotspots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("hotspot_uid", sa.String(64), nullable=False, unique=True),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("geom", postgresql.JSONB(), nullable=True),  # geography set via SQL below
        sa.Column("region", sa.String(64), nullable=True),
        sa.Column("feature_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.execute(
        "ALTER TABLE hotspots ADD COLUMN IF NOT EXISTS geom geography(POINT, 4326);"
    )
    op.create_index("ix_hotspots_source", "hotspots", ["source"])
    op.create_index("ix_hotspots_latlng", "hotspots", ["latitude", "longitude"])

    op.create_table(
        "predictions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("hotspot_id", sa.Integer(), nullable=False, index=True),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("predicted_class", sa.String(64), nullable=False, index=True),
        sa.Column("probabilities", postgresql.JSONB(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("risk_score", sa.Float(), nullable=False, index=True),
        sa.Column("top_contributing_features", postgresql.JSONB(), nullable=False),
        sa.Column("model_version", sa.String(32), nullable=False),
        sa.Column("dataset_version", sa.String(32), nullable=False),
        sa.Column("feature_schema_version", sa.String(32), nullable=False),
        sa.Column("feature_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column(
            "prediction_timestamp", sa.DateTime(timezone=True), nullable=False
        ),
        sa.ForeignKeyConstraint(["hotspot_id"], ["hotspots.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_predictions_hotspot_time", "predictions", ["hotspot_id", "prediction_timestamp"])

    op.create_table(
        "timeline_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("hotspot_id", sa.Integer(), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("predicted_class", sa.String(64), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("risk_score", sa.Float(), nullable=False, index=True),
        sa.Column("key_drivers", postgresql.JSONB(), nullable=False),
        sa.ForeignKeyConstraint(["hotspot_id"], ["hotspots.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("hotspot_id", "snapshot_date", name="uq_timeline_hotspot_date"),
    )
    op.create_index("ix_timeline_hotspot_date", "timeline_snapshots", ["hotspot_id", "snapshot_date"])

    op.create_table(
        "genai_explanations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("prediction_id", sa.Integer(), nullable=True, index=True),
        sa.Column("features_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("model_name", sa.String(128), nullable=False),
        sa.Column("grounded", sa.Boolean(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["prediction_id"], ["predictions.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "live_detections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("hotspot_id", sa.Integer(), nullable=True, index=True),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("bright_ti4", sa.Float(), nullable=True),
        sa.Column("bright_ti5", sa.Float(), nullable=True),
        sa.Column("frp", sa.Float(), nullable=False),
        sa.Column("confidence", sa.String(16), nullable=True),
        sa.Column("daynight", sa.String(8), nullable=True),
        sa.Column("satellite", sa.String(32), nullable=True),
        sa.Column("instrument", sa.String(32), nullable=True),
        sa.Column("acq_date", sa.Date(), nullable=False),
        sa.Column("acq_time", sa.String(8), nullable=False),
        sa.Column("region", sa.String(64), nullable=True),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["hotspot_id"], ["hotspots.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "latitude", "longitude", "acq_date", "acq_time", "satellite",
            name="uq_live_detections_natural_key",
        ),
    )
    op.create_index("ix_live_detections_geo_date", "live_detections", ["latitude", "longitude", "acq_date"])


def downgrade() -> None:
    op.drop_table("live_detections")
    op.drop_table("genai_explanations")
    op.drop_table("timeline_snapshots")
    op.drop_table("predictions")
    op.drop_table("hotspots")
