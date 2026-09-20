"""Feature store: firms_daily_h3, weather_daily, risk_predictions, hotspot_clusters, pipeline_job_runs.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "firms_daily_h3",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("h3_cell", sa.String(32), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("feature_vector", postgresql.JSONB(), nullable=False),
        sa.Column("fire_count", sa.Integer(), nullable=False),
        sa.Column("contributing_detections", sa.Integer(), nullable=False),
        sa.Column("fill_applied", postgresql.JSONB(), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("h3_cell", "day", name="uq_firms_daily_h3_cell_day"),
    )
    op.create_index("ix_firms_daily_h3_cell_day", "firms_daily_h3", ["h3_cell", "day"])
    op.create_index("ix_firms_daily_h3_day", "firms_daily_h3", ["day"])

    op.create_table(
        "weather_daily",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("h3_cell", sa.String(32), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("temperature_2m_mean", sa.Float(), nullable=True),
        sa.Column("temperature_2m_max", sa.Float(), nullable=True),
        sa.Column("temperature_2m_min", sa.Float(), nullable=True),
        sa.Column("wind_speed_10m_max", sa.Float(), nullable=True),
        sa.Column("wind_speed_10m_mean", sa.Float(), nullable=True),
        sa.Column("dew_point_2m_mean", sa.Float(), nullable=True),
        sa.Column("relative_humidity_mean", sa.Float(), nullable=True),
        sa.Column("relative_humidity_min", sa.Float(), nullable=True),
        sa.Column("precipitation_sum", sa.Float(), nullable=True),
        sa.Column("shortwave_radiation_sum", sa.Float(), nullable=True),
        sa.Column("observations", sa.SmallInteger(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("h3_cell", "day", name="uq_weather_daily_cell_day"),
    )
    op.create_index("ix_weather_daily_cell_day", "weather_daily", ["h3_cell", "day"])

    op.create_table(
        "risk_predictions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("h3_cell", sa.String(32), nullable=False),
        sa.Column("horizon", sa.String(8), nullable=False),
        sa.Column("probability", sa.Float(), nullable=False),
        sa.Column("level", sa.String(8), nullable=False),
        sa.Column("overall", sa.String(8), nullable=False),
        sa.Column("model_version", sa.String(32), nullable=False),
        sa.Column("feature_schema_version", sa.String(32), nullable=False),
        sa.Column("data_timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("predicted_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("h3_cell", "horizon", name="uq_risk_predictions_cell_horizon"),
    )
    op.create_index("ix_risk_predictions_cell", "risk_predictions", ["h3_cell"])
    op.create_index("ix_risk_predictions_overall", "risk_predictions", ["overall"])

    op.create_table(
        "hotspot_clusters",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cluster_uid", sa.String(64), nullable=False, unique=True),
        sa.Column("h3_cell", sa.String(32), nullable=False),
        sa.Column("centroid_lat", sa.Float(), nullable=False),
        sa.Column("centroid_lng", sa.Float(), nullable=False),
        sa.Column("unique_fire_days", sa.Integer(), nullable=False),
        sa.Column("total_detections", sa.Integer(), nullable=False),
        sa.Column("first_seen", sa.Date(), nullable=False),
        sa.Column("last_seen", sa.Date(), nullable=False),
        sa.Column("is_persistent", sa.Boolean(), nullable=False),
        sa.Column("predicted_class", sa.String(64), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("probabilities", postgresql.JSONB(), nullable=True),
        sa.Column("needs_review", sa.Boolean(), nullable=False),
        sa.Column("feature_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("model_version", sa.String(32), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_hotspot_clusters_h3", "hotspot_clusters", ["h3_cell"])
    op.create_index("ix_hotspot_clusters_persistent", "hotspot_clusters", ["is_persistent"])
    op.create_index("ix_hotspot_clusters_latlng", "hotspot_clusters", ["centroid_lat", "centroid_lng"])

    op.create_table(
        "pipeline_job_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("job_name", sa.String(32), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rows_processed", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
    )
    op.create_index("ix_pipeline_job_runs_name_started", "pipeline_job_runs", ["job_name", "started_at"])


def downgrade() -> None:
    op.drop_table("pipeline_job_runs")
    op.drop_table("hotspot_clusters")
    op.drop_table("risk_predictions")
    op.drop_table("weather_daily")
    op.drop_table("firms_daily_h3")
