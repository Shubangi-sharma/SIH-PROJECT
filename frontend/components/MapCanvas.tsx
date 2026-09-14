"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Building2,
  BookOpen,
  Flame,
  Satellite,
} from "lucide-react";
import {
  FacilityAnalysis,
  RiskStatus,
  STATUS_META,
  STATUS_ORDER,
} from "@/lib/types";
import { FirmsHotspot, FRP_BANDS } from "@/lib/firms";
import type { Basemap, MapView } from "./MapInner";
import { StatusLegendRow } from "@/lib/status";
import clsx from "clsx";

const MapInner = dynamic(() => import("./MapInner"), {
  ssr: false,
  loading: () => null,
});

export type MapMode = "india" | "global";
/**
 * Every toggle here drives a real visible layer — §3 dead-UI audit removed
 * the old landcover/FRP-heatmap stubs, which had no data behind them.
 */
export type LayerId = "firms" | "boundaries";

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
  /** floating overlays rendered above the map (e.g. the detail slide-over) */
  children?: React.ReactNode;
}) {
  const [tilesLoadingInternal, setTilesLoadingInternal] = useState(false);

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
      <MapInner
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

      {/* region mode pill — top-right */}
      <div
        className={clsx(
          "absolute right-4 top-4 z-[1000] flex rounded-full border p-1 shadow-lg shadow-black/40",
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
