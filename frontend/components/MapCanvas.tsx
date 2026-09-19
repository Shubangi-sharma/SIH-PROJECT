"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Building2,
  BookOpen,
  Flame,
  Satellite,
  SlidersHorizontal,
} from "lucide-react";
import {
  FacilityAnalysis,
  RiskStatus,
  STATUS_META,
  STATUS_ORDER,
} from "@/lib/types";
import { FirmsHotspot, FRP_BANDS } from "@/lib/firms";
import { INDIA_STATE_BBOXES } from "@/lib/regions";
import type { Basemap, MapView } from "./MapInner";
import { StatusLegendRow } from "@/lib/status";
import MapErrorBoundary from "./MapErrorBoundary";
import clsx from "clsx";

const MapInner = dynamic(() => import("./MapInner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-bg-base font-body text-xs text-text-tertiary">
      Loading map…
    </div>
  ),
});

export type MapMode = "india" | "global";
/**
 * Every toggle here drives a real visible layer — §3 dead-UI audit removed
 * the old landcover/FRP-heatmap stubs, which had no data behind them.
 */
export type LayerId = "firms" | "boundaries";

/** PDF §3 filter state — every control maps to a real field on the data. */
export interface MapFilters {
  state: string | null; // INDIA_STATE_BBOXES id, null = all
  riskStatuses: RiskStatus[]; // empty = all
  frpBand: 0 | 1 | 2 | null; // FRP_BANDS index, null = all
}

export const DEFAULT_FILTERS: MapFilters = { state: null, riskStatuses: [], frpBand: null };

/** FRP band index for a hotspot (mirrors frpColor thresholds). */
export function frpBandIndex(frp: number): 0 | 1 | 2 {
  if (frp < 2) return 0;
  if (frp < 10) return 1;
  return 2;
}

export const LAYERS: { id: LayerId; label: string; icon: React.ElementType }[] = [
  { id: "firms", label: "FIRMS live hotspots", icon: Flame },
  { id: "boundaries", label: "Facility boundaries", icon: Building2 },
];

const BASEMAP_PILL: { id: Basemap; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "streets", label: "Streets" },
  { id: "satellite", label: "Satellite" },
];

