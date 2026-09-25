"use client";

/**
 * ObservationsPanels — live Land cover / Surroundings / Weather for a point.
 *
 * Fetches GET /api/ml/observations (pyrosense_ml's feature-engineering
 * modules, via the Node proxy) and renders the three §4 field groups with
 * REAL computed values. Unknowns render as "—" verbatim from the API's
 * nulls — never fabricated. Per-block provenance chips mirror the Predict
 * page's feature-provenance styling.
 */

import React from "react";
import useSWR from "swr";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import PyroLoader from "./PyroLoader";
import { fetchObservations, type ObservationsResponseDto } from "@/lib/mlApi";

const LC_LABELS: Record<string, string> = {
  water: "Water",
  trees: "Trees",
  grass: "Grass",
  flooded_vegetation: "Flooded veg.",
  crops: "Crops",
  shrub_and_scrub: "Shrub / scrub",
  built: "Built",
  bare: "Bare",
  snow_and_ice: "Snow / ice",
};

const LC_COLORS: Record<string, string> = {
  water: "#5CA0AD",
  trees: "#5FA97C",
  grass: "#9CB86E",
  flooded_vegetation: "#6FA3B8",
  crops: "#B99B5E",
  shrub_and_scrub: "#A8A15C",
  built: "#C08A62",
  bare: "#8E8A80",
  snow_and_ice: "#B9C2CE",
};

const DISTANCE_LABELS: Record<string, string> = {
  industrial: "Industry",
  power: "Power",
  mining: "Mining",
  fuel: "Fuel storage",
  transport: "Transport",
  agriculture: "Farmland",
};

const WEATHER_ROWS: { key: Exclude<keyof ObservationsResponseDto["weather"], "lookback_days" | "provenance">; label: string; unit: string }[] = [
  { key: "mean_temperature_c", label: "Mean temp", unit: "°C" },
  { key: "max_temperature_c", label: "Max temp", unit: "°C" },
  { key: "mean_dewpoint_c", label: "Dewpoint", unit: "°C" },
  { key: "mean_relative_humidity", label: "Rel. humidity (mean)", unit: "%" },
  { key: "min_relative_humidity", label: "Rel. humidity (min)", unit: "%" },
  { key: "mean_wind_speed_ms", label: "Wind (mean)", unit: "m/s" },
  { key: "max_wind_speed_ms", label: "Wind (max)", unit: "m/s" },
  { key: "total_precipitation", label: "Precipitation Σ", unit: "mm" },
  { key: "mean_precipitation", label: "Precipitation (mean)", unit: "mm" },
  { key: "mean_ssrd", label: "Solar rad. (mean)", unit: "W/m²" },
  { key: "max_ssrd", label: "Solar rad. (max)", unit: "W/m²" },
];

function MonoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-hairline bg-bg-inset px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm text-text-primary">{value}</div>
    </div>
  );
}

function ProvenanceChip({ block, src }: { block: string; src: string }) {
  const degraded = src === "unavailable";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        degraded ? "bg-status-watch/15 text-status-watch" : "bg-bg-raised text-text-secondary",
      )}
    >
      {degraded ? <AlertTriangle size={9} aria-hidden /> : <CheckCircle2 size={9} aria-hidden />}
      {block}: {src}
    </span>
  );
}

