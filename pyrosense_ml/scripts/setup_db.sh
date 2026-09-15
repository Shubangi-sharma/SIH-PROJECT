#!/usr/bin/env bash
# Setup PostgreSQL database + PostGIS extension for PyroSense ML.
# Usage: ./setup_db.sh [DB_NAME] [DB_USER] [DB_PASSWORD]
set -euo pipefail

DB_NAME="${1:-pyrosense_ml}"
DB_USER="${2:-pyrosense}"
DB_PASSWORD="${3:-pyrosense}"

echo "==> Creating role ${DB_USER} (if missing)"
psql -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  psql -U postgres -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}' CREATEDB"

echo "==> Creating database ${DB_NAME} (if missing)"
if ! psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  psql -U postgres -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}"
fi

echo "==> Enabling PostGIS extension"
psql -U postgres -d "${DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS postgis"

echo "==> Granting privileges"
psql -U postgres -d "${DB_NAME}" -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER}"
psql -U postgres -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER}"

echo "==> Done. Set DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"
