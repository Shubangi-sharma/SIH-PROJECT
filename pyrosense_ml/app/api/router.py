"""API router aggregator."""

from __future__ import annotations

from fastapi import APIRouter

from app.api import health, hotspots, predict

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(hotspots.router)
api_router.include_router(predict.router)
