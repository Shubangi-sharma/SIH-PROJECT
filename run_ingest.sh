#!/bin/bash
# Reordered ingestion: the FIRMS archive backfill gates everything downstream
# (scoring, summaries), so it runs first; the remaining Overpass facility
# regions follow. Both are idempotent.
cd /home/svmbhardwaj/SIH/backend || exit 1
echo "=== firms archive backfill starting $(date -Iseconds) ==="
npm run ingest:firms
echo "=== remaining facilities ingestion starting $(date -Iseconds) ==="
npm run ingest:facilities
echo "=== all ingestion done $(date -Iseconds) ==="