export default function MapCanvas({
  view,
  analyses,
  selectedId,
  onSelect,
  mode,
  onModeChange,
  layers,
  onToggleLayer,
  tilesLoading,
  basemap = "dark",
  onBasemapChange,
  firmsHotspots = [],
  showFirms = true,
  selectedHotspotKey = null,
  onSelectHotspot,
  onViewport,
  filters = DEFAULT_FILTERS,
  onFiltersChange,
  children,
}: {
  view: MapView;
  /** classified facilities — computed from real OSM + FIRMS data */
  analyses: FacilityAnalysis[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  mode: MapMode;
  onModeChange: (m: MapMode) => void;
  layers: Record<LayerId, boolean>;
  onToggleLayer: (id: LayerId) => void;
  tilesLoading: boolean;
  basemap?: Basemap;
  onBasemapChange?: (b: Basemap) => void;
  /** live NASA FIRMS detections */
  firmsHotspots?: FirmsHotspot[];
  showFirms?: boolean;
  /** selected ("pinned") FIRMS hotspot */
  selectedHotspotKey?: string | null;
  onSelectHotspot?: (key: string | null) => void;
  /** debounced upstream — fires when the user stops moving the map */
  onViewport: (b: [number, number, number, number]) => void;
  /** PDF §3 filters — applied by the parent to the data it passes down */
  filters?: MapFilters;
  onFiltersChange?: (f: MapFilters) => void;
  /** floating overlays rendered above the map (e.g. the detail slide-over) */
  children?: React.ReactNode;
}) {
  const [tilesLoadingInternal, setTilesLoadingInternal] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Bumped only when the error boundary asks for a reset. A stable key the
  // rest of the time means we never rebuild the Leaflet container on
  // ordinary re-renders — that unnecessary remount was itself a source of
  // "Map container is already initialized" races.
  const [mapInstanceKey, setMapInstanceKey] = useState(0);

  // skeleton must never stick after a failed tile event
  useEffect(() => {
    if (!tilesLoadingInternal) return;
    const t = setTimeout(() => setTilesLoadingInternal(false), 6000);
    return () => clearTimeout(t);
  }, [tilesLoadingInternal]);

  const showSkeleton = tilesLoading || tilesLoadingInternal;
  const satellite = basemap === "satellite";

  return (
    <div className="relative h-full w-full flex-1 bg-bg-base">
      <MapErrorBoundary onReset={() => setMapInstanceKey((k) => k + 1)}>
        <MapInner
          key={mapInstanceKey}
          view={view}
          analyses={analyses}
          selectedId={selectedId}
          onSelect={onSelect}
          basemap={basemap}
          firmsHotspots={firmsHotspots}
          showFirms={showFirms && layers.firms}
          selectedHotspotKey={selectedHotspotKey}
          onSelectHotspot={onSelectHotspot ?? (() => {})}
          onTilesLoading={() => setTilesLoadingInternal(true)}
          onTilesLoaded={() => setTilesLoadingInternal(false)}
          onViewport={onViewport}
        />
      </MapErrorBoundary>

      {showSkeleton && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-pulse bg-bg-surface/45"
        />
      )}

      {/* Global Live badge — top-left, global mode only. Live data, not a
          simulation: no violet SIMULATION MODE treatment anymore (§4). */}
      {mode === "global" && (
        <div
          className={clsx(
            "absolute left-4 top-4 z-[1000] rounded-md border px-2 py-1 font-mono text-xs uppercase tracking-wide shadow-lg shadow-black/40",
            satellite
              ? "border-border-strong bg-bg-void/90 text-accent-secondary"
              : "border-border-hairline bg-bg-raised text-accent-secondary",
          )}
        >
          Global Live
        </div>
      )}

      {/* region mode pill — top-right (filters toggle alongside, §3) */}
      <div className="absolute right-4 top-4 z-[1000] flex items-center gap-2">
        {/* filters toggle (§3) — visible in India mode where state filter applies */}
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          aria-label="Map filters"
          title="Filters"
          className={clsx(
            "flex h-9 w-9 items-center justify-center rounded-full border shadow-lg shadow-black/40 transition-colors duration-150",
            filtersOpen || filters.state || filters.riskStatuses.length > 0 || filters.frpBand != null
              ? "border-accent-primary/50 bg-accent-primary/15 text-accent-primary"
              : satellite
                ? "border-border-strong bg-bg-void/90 text-text-secondary hover:text-text-primary"
                : "border-border-hairline bg-bg-raised text-text-secondary hover:text-text-primary",
          )}
        >
          <SlidersHorizontal size={15} />
        </button>
        <div
          className={clsx(
            "flex rounded-full border p-1 shadow-lg shadow-black/40",
            satellite
              ? "border-border-strong bg-bg-void/90"
              : "border-border-hairline bg-bg-raised",
          )}
        >
          {(
            [
              { id: "india", label: "India" },
              { id: "global", label: "Global Live" },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onModeChange(m.id)}
              className={clsx(
                "rounded-full px-4 py-1.5 font-body text-xs font-medium transition-colors duration-150",
                mode === m.id
                  ? "border border-accent-primary bg-accent-primary/15 text-accent-primary"
                  : "border border-transparent text-text-secondary hover:text-text-primary",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* filter panel (§3: region handled by mode pill; date by timeline;
          persistence/FRP/state/status here) */}
      {filtersOpen && (
        <div
          className={clsx(
            "absolute right-4 top-[52px] z-[1100] w-[248px] rounded-xl border p-4 shadow-lg shadow-black/50",
            satellite
              ? "border-border-strong bg-bg-void/95"
              : "border-border-hairline bg-bg-raised/95",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="font-body text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Filters
            </span>
            <button
              type="button"
              onClick={() => onFiltersChange?.(DEFAULT_FILTERS)}
              className="text-[10px] text-text-tertiary transition-colors duration-150 hover:text-text-primary"
            >
              Reset
            </button>
          </div>

          {/* state (India mode) */}
          {mode === "india" && (
            <label className="mt-3 block">
              <span className="text-[10px] uppercase tracking-wider text-text-tertiary">State / UT</span>
              <select
                value={filters.state ?? ""}
                onChange={(e) => onFiltersChange?.({ ...filters, state: e.target.value || null })}
                className="mt-1 w-full rounded-md border border-border-hairline bg-bg-inset px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-primary"
              >
                <option value="">All states</option>
                {INDIA_STATE_BBOXES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
          )}

          {/* risk status (multi) */}
          <div className="mt-3">
            <span className="text-[10px] uppercase tracking-wider text-text-tertiary">Risk status</span>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {STATUS_ORDER.map((s) => {
                const on = filters.riskStatuses.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      onFiltersChange?.({
                        ...filters,
                        riskStatuses: on
                          ? filters.riskStatuses.filter((x) => x !== s)
                          : [...filters.riskStatuses, s],
                      })
                    }
                    className={clsx(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors duration-150",
                      on ? "text-text-primary" : "text-text-tertiary hover:text-text-secondary",
                    )}
                    style={
                      on
                        ? { backgroundColor: `${STATUS_META[s].hex}30`, color: STATUS_META[s].hex }
                        : { border: "1px solid #1A2028" }
                    }
                  >
                    {STATUS_META[s].label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* FRP band */}
          <div className="mt-3">
            <span className="text-[10px] uppercase tracking-wider text-text-tertiary">FRP band (hotspots)</span>
            <div className="mt-1.5 flex gap-1">
              {([null, 0, 1, 2] as const).map((band) => (
                <button
                  key={String(band)}
                  type="button"
                  aria-pressed={filters.frpBand === band}
                  onClick={() => onFiltersChange?.({ ...filters, frpBand: band })}
                  className={clsx(
                    "flex-1 rounded-md px-1.5 py-1 font-mono text-[10px] transition-colors duration-150",
                    filters.frpBand === band
                      ? "bg-accent-primary/15 text-accent-primary"
                      : "text-text-tertiary hover:text-text-secondary",
                  )}
                  style={filters.frpBand === band ? undefined : { border: "1px solid #1A2028" }}
                >
                  {band === null ? "All" : FRP_BANDS[band].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* right control stack: basemap pill + layer toggles */}
      <div className="absolute right-4 top-[76px] z-[1000] flex flex-col items-end gap-2">
        <div
          className={clsx(
            "flex rounded-full border p-1 shadow-lg shadow-black/40",
            satellite
              ? "border-border-strong bg-bg-void/90"
              : "border-border-hairline bg-bg-raised",
          )}
          role="group"
          aria-label="Basemap"
        >
          {BASEMAP_PILL.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onBasemapChange?.(b.id)}
              aria-pressed={basemap === b.id}
              className={clsx(
                "rounded-full px-3 py-1 font-body text-[11px] font-medium transition-colors duration-150",
                basemap === b.id
                  ? "bg-accent-primary/15 text-accent-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {b.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          {LAYERS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={layers[id]}
              onClick={() => onToggleLayer(id)}
              className={clsx(
                "flex h-8 w-8 items-center justify-center rounded-lg border shadow-lg shadow-black/40 transition-colors duration-150",
                layers[id]
                  ? "border-transparent bg-accent-primary/15 text-accent-primary"
                  : satellite
                    ? "border-border-strong bg-bg-void/90 text-text-secondary hover:text-text-primary"
                    : "border-border-hairline bg-bg-raised text-text-secondary hover:text-text-primary",
              )}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
      </div>

      {/* legend — proper card treatment, legible on any tile colour */}
      <div
        className={clsx(
          "absolute bottom-4 left-4 z-[1000] rounded-lg border p-3 shadow-lg shadow-black/40 backdrop-blur",
          satellite
            ? "border-border-strong bg-bg-void/90"
            : "border-border-hairline bg-bg-raised/90",
        )}
      >
        <div className="mb-2 font-body text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
          Risk Status
        </div>
        <div className="grid gap-1.5">
          {STATUS_ORDER.map((s) => (
            <StatusLegendRow
              key={s}
              status={s as RiskStatus}
              label={STATUS_META[s as RiskStatus].label}
            />
          ))}
        </div>

        {/* FRP scale for the FIRMS hotspot layer — only meaningful when that
            layer is on; hidden otherwise so the legend never lies */}
        {showFirms && layers.firms && (
          <>
            <div className="mb-1.5 mt-3 border-t border-border-hairline pt-2.5 font-body text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              FRP (hotspots)
            </div>
            <div className="grid gap-1.5">
              {FRP_BANDS.map((band) => (
                <span key={band.label} className="flex items-center gap-2">
                  <span
                    className="inline-block h-[9px] w-[9px] flex-shrink-0 rounded-full"
                    style={{ backgroundColor: band.color }}
                  />
                  <span className="font-mono text-[11px] text-text-secondary">{band.label}</span>
                </span>
              ))}
            </div>
            <div className="mt-2 font-body text-[10px] leading-snug text-text-tertiary">
              Fire radiative power — bigger/hotter fires
            </div>
          </>
        )}

        {/* deep link to the full explainer on the settings page */}
        <Link
          href="/settings#how-to-read"
          className="mt-3 flex items-center gap-1.5 border-t border-border-hairline pt-2.5 font-body text-[10px] font-medium text-accent-primary transition-colors duration-150 hover:text-accent-secondary"
        >
          <BookOpen size={11} aria-hidden />
          How to read this map
        </Link>
      </div>

      {/* floating overlays above the map (detail slide-over) */}
      {children}
    </div>
  );
}
