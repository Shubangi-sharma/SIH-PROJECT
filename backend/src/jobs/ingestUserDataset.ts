/**
 * ingestUserDataset — load the user-provided facility master list.
 *
 * Reads backend/data/user_facilities.csv (or .json), parses rows, and
 * upserts into the user_facilities table. Run manually:
 *
 *   npm run ingest:dataset
 *
 * PLACEHOLDER: the column mapping below matches the stub CSV. When the
 * real dataset arrives, update the column names in parseCsvRow() and
 * re-run this job.
 */

import fs from "node:fs";
import path from "node:path";
import { db, upsertUserFacility, setState, tx } from "../db/client.js";
import { ingestLog as log } from "../lib/logger.js";

function parseCsvRow(header: string[], cols: string[]): Parameters<typeof upsertUserFacility>[0] | null {
  const idx = (name: string) => header.indexOf(name);
  const val = (name: string): string => (cols[idx(name)] ?? "").trim();

  const lat = parseFloat(val("lat"));
  const lng = parseFloat(val("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const id = val("id");
  const name = val("name");
  if (!id || !name) return null;

  return {
    id,
    name,
    lat,
    lng,
    type: val("type") || "Industrial Site",
    boundary_geojson: val("boundary_geojson") || null,
    capacity: val("capacity") || null,
    operator: val("operator") || null,
    source: "user_dataset",
  };
}

function parseJsonRow(obj: Record<string, unknown>): Parameters<typeof upsertUserFacility>[0] | null {
  const lat = Number(obj.lat ?? obj.latitude);
  const lng = Number(obj.lng ?? obj.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const id = String(obj.id ?? "");
  const name = String(obj.name ?? "");
  if (!id || !name) return null;

  return {
    id,
    name,
    lat,
    lng,
    type: String(obj.type ?? "Industrial Site"),
    boundary_geojson: obj.boundary_geojson ? String(obj.boundary_geojson) : null,
    capacity: obj.capacity ? String(obj.capacity) : null,
    operator: obj.operator ? String(obj.operator) : null,
    source: "user_dataset",
  };
}

export async function ingestUserDataset(): Promise<void> {
  const dataDir = path.resolve(process.cwd(), "data");
  const csvPath = path.join(dataDir, "user_facilities.csv");
  const jsonPath = path.join(dataDir, "user_facilities.json");

  let rows: Parameters<typeof upsertUserFacility>[0][] = [];

  if (fs.existsSync(csvPath)) {
    log.info({ path: csvPath }, "loading user facilities from CSV");
    const text = fs.readFileSync(csvPath, "utf-8").trim();
    const lines = text.split("\n");
    if (lines.length < 2) {
      log.warn("CSV has no data rows");
      return;
    }
    const header = lines[0]!.split(",").map((h) => h.trim());
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i]!.split(",");
      const parsed = parseCsvRow(header, cols);
      if (parsed) rows.push(parsed);
    }
  } else if (fs.existsSync(jsonPath)) {
    log.info({ path: jsonPath }, "loading user facilities from JSON");
    const text = fs.readFileSync(jsonPath, "utf-8");
    const data = JSON.parse(text) as unknown;
    const arr = Array.isArray(data) ? data : (data as { facilities?: unknown[] }).facilities ?? [];
    for (const obj of arr) {
      const parsed = parseJsonRow(obj as Record<string, unknown>);
      if (parsed) rows.push(parsed);
    }
  } else {
    log.warn({ csvPath, jsonPath }, "no user_facilities file found — skipping");
    return;
  }

  if (rows.length === 0) {
    log.warn("no valid rows parsed from user dataset");
    return;
  }

  tx(() => {
    for (const row of rows) {
      upsertUserFacility(row);
    }
  });

  setState("dataset:lastCompletedAt", new Date().toISOString());
  setState("dataset:rowCount", String(rows.length));
  log.info({ rows: rows.length }, "user dataset ingestion finished");
}

// ── CLI entry ───────────────────────────────────────────────────────────
if (process.argv[1]?.includes("ingestUserDataset")) {
  ingestUserDataset()
    .then(() => {
      db.close();
      process.exit(0);
    })
    .catch((err) => {
      log.error({ err: String(err) }, "user dataset ingestion failed");
      db.close();
      process.exit(1);
    });
}
