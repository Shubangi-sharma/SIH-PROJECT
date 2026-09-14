"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Satellite, X } from "lucide-react";
import MapCanvas, { LayerId, MapMode } from "@/components/MapCanvas";
import HealthScoreRing from "@/components/HealthScoreRing";
import WhatChangedPanel from "@/components/WhatChangedPanel";
import AiSummaryBlock from "@/components/AiSummaryBlock";
import IncidentTimeline from "@/components/IncidentTimeline";
import TimelineSlider from "@/components/TimelineSlider";
import { FirmsHotspotDetail } from "@/components/MapMarkerTooltips";
import type { Basemap, MapView } from "@/components/MapInner";
import { useDebounced, useAnalyses, useFirms } from "@/lib/hooks";
import { fetchFacilityAnalysis, fetchSummary } from "@/lib/api";
import { BBox, REGION_BBOXES } from "@/lib/regions";
import { FacilityNarrative, RiskStatus, statusColorHex } from "@/lib/types";
import { FirmsHotspot, frpColor } from "@/lib/firms";
import { haversineKm } from "@/lib/geo";
import clsx from "clsx";

/** True when `inner` lies fully inside `outer` (with a small margin). */
function bboxContained(inner: BBox, outer: BBox): boolean {
  const m = 0.25; // degrees of slack
  return (
    inner.west >= outer.west - m &&
    inner.east <= outer.east + m &&
    inner.south >= outer.south - m &&
    inner.north <= outer.north + m
  );
}

/** §5: map-driven refetches wait ≥500 ms after the map stops moving. */
const VIEWPORT_DEBOUNCE_MS = 500;

/** Live telemetry readouts for the selected facility. */
function MonoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-hairline bg-bg-inset px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-tertiary">
        {label}
      </div>
      <div className="mt-0.5 truncate font-mono text-xs text-text-primary">
        {value}
      </div>
    </div>
  );
}

/** Skeleton block matching the detail slide-over layout (design.md). */
function DetailSkeleton() {
  return (
    <div className="pyro-scroll flex-1 space-y-5 overflow-y-auto p-5" aria-hidden>
      <div className="flex items-center gap-5 rounded-xl bg-bg-surface p-5">
        <div className="h-[120px] w-[120px] animate-pulse rounded-full bg-bg-raised" />
        <div className="ml-auto grid w-[150px] grid-cols-1 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg bg-bg-raised" />
          ))}
        </div>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-xl bg-bg-surface" />
      ))}
    </div>
  );
}

