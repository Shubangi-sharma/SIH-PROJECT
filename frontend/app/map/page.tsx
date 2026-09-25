"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MapCanvas, {
  DEFAULT_FILTERS,
  frpBandIndex,
  LayerId,
  MapFilters,
  MapMode,
} from "@/components/MapCanvas";
// NOTE: this file must end with a default-exported <Suspense> wrapper around
// MapPageContent — useSearchParams is not allowed to prerender without one
// (a missing wrapper 500s /map with "Cannot access default.then on the server").
import DetailDrawer, { type DetailDrawerSelection } from "@/components/DetailDrawer";
import AreaPanel from "@/components/AreaPanel";
import TimelineSlider from "@/components/TimelineSlider";
import ReplayControls from "@/components/ReplayControls";
import { useReplay, replayActiveEventIndex } from "@/lib/replay";
import type { Basemap, MapView } from "@/components/MapInner";
import { useDebounced, useAnalyses, useFirms } from "@/lib/hooks";
import { fetchFacilityAnalysis, fetchSummary } from "@/lib/api";
import { BBox, REGION_BBOXES, stateForPoint } from "@/lib/regions";
import type { FacilityNarrative } from "@/lib/types";
import type { FirmsHotspot } from "@/lib/firms";
import { haversineKm } from "@/lib/geo";

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

function MapPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<MapMode>("india");
  const [basemap, setBasemap] = useState<Basemap>("dark");
  const [view, setView] = useState<MapView>({
    center: [22.0, 79.0],
    zoom: 5,
    key: "india",
  });
  const [layers, setLayers] = useState<Record<LayerId, boolean>>({
    firms: true,
    facilities: true,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* -------- deep link: /map?lat=…&lng=…&zoom=… flies straight to a point.
     Used by facility locators ("Open on Hotspot Map") so the operator
     lands on the exact location, one click. Runs once on mount. */
  useEffect(() => {
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return;
    const zoom = Number(searchParams.get("zoom"));
    setView({
      center: [lat, lng],
      zoom: Number.isFinite(zoom) && zoom >= 3 && zoom <= 18 ? zoom : 12,
      key: `deeplink-${lat}-${lng}-${Date.now()}`,
    });
    // Consume the params so refresh/re-navigation doesn't re-fly mid-session.
    router.replace("/map", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* -------- §3 filters: state, risk status, FRP band -------- */
  const [filters, setFilters] = useState<MapFilters>(DEFAULT_FILTERS);

  /* -------- selected FIRMS hotspot ("pinned" for study) -------- */
  const [selectedHotspotKey, setSelectedHotspotKey] = useState<string | null>(null);
  const handleSelectHotspot = useCallback((key: string | null) => {
    setSelectedHotspotKey(key);
    if (key) setSelectedArea(null); // panels are mutually exclusive
  }, []);

  /* -------- plain-language area click panel (replaces the H3 cell panel):
     clicking open map shows what the area is / isn't monitored -------- */
  const [selectedArea, setSelectedArea] = useState<{ lat: number; lng: number } | null>(null);
  const handleAreaClick = useCallback((point: { lat: number; lng: number }) => {
    setSelectedArea(point);
    // one panel at a time — an area click closes facility/hotspot panels
    setSelectedId(null);
    setSelectedHotspotKey(null);
  }, []);

  /* -------- persistent detail drawer (right pane / bottom sheet) --------
     Layout change only: the selection state above flows exactly as before,
     but instead of a slide-over overlay it fills a persistent pane. Any new
     selection auto-expands the drawer (mirroring the old auto-open);
     collapsing stays operator-controlled. */
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  useEffect(() => {
    if (selectedId || selectedHotspotKey || selectedArea) setDrawerCollapsed(false);
  }, [selectedId, selectedHotspotKey, selectedArea]);

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

  /* -------- timeline date filter + §3 attribute filters -------- */
  const [filterDate, setFilterDate] = useState<string | null>(null);

  /* -------- selected facility: backend narrative + grounded AI summary ------- */

  const selected = useMemo(
    () => analyses.find((a) => a.facility.id === selectedId) ?? null,
    [analyses, selectedId],
  );

  /* -------- facility-scoped replay (Track B) --------
     Activates only after a facility is selected (B1). One shared state
     drives the map markers, the replay label, the incident-timeline
     highlight and the "Today's assessment" caption together (B2). */
  const replay = useReplay(hotspots, selected?.facility ?? null);

  const filteredHotspots = useMemo(
    () =>
      hotspots
        .filter((h) =>
          // replay filter wins while a step is shown; else the scrubber's date
          replay.currentDate && selected
            ? h.acqDate === replay.currentDate &&
              haversineKm(selected.facility.lat, selected.facility.lng, h.latitude, h.longitude) <= 5
            : filterDate
              ? h.acqDate === filterDate
              : true,
        )
        .filter((h) => (filters.frpBand != null ? frpBandIndex(h.frp) === filters.frpBand : true)),
    [hotspots, filterDate, replay.currentDate, selected, filters.frpBand],
  );

  /** Analyses narrowed by state bbox + selected risk statuses. */
  const filteredAnalyses = useMemo(
    () =>
      analyses
        .filter((a) =>
          filters.state ? stateForPoint(a.facility.lat, a.facility.lng) === filters.state : true,
        )
        .filter((a) =>
          filters.riskStatuses.length > 0 ? filters.riskStatuses.includes(a.status) : true,
        ),
    [analyses, filters.state, filters.riskStatuses],
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

  /* -------- focus mode: a pinned hotspot is shown ALONE on the map.
     Everything else (other dots, facility markers) hides so the studied
     detection can be read without visual clutter; deselect restores. */
  const isolatedHotspots = useMemo(() => {
    if (!selectedHotspot) return filteredHotspots;
    return filteredHotspots.filter(
      (h) => h.latitude === selectedHotspot.latitude && h.longitude === selectedHotspot.longitude,
    );
  }, [filteredHotspots, selectedHotspot]);
  const mapAnalyses = selectedHotspot ? [] : filteredAnalyses;

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
    setSelectedArea(null); // panels are mutually exclusive
  }, []);

  const handleModeChange = useCallback(
    (m: MapMode) => {
      setMode(m);
      setSelectedId(null);
      setSelectedHotspotKey(null);
      setSelectedArea(null);
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

  /** Drawer selection: the three mutually exclusive selection kinds, else the
      live-summary empty state. Exactly one drawer state renders at a time. */
  const drawerSelection: DetailDrawerSelection = selected
    ? {
        kind: "facility",
        analysis: selected,
        narrative,
        summary,
        timelineActiveIndex: narrative ? replayActiveEventIndex(narrative.timeline, replay) : null,
        onClose: () => setSelectedId(null),
        onViewSatellite: viewInSatellite,
        onOpenFullPage: () => router.push(`/facilities/${selected.facility.id}`),
      }
    : selectedHotspot
      ? {
          kind: "hotspot",
          hotspot: selectedHotspot,
          relatedFacilities,
          onClose: () => setSelectedHotspotKey(null),
          onSelectFacility: (id: string) => {
            setSelectedHotspotKey(null);
            setSelectedId(id);
          },
          onViewSatellite: () => {
            setBasemap("satellite");
            setView({
              center: [selectedHotspot.latitude, selectedHotspot.longitude],
              zoom: 13,
              key: `sat-hotspot-${selectedHotspotKey}-${Date.now()}`,
            });
          },
        }
      : { kind: "empty" };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gradient-mesh">
      {/* two-pane layout: map (left/top) + persistent DetailDrawer
          (right pane on lg:+, bottom sheet below lg:) */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-0 flex-1">
          <MapCanvas
            view={view}
            analyses={mapAnalyses}
            selectedId={selectedId}
            onSelect={handleSelect}
            mode={mode}
            onModeChange={handleModeChange}
            layers={layers}
            onToggleLayer={toggleLayer}
            tilesLoading={firmsLoading && !analyses.length}
            basemap={basemap}
            onBasemapChange={handleBasemapChange}
            firmsHotspots={isolatedHotspots}
            selectedHotspotKey={selectedHotspotKey}
            onSelectHotspot={handleSelectHotspot}
            onViewport={handleViewport}
            onAreaClick={handleAreaClick}
            filters={filters}
            onFiltersChange={setFilters}
          >
            {/* FIRMS feed error — the only floating status chip left. The live
                detection count moved INTO the timeline/replay bar, so the two
                can never overlap or disagree with the bubbles on the map. */}
            {firmsError && (
              <div
                role="status"
                className="map-glass absolute left-4 top-14 z-[1000] rounded-lg px-3 py-2 font-mono text-[11px] text-status-watch"
              >
                FIRMS feed unavailable
              </div>
            )}

            {/* timeline scrubber + live count (hidden while replay owns the
                date filter) — the count tracks the current scrub step */}
            {!replay.currentDate && (
              <TimelineSlider
                hotspots={hotspots}
                onFilterDate={setFilterDate}
                count={filteredHotspots.length}
                className="map-glass absolute bottom-4 left-1/2 z-[1000] w-[min(560px,calc(100%-32px))] -translate-x-1/2"
              />
            )}

            {/* replay transport - appears only when a facility is selected (B1);
                also carries the live count for the current replay step */}
            <ReplayControls
              replay={replay}
              count={filteredHotspots.length}
              className="absolute bottom-4 left-1/2 z-[1000] -translate-x-1/2"
              />

            {/* backend status chips */}
            {analysesError && (
              <div
                role="status"
                className="map-glass absolute left-4 top-4 z-[1000] rounded-lg px-3 py-2 font-mono text-[11px] text-status-watch"
              >
                Backend analyses unavailable
              </div>
            )}
          </MapCanvas>
        </div>

        {/* persistent detail pane - renders exactly one state */}
        <DetailDrawer
          collapsed={drawerCollapsed}
          onToggleCollapsed={() => setDrawerCollapsed((c) => !c)}
          selection={drawerSelection}
          viewportHotspots={filteredHotspots}
          viewportAnalyses={filteredAnalyses}
          viewportBbox={debouncedViewport}
        />

        {/* area popup — compact card (NOT a full-height panel) listing the
            monitored facilities within 50 km of the clicked point; tapping one
            zooms the map there and opens its analysis drawer. */}
        {selectedArea && (
          <div className="map-glass absolute bottom-16 left-4 z-[1200] w-[320px] max-w-[calc(100%-32px)] overflow-hidden rounded-xl">
            <AreaPanel
              lat={selectedArea.lat}
              lng={selectedArea.lng}
              facilities={analyses}
              onSelectFacility={(id) => {
                const a = analyses.find((x) => x.facility.id === id);
                setSelectedArea(null);
                if (!a) return;
                handleSelect(id);
                setView({
                  center: [a.facility.lat, a.facility.lng],
                  zoom: 11,
                  key: `area-focus-${id}-${Date.now()}`,
                });
              }}
              onClose={() => setSelectedArea(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** useSearchParams requires a Suspense boundary during prerender — without
    this wrapper the /map route 500s with "Cannot access default.then on the
    server" (the dynamic-imported MapInner inside is fine once suspended). */
export default function MapPage() {
  return (
    <Suspense fallback={
      <div className="flex h-full items-center justify-center bg-gradient-mesh" />
    }>
      <MapPageContent />
    </Suspense>
  );
}
