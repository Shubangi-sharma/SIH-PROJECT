"""Database engine factory.

Two stores, two very different roles:

- PostgreSQL (async SQLAlchemy + asyncpg) — owns everything this service
  produces: hotspots, predictions, timeline snapshots, GenAI explanations.
- SQLite (read-only, file path from settings) — the Node.js backend's
  terra-watch.db; we consume detections/facilities for feature engineering
  and never write to it.

SQLAlchemy URL notes:
- `postgresql+asyncpg://` → async engine (requests path).
- `postgresql+psycopg://` → psycopg3; supports both sync and async. Alembic
  (sync) uses this URL (see app/db/alembic_helpers.py).
"""

from __future__ import annotations

import sqlite3
from functools import lru_cache
from pathlib import Path

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def _to_psycopg_url(url: str) -> str:
    """Alembic runs sync — translate the async URL to a psycopg3 one."""
    if url.startswith("postgresql+asyncpg://"):
        return url.replace("postgresql+asyncpg://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


@lru_cache
def get_engine() -> AsyncEngine:
    from app.config import settings

    return create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )


@lru_cache
def get_session_factory() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(bind=get_engine(), expire_on_commit=False)


def sqlite_connect_readonly() -> sqlite3.Connection:
    """Open the existing SQLite DB strictly read-only via URI mode.

    URI `mode=ro` guarantees no write can ever originate from this service,
    even accidentally. WAL files are read through the normal shared cache.
    """
    from app.config import settings

    path = Path(settings.SQLITE_PATH).resolve()
    if not path.exists():
        raise FileNotFoundError(f"SQLite DB not found at {path}")
    uri = f"file:{path}?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def alembic_sync_url() -> str:
    from app.config import settings

    return _to_psycopg_url(settings.DATABASE_URL)