export default function MapPage() {
  const router = useRouter();

  const [mode, setMode] = useState<MapMode>("india");
  const [basemap, setBasemap] = useState<Basemap>("dark");
  const [view, setView] = useState<MapView>({
    center: [22.0, 79.0],
    zoom: 5,
    key: "india",
  });
  const [layers, setLayers] = useState<Record<LayerId, boolean>>({
    firms: true,
    boundaries: false,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* -------- selected FIRMS hotspot ("pinned" for study) -------- */
  const [selectedHotspotKey, setSelectedHotspotKey] = useState<string | null>(null);
  const handleSelectHotspot = useCallback((key: string | null) => {
    setSelectedHotspotKey(key);
  }, []);

  /* -------- backend data: computed analyses + stored detections -------- */
  const regionBboxes = REGION_BBOXES[mode];
  // §5 debounce: if the user pans/zooms beyond the fetched region, wait for
  // movement to stop (≥500 ms) and add the new viewport as a fetch region.
  const [viewport, setViewport] = useState<BBox | null>(null);
  const debouncedViewport = useDebounced(viewport, VIEWPORT_DEBOUNCE_MS);

  const fetchBboxes: BBox[] = useMemo(() => {
    if (!debouncedViewport) return regionBboxes;
    const covered = regionBboxes.some((b) => bboxContained(debouncedViewport, b));
    return covered ? regionBboxes : [...regionBboxes, debouncedViewport];
  }, [regionBboxes, debouncedViewport]);

  const {
    analyses,
    error: analysesError,
    isLoading: analysesLoading,
  } = useAnalyses(fetchBboxes);
  const {
    hotspots,
    error: firmsError,
    isLoading: firmsLoading,
  } = useFirms(fetchBboxes);

  /* -------- timeline date filter -------- */
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const filteredHotspots = useMemo(
    () =>
      filterDate
        ? hotspots.filter((h) => h.acqDate === filterDate)
        : hotspots,
    [hotspots, filterDate],
  );

  /* -------- selected facility: backend narrative + grounded AI summary ------- */

  const selected = useMemo(
    () => analyses.find((a) => a.facility.id === selectedId) ?? null,
    [analyses, selectedId],
  );

  /** The pinned FIRMS hotspot object, resolved from its marker key. */
  const selectedHotspot: FirmsHotspot | null = useMemo(() => {
    if (!selectedHotspotKey) return null;
    const [latStr, lngStr, idxStr] = selectedHotspotKey.split(",");
    const lat = Number(latStr);
    const lng = Number(lngStr);
    const idx = Number(idxStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    // the marker key embeds the array index so duplicated coordinates resolve
    const matches = hotspots.filter((h) => h.latitude === lat && h.longitude === lng);
    return matches[idx] ?? matches[0] ?? null;
  }, [selectedHotspotKey, hotspots]);

  /** Facilities whose corroboration radius could cover the pinned hotspot. */
  const relatedFacilities = useMemo(() => {
    if (!selectedHotspot) return [];
    return analyses
      .map((a) => ({
        analysis: a,
        distKm: haversineKm(
          selectedHotspot.latitude,
          selectedHotspot.longitude,
          a.facility.lat,
          a.facility.lng,
        ),
      }))
      .filter((x) => x.distKm <= 15)
      .sort((x, y) => x.distKm - y.distKm)
      .slice(0, 6)
      .map((x) => x.analysis);
  }, [selectedHotspot, analyses]);

  /** Detections near the selected FACILITY (context for its narrative). */
  const relatedDetections = useMemo(() => {
    if (!selected) return [];
    return filteredHotspots
      .map((h) => ({
        hotspot: h,
        nearestKm: haversineKm(selected.facility.lat, selected.facility.lng, h.latitude, h.longitude),
      }))
      .filter((x) => x.nearestKm <= 5)
      .sort((x, y) => x.nearestKm - y.nearestKm)
      .slice(0, 8)
      .map((x) => ({ ...x.hotspot, nearestKm: x.nearestKm }));
  }, [selected, filteredHotspots]);

  // Fetch the facility's computed narrative (What Changed + timeline) from
  // the backend; the AI summary is fetched separately so it can regenerate
  // (new ingestion cycle / provider fallback) without recomputing analyses.
  const [narrative, setNarrative] = useState<FacilityNarrative | null>(null);
  const [summary, setSummary] = useState<{ text: string; provider: string } | null>(null);

  useEffect(() => {
    setNarrative(null);
    setSummary(null);
    if (!selectedId) return;
    let cancelled = false;
    fetchFacilityAnalysis(selectedId)
      .then((r) => {
        if (!cancelled) {
          setNarrative({
            whatChanged: r.narrative.whatChanged,
            timeline: r.narrative.timeline,
          });
        }
      })
      .catch(() => {});
    fetchSummary(selectedId)
      .then((r) => {
        if (!cancelled) setSummary({ text: r.text, provider: r.provider });
        return null;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  /* ----------------------------- handlers ----------------------------- */

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleModeChange = useCallback(
    (m: MapMode) => {
      setMode(m);
      setSelectedId(null);
      setSelectedHotspotKey(null);
      setViewport(null);
      setView(
        m === "india"
          ? { center: [22.0, 79.0], zoom: 5, key: `india-${Date.now()}` }
          : { center: [20.0, 0.0], zoom: 2, key: `global-${Date.now()}` },
      );
    },
    [],
  );

  const toggleLayer = useCallback((id: LayerId) => {
    setLayers((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleBasemapChange = useCallback((b: Basemap) => {
    setBasemap(b);
  }, []);

  /** §5: satellite verification — switch basemap and fly to the facility. */
  const viewInSatellite = useCallback(() => {
    if (!selected) return;
    setBasemap("satellite");
    setView({
      center: [selected.facility.lat, selected.facility.lng],
      zoom: 12,
      key: `sat-${selected.facility.id}-${Date.now()}`,
    });
  }, [selected]);

  const handleViewport = useCallback((b: [number, number, number, number]) => {
    setViewport({ west: b[0], south: b[1], east: b[2], north: b[3] });
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1">
        <MapCanvas
          view={view}
          analyses={analyses}
          selectedId={selectedId}
          onSelect={handleSelect}
          mode={mode}
          onModeChange={handleModeChange}
          layers={layers}
          onToggleLayer={toggleLayer}
          tilesLoading={firmsLoading && !analyses.length}
          basemap={basemap}
          onBasemapChange={handleBasemapChange}
          firmsHotspots={filteredHotspots}
          selectedHotspotKey={selectedHotspotKey}
          onSelectHotspot={handleSelectHotspot}
          onViewport={handleViewport}
        >
          {/* FIRMS feed status — always honest: live count or explicit error */}
          <div
            role="status"
            className={clsx(
              "absolute bottom-12 right-4 z-[1000] flex items-center gap-2 rounded-md border px-2.5 py-1.5 font-mono text-[11px] shadow-lg shadow-black/40",
              firmsError
                ? "border-border-strong bg-bg-void/90 text-status-watch"
                : "border-border-hairline bg-bg-raised/95 text-text-secondary",
            )}
          >
            <span
              className={clsx(
                "inline-block h-1.5 w-1.5 rounded-full",
                firmsError ? "bg-status-watch" : "animate-pulse bg-accent-secondary",
              )}
            />
            {firmsError
              ? "FIRMS feed unavailable"
              : `VIIRS · ${filteredHotspots.length} detections${filterDate ? ` (${filterDate})` : " (10d)"}`}
          </div>

          {/* timeline slider */}
          <TimelineSlider
            hotspots={hotspots}
            onFilterDate={setFilterDate}
            className="absolute bottom-4 left-4 right-[420px] z-[1000]"
          />

          {/* backend status chips */}
          {analysesError && (
            <div
              role="status"
              className="absolute left-4 top-[52px] z-[1000] rounded-md border border-border-strong bg-bg-void/90 px-2.5 py-1.5 font-mono text-[11px] text-status-watch shadow-lg shadow-black/40"
            >
              Backend analyses unavailable
            </div>
          )}

          {/* ---------------- detail slide-over (on demand) ----------------
              Opens for either a facility OR a pinned FIRMS hotspot, so the
              pattern behind a hotspot can actually be studied in depth. */}
          <aside
            aria-hidden={!selected && !selectedHotspot}
            className={clsx(
              "absolute right-0 top-0 z-[1100] flex h-full w-full max-w-[400px] flex-col border-l border-border-hairline bg-bg-base shadow-2xl shadow-black/60 transition-transform duration-300",
              selected || selectedHotspot ? "translate-x-0" : "translate-x-full",
            )}
          >
            {selected && (
              <>
                <div className="flex items-start gap-3 border-b border-border-hairline p-5">
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-semibold leading-snug text-text-primary">
                      {selected.facility.name}
                    </h2>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {selected.facility.type} · OSM {selected.facility.id.replace("osm-", "")}
                    </p>
                    {selected.detectionCount > 0 && (
                      <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-secondary"
                        style={{ backgroundColor: "rgba(6,182,212,0.14)" }}
                      >
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-secondary" />
                        FIRMS-confirmed
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    aria-label="Close facility detail"
                    className="ml-auto flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors duration-150 hover:bg-bg-raised hover:text-text-primary"
                  >
                    <X size={16} />
                  </button>
                </div>

                {narrative ? (
                  <div className="pyro-scroll flex-1 space-y-5 overflow-y-auto p-5">
                    {/* health signal — the ONE prominent status element */}
                    <div className="flex items-center gap-5 rounded-xl bg-bg-surface p-5">
                      <HealthScoreRing score={selected.score} status={selected.status as RiskStatus} />
                      <div className="ml-auto grid w-[150px] grid-cols-1 gap-2">
                        <MonoStat label="Type" value={selected.facility.type} />
                        <MonoStat
                          label="Coordinates"
                          value={`${selected.facility.lat.toFixed(2)}°, ${selected.facility.lng.toFixed(2)}°`}
                        />
                        <MonoStat
                          label="FRP (latest)"
                          value={
                            selected.latestFrp != null ? `${selected.latestFrp.toFixed(1)} MW` : "no detection"
                          }
                        />
                        <MonoStat
                          label="Nearest det."
                          value={selected.nearestKm != null ? `${selected.nearestKm.toFixed(1)} km` : "—"}
                        />
                      </div>
                    </div>
                    {selected.detectionCount === 0 && (
                      <p className="rounded-lg border border-border-hairline bg-bg-raised px-3 py-2 text-xs text-text-secondary">
                        No thermal activity detected — this facility sits in a quiet
                        region of the current FIRMS window.
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={viewInSatellite}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-border-hairline bg-bg-raised py-2.5 text-xs font-medium text-text-secondary transition-colors duration-150 hover:border-border-strong hover:text-text-primary"
                    >
                      <Satellite size={14} />
                      View satellite
                    </button>

                    {relatedDetections.length > 0 && (
                      <section className="rounded-xl bg-bg-surface p-4">
                        <h3 className="font-display text-sm font-semibold text-text-primary">
                          Detections in the corroboration window
                        </h3>
                        <ul className="mt-3 space-y-1.5">
                          {relatedDetections.map((h, i) => {
                            const hex = frpColor(h.frp);
                            return (
                              <li
                                key={`${h.acqDate}-${h.acqTime}-${i}`}
                                className="flex items-center gap-2.5 rounded-lg border border-border-hairline bg-bg-inset px-2.5 py-1.5"
                              >
                                <span
                                  className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                                  style={{ backgroundColor: hex }}
                                />
                                <span className="font-mono text-[11px] text-text-primary">
                                  {h.frp.toFixed(1)} MW · {h.brightness.toFixed(0)} K
                                </span>
                                <span className="ml-auto font-mono text-[10px] text-text-secondary">
                                  {h.nearestKm.toFixed(1)} km · {h.ageDays === 0 ? "today" : `${h.ageDays}d ago`}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    )}

                    <WhatChangedPanel rows={narrative.whatChanged} />
                    <AiSummaryBlock text={summary?.text ?? "Generating grounded summary…"} />
                    <IncidentTimeline events={narrative.timeline} />

                    <button
                      type="button"
                      onClick={() => router.push(`/facilities/${selected.facility.id}`)}
                      className="w-full rounded-lg py-1 text-center text-xs font-medium text-accent-primary transition-colors duration-150 hover:text-accent-secondary"
                    >
                      Open full facility page →
                    </button>
                  </div>
                ) : (
                  <DetailSkeleton />
                )}
              </>
            )}

            {/* pinned FIRMS hotspot study card */}
            {selectedHotspot && (
              <div className="flex items-start gap-3 border-b border-border-hairline p-5">
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold leading-snug text-text-primary">
                    Thermal hotspot
                  </h2>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {selectedHotspot.satellite} {selectedHotspot.instrument} · VIIRS active-fire detection
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedHotspotKey(null)}
                  aria-label="Close hotspot detail"
                  className="ml-auto flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors duration-150 hover:bg-bg-raised hover:text-text-primary"
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {selectedHotspot && (
              <div className="pyro-scroll flex-1 space-y-5 overflow-y-auto p-5">
                <FirmsHotspotDetail hotspot={selectedHotspot} />
                <button
                  type="button"
                  onClick={() => {
                    setBasemap("satellite");
                    setView({
                      center: [selectedHotspot.latitude, selectedHotspot.longitude],
                      zoom: 13,
                      key: `sat-hotspot-${selectedHotspotKey}-${Date.now()}`,
                    });
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-border-hairline bg-bg-raised py-2.5 text-xs font-medium text-text-secondary transition-colors duration-150 hover:border-border-strong hover:text-text-primary"
                >
                  <Satellite size={14} />
                  View satellite
                </button>
                {relatedFacilities.length > 0 && (
                  <section>
                    <h3 className="font-display text-sm font-semibold text-text-primary">
                      Nearby facilities — is this hotspot corroborated?
                    </h3>
                    <p className="mt-1 text-xs leading-snug text-text-secondary">
                      Facilities whose corroboration radius (5 km) covers this
                      detection. Their classification already includes it.
                    </p>
                    <div className="mt-3 space-y-2">
                      {relatedFacilities.map((a) => (
                        <button
                          key={a.facility.id}
                          type="button"
                          onClick={() => {
                            setSelectedHotspotKey(null);
                            setSelectedId(a.facility.id);
                          }}
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
                              selectedHotspot.latitude,
                              selectedHotspot.longitude,
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
                {relatedFacilities.length === 0 && (
                  <p className="rounded-lg border border-border-hairline bg-bg-raised px-3 py-2 text-xs text-text-secondary">
                    No monitored facility within 15 km — this is likely biomass
                    burning or an unmonitored source, not industrial activity.
                  </p>
                )}
              </div>
            )}
          </aside>
        </MapCanvas>
      </div>
    </div>
  );
}
