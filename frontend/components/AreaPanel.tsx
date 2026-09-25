"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Factory, MapPin, X } from "lucide-react";
import {
  fetchCellDetailByPoint,
  HORIZON_LABELS,
  HOTSPOT_CLASS_LABELS,
  RISK_LEVEL_COLORS,
  type CellDetailResponse,
  type RiskHorizon,
} from "@/lib/riskApi";
import { FacilityAnalysis, STATUS_META, statusColorHex } from "@/lib/types";
import { haversineKm } from "@/lib/geo";

/**
 * AreaPanel — what a click on open map shows.
 *
 * Compact map popup (not a full-height side panel): leads with the monitored
 * facilities within a 50 km radius of the clicked point — each row zooms the
 * map to that facility and opens its analysis. Below that, the area's stored
 * risk signals and recorded fire clusters in condensed form.
 */

const NEARBY_RADIUS_KM = 50;
const MAX_FACILITY_ROWS = 5;
const MAX_CLUSTER_ROWS = 3;
const HORIZON_ORDER: RiskHorizon[] = ["1day", "3day", "7day"];

export default function AreaPanel({
  lat,
  lng,
  facilities = [],
  onSelectFacility,
  onClose,
}: {
  lat: number;
  lng: number;
  /** All known facility analyses — narrowed to the 50 km radius here. */
  facilities?: FacilityAnalysis[];
  /** Clicking a nearby facility row: zoom + open its analysis drawer. */
  onSelectFacility?: (id: string) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<CellDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(true);
    let cancelled = false;
    fetchCellDetailByPoint(lat, lng)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, refreshKey]);

  /** Facilities within 50 km, nearest first. */
  const nearby = useMemo(() => {
    return facilities
      .map((a) => ({
        analysis: a,
        distKm: haversineKm(lat, lng, a.facility.lat, a.facility.lng),
      }))
      .filter((x) => x.distKm <= NEARBY_RADIUS_KM)
      .sort((x, y) => x.distKm - y.distKm);
  }, [facilities, lat, lng]);

  const risk = data?.risk;
  const riskOk = risk && risk.status === "ok" ? risk : null;
  const insufficient = risk && risk.status === "insufficient_history";
  const clusters = data?.hotspots ?? [];
  const hasNearby = nearby.length > 0;

  return (
    <aside
      aria-label="Area detail"
      className="flex max-h-[min(72vh,560px)] w-full flex-col overflow-hidden"
    >
      {/* header */}
      <div className="flex items-start gap-2.5 border-b border-border-hairline px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-display text-[15px] font-semibold leading-snug text-text-primary">
            {hasNearby ? "Facilities within 50 km" : "No monitored facilities within 50 km"}
          </h2>
          <p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-text-tertiary">
            <MapPin size={9} aria-hidden />
            {lat.toFixed(3)}°, {lng.toFixed(3)}°
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close area detail"
          className="ml-auto flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors duration-150 hover:bg-bg-raised hover:text-text-primary"
        >
          <X size={14} />
        </button>
      </div>

      <div className="pyro-scroll min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-3.5">
        {/* nearby facilities — the primary action surface */}
        {loading ? (
          <p className="font-mono text-[11px] text-text-tertiary">Checking monitored facilities…</p>
        ) : hasNearby ? (
          <ul className="space-y-1.5">
            {nearby.slice(0, MAX_FACILITY_ROWS).map(({ analysis, distKm }) => {
              const hex = statusColorHex(analysis.status);
              return (
                <li key={analysis.facility.id}>
                  <button
                    type="button"
                    onClick={() => onSelectFacility?.(analysis.facility.id)}
                    className="group flex w-full items-center gap-2.5 rounded-lg border border-border-hairline bg-bg-inset px-2.5 py-2 text-left transition-colors duration-150 hover:border-accent-primary/40"
                  >
                    <span
                      aria-hidden
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: hex }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-text-primary group-hover:text-accent-primary">
                        {analysis.facility.name}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-text-tertiary">
                        {analysis.facility.type} · {STATUS_META[analysis.status].label}
                      </span>
                    </span>
                    <span className="flex-shrink-0 font-mono text-[10px] tabular-nums text-text-secondary">
                      {distKm.toFixed(1)} km
                    </span>
                  </button>
                </li>
              );
            })}
            {nearby.length > MAX_FACILITY_ROWS && (
              <li className="px-1 font-mono text-[10px] text-text-tertiary">
                +{nearby.length - MAX_FACILITY_ROWS} more within 50 km
              </li>
            )}
          </ul>
        ) : (
          <p className="text-[11.5px] leading-relaxed text-text-secondary">
            This point sits outside every facility&apos;s{" "}
            <span className="text-text-primary">5 km monitoring radius</span>. Most likely open
            terrain, or a source we don&apos;t track.
          </p>
        )}

        {/* risk outlook — condensed chips */}
        {riskOk && (
          <section>
            <h3 className="mb-1.5 font-body text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Fire-weather risk outlook
            </h3>
            <div className="grid grid-cols-3 gap-1.5">
              {HORIZON_ORDER.map((h) => {
                const entry = riskOk.horizons[h];
                const color = entry
                  ? entry.level === "HIGH"
                    ? RISK_LEVEL_COLORS.HIGH
                    : RISK_LEVEL_COLORS.LOW
                  : undefined;
                return (
                  <div
                    key={h}
                    className="rounded-lg border border-border-hairline bg-bg-inset px-2 py-1.5 text-center"
                  >
                    <div className="font-mono text-[9px] uppercase tracking-wider text-text-tertiary">
                      {HORIZON_LABELS[h].split(" ")[0]}
                    </div>
                    {entry ? (
                      <>
                        <div className="font-mono text-[13px] text-text-primary">
                          {entry.probability.toFixed(2)}
                        </div>
                        <div
                          className="font-mono text-[8.5px] font-semibold uppercase"
                          style={{ color }}
                        >
                          {entry.level}
                        </div>
                      </>
                    ) : (
                      <div className="mt-1 font-mono text-[10px] text-text-tertiary">n/a</div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5 text-[9.5px] leading-snug text-text-tertiary">
              Threshold signals, not probabilities.
            </p>
          </section>
        )}
        {insufficient && (
          <p className="rounded-lg border border-border-hairline bg-bg-raised px-2.5 py-2 text-[10.5px] leading-snug text-text-secondary">
            Not enough history for a risk outlook here yet (needs 30 days of data).
          </p>
        )}
        {risk && risk.status === "unavailable" && (
          <div className="rounded-lg border border-border-strong bg-bg-void/90 px-2.5 py-2 text-[10.5px] text-status-watch">
            Outlook unavailable — ML service unreachable.{" "}
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              className="underline underline-offset-2 hover:text-text-primary"
            >
              Retry
            </button>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-border-strong bg-bg-void/90 px-2.5 py-2 text-[10.5px] text-status-watch">
            Risk signals couldn&apos;t load.{" "}
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              className="underline underline-offset-2 hover:text-text-primary"
            >
              Retry
            </button>
          </div>
        )}

        {/* recorded fire clusters — condensed */}
        {clusters.length > 0 && (
          <section>
            <h3 className="mb-1.5 font-body text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Recorded activity
            </h3>
            <ul className="space-y-1">
              {clusters.slice(0, MAX_CLUSTER_ROWS).map((c) => (
                <li
                  key={c.cluster_id}
                  className="flex items-center gap-2 rounded-lg bg-bg-inset px-2.5 py-1.5 font-mono text-[10px] text-text-secondary"
                >
                  <span className="truncate text-text-primary">
                    {c.needs_review
                      ? "Needs Review"
                      : c.class
                        ? HOTSPOT_CLASS_LABELS[c.class] ?? c.class
                        : "Unclassified"}
                  </span>
                  <span className="ml-auto flex-shrink-0 tabular-nums">
                    {c.total_detections} det · {c.last_seen}
                  </span>
                </li>
              ))}
              {clusters.length > MAX_CLUSTER_ROWS && (
                <li className="px-1 font-mono text-[10px] text-text-tertiary">
                  +{clusters.length - MAX_CLUSTER_ROWS} more clusters
                </li>
              )}
            </ul>
          </section>
        )}

        {!hasNearby && clusters.length === 0 && !loading && (
          <div className="flex items-start gap-2 rounded-lg border border-border-hairline bg-bg-raised px-2.5 py-2">
            <Factory size={12} className="mt-0.5 flex-shrink-0 text-text-tertiary" />
            <p className="text-[10px] leading-snug text-text-tertiary">
              Facilities come from OpenStreetMap — add industrial sites there and they appear on
              the next ingest cycle.
            </p>
          </div>
        )}

        <p className="font-mono text-[9px] text-text-tertiary/70">Area ref {data?.h3_cell}</p>
      </div>
    </aside>
  );
}
