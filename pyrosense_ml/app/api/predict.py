"""POST /predict — classify a new/live hotspot end-to-end.

Pipeline: schema guard → inference → risk score → key drivers → persistence
(hotspot + prediction + daily snapshot) → GenAI explanation → response.

Two modes:
- Full auto mode (default): only latitude/longitude required; the 36 features
  are engineered from SQLite detection history + OSM + land cover + weather,
  with median fallbacks.
- Expert mode: a full 36-feature payload bypasses engineering (still passes
  the schema guard).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.health import get_db
from app.data.live import (
    get_or_create_live_hotspot,
    record_timeline_snapshot,
    save_prediction,
)
from app.feature_schema import (
    DATASET_VERSION,
    FEATURE_NAMES,
    MODEL_VERSION,
    SCHEMA_VERSION,
    SchemaViolation,
)
from app.features.engineer import engineer_features
from app.ml.inference import predict as run_inference
from app.ml.risk_score import compute_risk_score, key_contributors
from app.genai.explanation_service import get_explanation

logger = logging.getLogger("pyrosense.api.predict")

router = APIRouter()


class PredictRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    region: str | None = None
    features: dict[str, float | str] | None = None

    @field_validator("features")
    @classmethod
    def _reject_leakage_early(cls, v: dict | None) -> dict | None:
        from app.feature_schema import LEAKAGE_COLUMNS

        if v is not None:
            leaky = LEAKAGE_COLUMNS.intersection(v)
            if leaky:
                raise ValueError(
                    f"leakage column(s) {sorted(leaky)} must never be provided as input"
                )
        return v


@router.post("/predict")
async def predict_endpoint(
    body: PredictRequest,
    session: AsyncSession = Depends(get_db),
):
    # ── 1. Features: engineer or accept expert payload ──────────────────────
    warnings: list[str] = []
    provenance: dict[str, str] = {}
    if body.features is None:
        engineered = await engineer_features(body.latitude, body.longitude)
        features = engineered.features
        warnings = engineered.warnings
        provenance = engineered.provenance
    else:
        features = dict(body.features)
        provenance = {"features": "client_provided"}

    # ── 2. Schema guard → inference → risk → drivers ────────────────────────
    try:
        result = run_inference(features)
        if body.features is not None and len(features) != len(FEATURE_NAMES):
            raise SchemaViolation(
                f"expert payload must contain all {len(FEATURE_NAMES)} features "
                f"(got {len(features)})"
            )
    except SchemaViolation as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    risk_score = compute_risk_score(result.probabilities)
    drivers = key_contributors(result.features, top_k=5)

    # ── 3. Persist hotspot + prediction + daily snapshot ────────────────────
    created = await get_or_create_live_hotspot(
        session, latitude=body.latitude, longitude=body.longitude, region=body.region
    )
    pred = await save_prediction(
        session,
        hotspot=created.hotspot,
        result=result,
        risk_score=risk_score,
        top_contributing_features=drivers,
        source="live",
    )
    await record_timeline_snapshot(session, hotspot=created.hotspot, prediction=pred)
    await session.commit()

    # ── 4. GenAI explanation (cached → LLM → template) ──────────────────────
    explanation, explanation_provenance = await get_explanation(
        session,
        features=result.features,
        risk_score=risk_score,
        predicted_class=result.predicted_class,
        probabilities=result.probabilities,
        confidence=result.confidence,
        top_features=drivers,
        source="live",
        prediction_id=pred.id,
    )
    await session.commit()

    return {
        "hotspot_id": created.hotspot.hotspot_uid,
        "class": result.predicted_class,
        "probabilities": result.probabilities,
        "risk_score": risk_score,
        "confidence": result.confidence,
        "top_contributing_features": drivers,
        "explanation": explanation,
        "explanation_provenance": explanation_provenance,
        "source": "live",
        "model_version": MODEL_VERSION,
        "dataset_version": DATASET_VERSION,
        "feature_schema_version": SCHEMA_VERSION,
        "prediction_timestamp": result.prediction_timestamp.isoformat(),
        "feature_provenance": provenance,
        "warnings": warnings,
    }
