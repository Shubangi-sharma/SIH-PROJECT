"""Seed historical hotspots into PostgreSQL.

Usage:
    uv run python scripts/seed_historical.py [--csv path/to/enriched.csv] [--force]

Without --csv, falls back to SQLite-derived hotspots (marked 0.0.0-sqlite-fallback).
With --force, re-seeds even when historical rows exist.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func, select  # noqa: E402

from app.config import settings  # noqa: E402
from app.db.engine import get_engine, get_session_factory  # noqa: E402
from app.db.models import Base, Hotspot  # noqa: E402
from app.db.seed import SQLITE_FALLBACK_VERSION, DATASET_VERSION  # noqa: E402
from app.db.seed import load_historical_csv, derive_from_sqlite, _seed_rows  # noqa: E402
from app.ml.model_loader import load_model  # noqa: E402


async def main() -> int:
    parser = argparse.ArgumentParser(description="Seed historical hotspots")
    parser.add_argument("--csv", type=Path, default=None)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    load_model()  # fail fast if the pickle is missing/invalid

    factory = get_session_factory()
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with factory() as session:

        existing = (
            await session.execute(
                select(func.count()).select_from(Hotspot).where(Hotspot.source == "historical")
            )
        ).scalar_one()

        if existing > 0 and not args.force:
            print(f"historical hotspots already seeded ({existing}) — use --force to re-seed")
            return 0

        if args.csv:
            rows = load_historical_csv(args.csv)
            dataset_version = DATASET_VERSION
        else:
            rows = derive_from_sqlite()
            dataset_version = SQLITE_FALLBACK_VERSION

        print(f"seeding {len(rows)} hotspots (dataset={dataset_version})...")
        seeded = await _seed_rows(session, rows, dataset_version)
        print(f"seeded {seeded} historical hotspots")
        return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
