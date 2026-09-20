"use client";

import React from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Satellite,
  X,
} from "lucide-react";
import FacilityDetailPanel from "./FacilityDetailPanel";
import CellPanel from "./CellPanel";
import { FirmsHotspotDetail } from "./MapMarkerTooltips";
import FreshnessBadge from "./FreshnessBadge";
import { frpBandIndex } from "./MapCanvas";
import { FRP_BANDS, type FirmsHotspot } from "@/lib/firms";
import type { Detection, FacilityAnalysis, FacilityNarrative, RiskStatus } from "@/lib/types";
import { STATUS_META, STATUS_ORDER, statusColorHex } from "@/lib/types";
import { haversineKm } from "@/lib/geo";
import clsx from "clsx";

/**
 * DetailDrawer — the map page's PERSISTENT detail pane (not a slide-over).
 *
 * Exactly one state renders at a time, driven by the page's selection state:
 *   1. "empty"    — live summary of the current viewport: hotspot count,
 *                   FRP-band breakdown, facility risk-status breakdown and a
 *                   freshness chip (newest real detection timestamp via
 *                   FreshnessBadge — no timestamp field is invented).
 *   2. "facility" — wraps the existing FacilityDetailPanel (single source of
 *                   truth for facility detail content; never duplicated).
 *   3. "hotspot"  — pinned FIRMS detection: real sensor fields only (FRP,
 *                   brightness, confidence, coordinates, acquisition) via
 *                   FirmsHotspotDetail, plus the corroboration list.
 *   3b. "cell"    — an H3 cell click keeps its existing CellPanel (rendered
 *                   inside the pane, not as an overlay, so the map keeps one
 *                   persistent detail surface).
 *
 * Layout: right pane (~380px) on `lg:`+ — the breakpoint the app's page grids
 * already use for major layout switches — and a bottom sheet below it. The
 * pane is collapsible via the toggle button; any new selection auto-expands
 * it (handled by the parent page).
 *
 * Honesty rule (LIMITATIONS.md): FIRMS detections carry NO hotspot-type or
 * risk-horizon fields anywhere in the current API contract, so none are
 * shown here (see docs/UI_AUDIT.md → "Needs backend work").
 */

export type DetailDrawerSelection =
  | { kind: "empty" }
  | {
      kind: "facility";
      analysis: FacilityAnalysis;
      narrative: FacilityNarrative | null;
      summary: { text: string; provider: string } | null;
      timelineActiveIndex?: number | null;
      onClose: () => void;
      onViewSatellite: () => void;
      onOpenFullPage: () => void;
    }
  | {
      kind: "hotspot";
      hotspot: FirmsHotspot;
      relatedFacilities: FacilityAnalysis[];
      onClose: () => void;
      onSelectFacility: (id: string) => void;
      onViewSatellite: () => void;
    }
  | { kind: "cell"; h3Cell: string; onClose: () => void };

/* ------------------------------------------------------------------ */
/* empty state — live viewport summary                                 */
/* ------------------------------------------------------------------ */

