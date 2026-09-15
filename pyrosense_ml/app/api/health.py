"""GET /health — API status, model, PostgreSQL, versions."""

from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session_factory
from app.feature_schema import DATASET_VERSION, FEATURE_NAMES, MODEL_VERSION, SCHEMA_VERSION
from app.ml.model_loader import is_loaded

router = APIRouter()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    factory = get_session_factory()
    async with factory() as session:
        yield session


async def check_postgres(session: AsyncSession) -> bool:
    try:
        await session.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


@router.get("/health")
async def health(session: AsyncSession = Depends(get_db)):
    pg_ok = await check_postgres(session)
    return {
        "status": "ok" if (pg_ok and is_loaded()) else "degraded",
        "service": "pyrosense-ml",
        "model_loaded": is_loaded(),
        "postgres_connected": pg_ok,
        "model_version": MODEL_VERSION,
        "dataset_version": DATASET_VERSION,
        "feature_schema_version": SCHEMA_VERSION,
        "feature_count": len(FEATURE_NAMES),
    }