/** Stacked ratio bar + per-class rows — shares sum to the observed total. */
function LandCoverBody({ lc }: { lc: ObservationsResponseDto["land_cover"] }) {
  const entries = Object.entries(lc.ratios);
  const total = entries.reduce((a, [, v]) => a + (v ?? 0), 0);
  if (total <= 0) {
    return (
      <p className="rounded-lg border border-border-hairline bg-bg-raised px-3 py-2 text-xs leading-relaxed text-text-secondary">
        No land-cover observations available for this point.
      </p>
    );
  }
  return (
    <>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-bg-raised">
        {entries
          .filter(([, v]) => (v ?? 0) > 0)
          .map(([cls, v]) => (
            <div
              key={cls}
              className="h-full"
              style={{ width: `${((v ?? 0) / total) * 100}%`, backgroundColor: LC_COLORS[cls] ?? "#8E8A80" }}
              title={`${LC_LABELS[cls] ?? cls} - ${(((v ?? 0) / total) * 100).toFixed(1)}%`}
            />
          ))}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {entries.map(([cls, v]) => (
          <div key={cls} className="flex items-center justify-between gap-2 rounded-lg border border-border-hairline bg-bg-inset px-2.5 py-2">
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-secondary">
              <span
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{ backgroundColor: LC_COLORS[cls] ?? "#8E8A80" }}
              />
              <span className="truncate">{LC_LABELS[cls] ?? cls}</span>
            </span>
            <span className="font-mono text-[11px] text-text-primary">
              {v == null ? "-" : `${Math.round(v * 100)}%`}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-text-tertiary">
        {lc.observations != null ? `${Math.round(lc.observations)} OSM area features within ~1 km` : "Observation count unavailable"}
        {lc.dominant ? ` · dominant: ${LC_LABELS[lc.dominant] ?? lc.dominant}` : ""}
      </p>
    </>
  );
}

function SurroundingsBody({ s }: { s: ObservationsResponseDto["surroundings"] }) {
  const entries = Object.entries(s.distances_km);
  const anyValue = entries.some(([, v]) => v != null);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {entries.map(([key, v]) => (
          <MonoStat
            key={key}
            label={DISTANCE_LABELS[key] ?? key}
            value={v == null ? "-" : v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(1)} km`}
          />
        ))}
      </div>
      {anyValue && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {Object.entries(s.proximity_flags).map(([flag, on]) => (
            <span
              key={flag}
              className={clsx(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                on == null
                  ? "bg-bg-raised text-text-tertiary"
                  : on
                    ? "bg-status-critical/15 text-status-critical"
                    : "bg-bg-raised text-text-secondary",
              )}
            >
              {flag.replace(/_/g, " ")}: {on == null ? "unknown" : on ? "within" : "clear"}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function WeatherBody({ w }: { w: ObservationsResponseDto["weather"] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {WEATHER_ROWS.map(({ key, label, unit }) => {
        const v = w[key];
        return (
          <MonoStat key={String(key)} label={label} value={v == null ? "-" : `${v.toFixed(1)} ${unit}`} />
        );
      })}
    </div>
  );
}

export default function ObservationsPanels({ lat, lng }: { lat: number; lng: number }) {
  /* SWR instead of raw useEffect: results are cached per coordinate pair, so
     returning to a facility (or comparing neighbours) renders instantly from
     cache while a background revalidation refreshes. keepPreviousData keeps
     the previous point's panels visible (labelled by its own timestamp)
     instead of flashing a loader on every navigation. */
  const { data: obs, error, isLoading } = useSWR<ObservationsResponseDto>(
    ["ml-observations", lat, lng] as const,
    ([, latK, lngK]: readonly [string, number, number]) => fetchObservations(latK, lngK),
    {
      revalidateOnFocus: false,
      keepPreviousData: true,
      dedupingInterval: 60_000,
    },
  );

  if (isLoading) {
    return (
      <section className="dash-card flex items-center justify-center rounded-xl px-5 py-12">
        <PyroLoader
          label="Reading the environment"
          sub="Land cover, nearby infrastructure and recent weather for this point, computed live by the ML service"
          compact
        />
      </section>
    );
  }

  if (error) {
    return (
      <section className="dash-card rounded-xl p-5">
        <h3 className="font-display text-sm font-semibold text-text-primary">Environment observations</h3>
        <p className="mt-3 rounded-lg border border-border-hairline bg-bg-raised px-3 py-2 text-xs leading-relaxed text-text-secondary">
          {error instanceof Error ? error.message : "Observations unavailable."} The
          ML service computes these live; check that it is reachable and retry.
        </p>
      </section>
    );
  }

  if (!obs) return null;

  return (
    <>
      {obs.warnings.length > 0 && (
        <section className="rounded-xl border border-border-hairline bg-bg-surface p-4">
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-status-watch">
            <AlertTriangle size={12} />
            Observation warnings
          </h3>
          <ul className="mt-2 space-y-1">
            {obs.warnings.map((w, i) => (
              <li key={i} className="text-xs leading-relaxed text-text-secondary">
                · {w}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="dash-card rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-sm font-semibold text-text-primary">Land cover</h3>
          <ProvenanceChip block="source" src={obs.land_cover.provenance} />
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-text-tertiary">
          Six Dynamic Earth land-cover ratios around the point.
        </p>
        <div className="mt-3">
          <LandCoverBody lc={obs.land_cover} />
        </div>
      </section>

      <section className="dash-card rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-sm font-semibold text-text-primary">Surroundings</h3>
          <ProvenanceChip block="source" src={obs.surroundings.provenance} />
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-text-tertiary">
          Distances to industrial, power, mining, fuel-storage, agriculture and transport infrastructure.
        </p>
        <div className="mt-3">
          <SurroundingsBody s={obs.surroundings} />
        </div>
      </section>

      <section className="dash-card rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-sm font-semibold text-text-primary">Weather</h3>
          <ProvenanceChip block="source" src={obs.weather.provenance} />
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-text-tertiary">
          Temperature, wind, dewpoint, precipitation and solar radiation aggregates
          over the last {obs.weather.lookback_days} days.
        </p>
        <div className="mt-3">
          <WeatherBody w={obs.weather} />
        </div>
      </section>
    </>
  );
}