function EmptySummary({
  hotspots,
  analyses,
}: {
  hotspots: FirmsHotspot[];
  analyses: FacilityAnalysis[];
}) {
  /** Real FRP-band classification — the same one the markers/legend use. */
  const bandCounts = React.useMemo(() => {
    const counts: [number, number, number] = [0, 0, 0];
    for (const h of hotspots) counts[frpBandIndex(h.frp)]++;
    return counts;
  }, [hotspots]);

  /** Facility risk-status breakdown (statuses are backend-computed). */
  const statusCounts = React.useMemo(() => {
    const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<
      RiskStatus,
      number
    >;
    for (const a of analyses) counts[a.status] = (counts[a.status] ?? 0) + 1;
    return counts;
  }, [analyses]);

  /** Newest REAL detection timestamp in view — no invented fetch-time field. */
  const latest = React.useMemo(() => {
    let acc: Detection | null = null;
    for (const h of hotspots) {
      if (
        !acc ||
        h.acqDate > acc.acqDate ||
        (h.acqDate === acc.acqDate && h.acqTime > acc.acqTime)
      ) {
        acc = h;
      }
    }
    return acc;
  }, [hotspots]);

  const latestMeta = latest
    ? {
        data_timestamp: `${latest.acqDate}T${latest.acqTime
          .padStart(4, "0")
          .slice(0, 2)}:${latest.acqTime.padStart(4, "0").slice(2, 4)}:00Z`,
      }
    : null;

  const visibleStatuses = STATUS_ORDER.filter((s) => statusCounts[s] > 0);

  return (
    <>
      <section className="rounded-xl bg-bg-surface p-4">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl font-bold leading-none text-text-primary">
            {hotspots.length}
          </span>
          <span className="text-xs text-text-secondary">
            hotspots in the current view
          </span>
        </div>
        <div className="mt-1 text-[11px] text-text-tertiary">
          {analyses.length} monitored facilities in view
        </div>
        <div className="mt-3">
          <FreshnessBadge meta={latestMeta} label="Data as of" />
          <p className="mt-1.5 text-[10px] leading-snug text-text-tertiary">
            Newest VIIRS detection in the current view
            {latest
              ? ` · ${latest.acqDate} ${latest.acqTime
                  .padStart(4, "0")
                  .slice(0, 2)}:${latest.acqTime.padStart(4, "0").slice(2, 4)} UTC`
              : ""}
          </p>
        </div>
      </section>

      <section className="rounded-xl bg-bg-surface p-4">
        <h3 className="font-display text-sm font-semibold text-text-primary">
          Hotspots by FRP band
        </h3>
        <div className="mt-3 grid gap-1.5">
          {FRP_BANDS.map((band, i) => (
            <span key={band.label} className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                style={{ backgroundColor: band.color }}
              />
              <span className="font-mono text-[11px] text-text-secondary">
                {band.label}
              </span>
              <span className="ml-auto font-mono text-[11px] text-text-primary">
                {bandCounts[i]}
              </span>
            </span>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-bg-surface p-4">
        <h3 className="font-display text-sm font-semibold text-text-primary">
          Facilities by risk status
        </h3>
        {visibleStatuses.length === 0 ? (
          <p className="mt-2 text-xs text-text-tertiary">
            No facilities in the current view.
          </p>
        ) : (
          <div className="mt-3 grid gap-1.5">
            {visibleStatuses.map((s) => (
              <span key={s} className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 flex-shrink-0 rounded-sm"
                  style={{ backgroundColor: statusColorHex(s) }}
                />
                <span className="text-[11px] text-text-secondary">
                  {STATUS_META[s].label}
                </span>
                <span className="ml-auto font-mono text-[11px] text-text-primary">
                  {statusCounts[s]}
                </span>
              </span>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* the drawer                                                          */
/* ------------------------------------------------------------------ */

const STATE_TITLE: Record<DetailDrawerSelection["kind"], string> = {
  empty: "Live summary",
  facility: "Facility detail",
  hotspot: "Hotspot detail",
  cell: "Cell detail",
};

export default function DetailDrawer({
  collapsed,
  onToggleCollapsed,
  selection,
  viewportHotspots,
  viewportAnalyses,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  selection: DetailDrawerSelection;
  /** detections currently shown on the map (already filter-narrowed) */
  viewportHotspots: FirmsHotspot[];
  /** classified facilities currently shown on the map */
  viewportAnalyses: FacilityAnalysis[];
}) {
  return (
    <aside
      aria-label="Details panel"
      className={clsx(
        "flex flex-shrink-0 flex-col border-t border-border-hairline bg-bg-base transition-[height] duration-300 lg:border-l lg:border-t-0 lg:transition-[width]",
        collapsed ? "h-11 lg:h-full lg:w-12" : "h-[42vh] lg:h-full lg:w-[380px]",
      )}
    >
      {collapsed ? (
        /* collapsed strip: full-width bar (bottom sheet) / narrow rail (pane) */
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand details panel"
          aria-expanded={false}
          className="flex h-full w-full items-center justify-center text-text-tertiary transition-colors duration-150 hover:bg-bg-raised hover:text-text-primary"
        >
          <ChevronUp size={16} className="lg:hidden" />
          <ChevronsLeft size={16} className="hidden lg:block" />
        </button>
      ) : (
        <>
          {/* slim bar: state label + collapse toggle */}
          <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-border-hairline px-3">
            <span className="font-body text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              {STATE_TITLE[selection.kind]}
            </span>
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Collapse details panel"
              aria-expanded={true}
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-text-tertiary transition-colors duration-150 hover:bg-bg-raised hover:text-text-primary"
            >
              <ChevronDown size={15} className="lg:hidden" />
              <ChevronsRight size={15} className="hidden lg:block" />
            </button>
          </div>

          {/* 1. nothing selected → live viewport summary */}
          {selection.kind === "empty" && (
            <div className="pyro-scroll min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              <EmptySummary hotspots={viewportHotspots} analyses={viewportAnalyses} />
            </div>
          )}

          {/* 2. facility selected → existing FacilityDetailPanel, wrapped */}
          {selection.kind === "facility" && (
            <div className="flex min-h-0 flex-1 flex-col">
              <FacilityDetailPanel
                analysis={selection.analysis}
                narrative={selection.narrative}
                summary={selection.summary}
                timelineActiveIndex={selection.timelineActiveIndex}
                onClose={selection.onClose}
                onViewSatellite={selection.onViewSatellite}
                onOpenFullPage={selection.onOpenFullPage}
              />
            </div>
          )}

          {/* 3. FIRMS hotspot selected → real sensor fields only */}
          {selection.kind === "hotspot" && (
            <>
              <div className="flex items-start gap-3 border-b border-border-hairline p-5 pb-4">
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold leading-snug text-text-primary">
                    Thermal hotspot
                  </h2>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {selection.hotspot.satellite} {selection.hotspot.instrument} · VIIRS
                    active-fire detection
                  </p>
                </div>
                <button
                  type="button"
                  onClick={selection.onClose}
                  aria-label="Close hotspot detail"
                  className="ml-auto flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors duration-150 hover:bg-bg-raised hover:text-text-primary"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="pyro-scroll min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                <FirmsHotspotDetail hotspot={selection.hotspot} />
                <button
                  type="button"
                  onClick={selection.onViewSatellite}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-border-hairline bg-bg-raised py-2.5 text-xs font-medium text-text-secondary transition-colors duration-150 hover:border-border-strong hover:text-text-primary"
                >
                  <Satellite size={14} />
                  View satellite
                </button>
                {selection.relatedFacilities.length > 0 && (
                  <section>
                    <h3 className="font-display text-sm font-semibold text-text-primary">
                      Nearby facilities — is this hotspot corroborated?
                    </h3>
                    <p className="mt-1 text-xs leading-snug text-text-secondary">
                      Facilities whose corroboration radius (5 km) covers this
                      detection. Their classification already includes it.
                    </p>
                    <div className="mt-3 space-y-2">
                      {selection.relatedFacilities.map((a) => (
                        <button
                          key={a.facility.id}
                          type="button"
                          onClick={() => selection.onSelectFacility(a.facility.id)}
                          className="flex w-full items-center gap-3 rounded-lg border border-border-hairline bg-bg-surface px-3 py-2.5 text-left transition-colors duration-150 hover:border-border-strong hover:bg-bg-raised"
                        >
                          <span
                            className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: statusColorHex(a.status) }}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-text-primary">
                              {a.facility.name}
                            </span>
                            <span className="block text-xs text-text-secondary">
                              {a.facility.type} · {a.detectionCount} det · score {a.score}
                            </span>
                          </span>
                          <span className="ml-auto flex-shrink-0 font-mono text-[11px] text-text-secondary">
                            {haversineKm(
                              selection.hotspot.latitude,
                              selection.hotspot.longitude,
                              a.facility.lat,
                              a.facility.lng,
                            ).toFixed(1)}{" "}
                            km
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {selection.relatedFacilities.length === 0 && (
                  <p className="rounded-lg border border-border-hairline bg-bg-raised px-3 py-2 text-xs text-text-secondary">
                    No monitored facility within 15 km — this is likely biomass
                    burning or an unmonitored source, not industrial activity.
                  </p>
                )}
              </div>
            </>
          )}

          {/* 3b. H3 cell selected → existing CellPanel, wrapped */}
          {selection.kind === "cell" && (
            <div className="min-h-0 flex-1">
              <CellPanel h3Cell={selection.h3Cell} onClose={selection.onClose} />
            </div>
          )}
        </>
      )}
    </aside>
  );
}
