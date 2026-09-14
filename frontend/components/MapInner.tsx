"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import {
  FacilityAnalysis,
  RiskStatus,
  statusColorHex,
} from "@/lib/types";
import { FirmsHotspot, frpColor, frpRadius } from "@/lib/firms";
import {
  FacilityTooltipContent,
  FirmsTooltipContent,
} from "./MapMarkerTooltips";
import clsx from "clsx";

/**
 * Basemap options (all keyless):
 *  - dark:      Wikimedia osm-intl tiles darkened via CSS invert filter
 *              (default). English place labels in every country.
 *  - streets:   plain Wikimedia osm-intl tiles, unfiltered. English labels.
 *  - satellite: Esri World Imagery, true-colour, never filtered, with a
 *              blended Wikimedia osm-intl overlay for English place names.
 * Satellite imagery renders unfiltered on purpose — real imagery supports
 * the "FIRMS detects → satellite validates visually" workflow.
 *
 * Why Wikimedia and not tile.openstreetmap.org: the OSM standard layer
 * renders each country's labels in its LOCAL language (Chinese in China,
 * Japanese in Japan, …). Wikimedia's osm-intl style labels in English
 * (name:en with fallbacks) worldwide, is keyless, and low-zoom styling is
 * muted so the CSS-inverted dark variant stays calm. Required attribution
 * below per https://maps.wikimedia.org & OSM policies.
 */
export type Basemap = "dark" | "streets" | "satellite";

export const WIKIMEDIA_URL =
  "https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}{r}.png?lang=en";
export const ESRI_IMAGERY_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
/**
 * English place-name overlay: Wikimedia osm-intl tiles drawn above satellite
 * imagery, blended to show only labels/boundaries (see .pyro-tile-labels),
 * so satellite photography stays visually untouched underneath. Keyless,
 * English labels worldwide.
 */
export const WIKIMEDIA_LABELS_URL = WIKIMEDIA_URL;

const WIKIMEDIA_ATTRIBUTION =
  'Map: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &middot; <a href="https://maps.wikimedia.org">Wikimedia</a>';

export const BASEMAPS: {
  id: Basemap;
  label: string;
  url: string;
  attribution: string;
  className?: string;
}[] = [
  {
    id: "dark",
    label: "Dark",
    url: WIKIMEDIA_URL,
    attribution: WIKIMEDIA_ATTRIBUTION,
    className: "map-tiles-dark",
  },
  {
    id: "streets",
    label: "Streets",
    url: WIKIMEDIA_URL,
    attribution: WIKIMEDIA_ATTRIBUTION,
  },
  {
    id: "satellite",
    label: "Satellite",
    url: ESRI_IMAGERY_URL,
    attribution:
      'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  },
];

export const INDIA_VIEW = { center: [22.0, 79.0] as [number, number], zoom: 5 };
export const GLOBAL_VIEW = { center: [20.0, 0.0] as [number, number], zoom: 2 };

export interface MapView {
  center: [number, number];
  zoom: number;
  /** change key to trigger a flyTo */
  key: string;
}

/** Fly the map whenever the view key changes (mode switch / fly-to). */
function ViewportAnimator({ view }: { view: MapView }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(view.center, view.zoom, { duration: 1.1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.key]);
  return null;
}

/**
 * Report viewport changes upward. The parent debounces (≥500 ms) before
 * re-fetching FIRMS/Overpass for the new box — the map itself never
 * triggers a fetch per pan/zoom event (§5).
 */
function ViewportReporter({ onViewport }: { onViewport: (b: [number, number, number, number]) => void }) {
  const map = useMap();
  useEffect(() => {
    let raf = 0;
    const report = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const b = map.getBounds();
        onViewport([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      });
    };
    report();
    map.on("moveend zoomend", report);
    return () => {
      map.off("moveend zoomend", report);
      cancelAnimationFrame(raf);
    };
  }, [map, onViewport]);
  return null;
}

/** Tile layer for the active basemap + load reporter. */
function BaseLayer({
  basemap,
  onLoading,
  onLoaded,
}: {
  basemap: Basemap;
  onLoading: () => void;
  onLoaded: () => void;
}) {
  const bm = BASEMAPS.find((b) => b.id === basemap) ?? BASEMAPS[0];
  return (
    <>
      <TileLayer
        key={bm.id}
        attribution={bm.attribution}
        url={bm.url}
        className={bm.className}
        eventHandlers={{
          loading: onLoading,
          load: onLoaded,
        }}
      />
      {/* English place-name overlay keeps satellite imagery navigable */}
      {basemap === "satellite" && (
        <TileLayer
          key="sat-labels"
          url={WIKIMEDIA_LABELS_URL}
          className="pyro-tile-labels"
          attribution={WIKIMEDIA_ATTRIBUTION}
        />
      )}
    </>
  );
}

/** Leaflet marker shape as react-leaflet-cluster hands it to iconCreateFunction. */
interface ClusterChildMarker {
  options?: {
    payload?: {
      rank?: number;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
}

interface ClusterObject {
  getAllChildMarkers: () => ClusterChildMarker[];
}

/** Cluster icon: colour = highest-severity member (§5 rule). */
function clusterIcon(cluster: ClusterObject) {
  const children = cluster.getAllChildMarkers();
  let worst = 0; // index into status order; 0 = normal
  for (const m of children) {
    const rank = m.options?.payload?.rank ?? 0;
    if (rank > worst) worst = rank;
  }
  const hex = statusColorHex(STATUS_ORDER_RISK[worst] ?? "normal");
  const size = Math.min(24 + children.length / 8, 44);
  return L.divIcon({
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:9999px;
      display:flex;align-items:center;justify-content:center;
      background:${hex}2E;border:1.5px solid ${hex};
      color:${hex};font:600 11px var(--font-inter),sans-serif;
      box-shadow:0 0 10px ${hex}55;
    ">${children.length}</div>`,
    className: "pyro-cluster",
    iconSize: L.point(size, size),
  });
}

const STATUS_ORDER_RISK: RiskStatus[] = ["normal", "watch", "suspicious", "critical", "unknown"];

/** Severity rank — higher = worse; drives the cluster colour (§5 rule). */
const STATUS_RANK: Record<RiskStatus, number> = {
  normal: 0,
  watch: 1,
  suspicious: 2,
  critical: 3,
  unknown: 0,
};

/**
 * A single clustered facility marker.
 *
 * Hover = rich, readable "study card" (status pill, health score, detection
 * stats). Click = select + open the detail slide-over. Clicking the open
 * tooltip itself ALSO opens the detail — the card is click-worthy, not a
 * passive label.
 */
function ClusterFacilityMarker({
  analysis,
  selected,
  onSelect,
}: {
  analysis: FacilityAnalysis;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { facility, status } = analysis;
  const hex = statusColorHex(status);
  const icon = L.divIcon({
    html: `<div style="
      width:16px;height:16px;border-radius:9999px;
      background:${hex};border:1.5px solid #05070A;
      box-shadow:0 0 0 ${selected ? 3 : 0}px rgba(59,130,246,0.5);
    "></div>`,
    className: clsx("pyro-cluster-marker", status === "critical" && "pyro-marker-critical"),
    iconSize: L.point(16, 16),
  });

  return (
    <Marker
      position={[facility.lat, facility.lng]}
      icon={icon}
      // severity rank rides on the leaflet marker options (via ref callback)
      // so the cluster icon can read each child's status without extra lookups
      ref={(m) => {
        if (m) (m.options as { payload?: unknown }).payload = { rank: STATUS_RANK[status] };
      }}
      eventHandlers={{ click: () => onSelect(facility.id) }}
      keyboard={false}
    >
      <Tooltip
        direction="top"
        offset={[0, -10]}
        opacity={1}
        className="pyro-tooltip-clickable"
        interactive
      >
        <div
          role="button"
          tabIndex={0}
          aria-label={`Open analysis for ${facility.name}`}
          onClick={() => onSelect(facility.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(facility.id);
            }
          }}
          style={{ cursor: "pointer" }}
        >
          <FacilityTooltipContent analysis={analysis} />
        </div>
      </Tooltip>
    </Marker>
  );
}

/**
 * Clustered facility markers. Clustering (react-leaflet-cluster) keeps the
 * map smooth with hundreds of real OSM sites + FIRMS points at low zoom (§5);
 * each cluster shows the colour of its highest-severity member.
 */
function ClusteredFacilities({
  analyses,
  selectedId,
  onSelect,
}: {
  analyses: FacilityAnalysis[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const markers = React.useMemo(
    () =>
      analyses.map((a) => (
        <ClusterFacilityMarker
          key={a.facility.id}
          analysis={a}
          selected={a.facility.id === selectedId}
          onSelect={onSelect}
        />
      )),
    [analyses, selectedId, onSelect],
  );

  return (
    <MarkerClusterGroup
      chunkedLoading
      maxClusterRadius={55}
      showCoverageOnHover={false}
      spiderfyOnMaxZoom
      iconCreateFunction={clusterIcon as never}
    >
      {markers}
    </MarkerClusterGroup>
  );
}

/**
 * Raw FIRMS sensor detections — FRP gradient, visually distinct from risk colours.
 * Hover = readable "study card" (FRP, brightness, confidence, age, source,
 * coordinates). Click = select, so related facility patterns can be examined;
 * clicking the open card itself re-fires the same selection.
 */
function FirmsMarkers({
  hotspots,
  selectedHotspotKey,
  onSelectHotspot,
}: {
  hotspots: FirmsHotspot[];
  selectedHotspotKey: string | null;
  onSelectHotspot: (key: string | null) => void;
}) {
  return (
    <>
      {hotspots.map((h, i) => {
        const hex = frpColor(h.frp);
        const key = `${h.latitude},${h.longitude},${i}`;
        const selected = selectedHotspotKey === key;
        return (
          <CircleMarker
            key={key}
            center={[h.latitude, h.longitude]}
            radius={selected ? Math.min(frpRadius(h.frp) + 3, 13) : frpRadius(h.frp)}
            pathOptions={{
              color: selected ? "#E6EBF2" : hex,
              weight: selected ? 2 : 1,
              fillColor: hex,
              fillOpacity: 0.75,
            }}
            eventHandlers={{
              // click toggles selection so a hotspot can be "pinned" while
              // studying nearby facilities without losing it
              click: () => onSelectHotspot(selected ? null : key),
            }}
          >
            <Tooltip
              direction="top"
              offset={[0, -6]}
              opacity={1}
              className="pyro-tooltip-clickable"
              interactive
            >
              <div
                role="button"
                tabIndex={0}
                aria-label="Select thermal hotspot"
                onClick={() => onSelectHotspot(selected ? null : key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectHotspot(selected ? null : key);
                  }
                }}
                style={{ cursor: "pointer" }}
              >
                <FirmsTooltipContent
                  latitude={h.latitude}
                  longitude={h.longitude}
                  frp={h.frp}
                  brightness={h.brightness}
                  confidence={h.confidence}
                  satellite={h.satellite}
                  instrument={h.instrument}
                  acqDate={h.acqDate}
                  acqTime={h.acqTime}
                  daynight={h.daynight}
                  ageDays={h.ageDays}
                />
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

export default function MapInner({
  view,
  analyses,
  selectedId,
  onSelect,
  basemap = "dark",
  firmsHotspots,
  showFirms,
  selectedHotspotKey = null,
  onSelectHotspot,
  onTilesLoading,
  onTilesLoaded,
  onViewport,
}: {
  view: MapView;
  /** classified facilities (computed from real FIRMS data) */
  analyses: FacilityAnalysis[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  basemap?: Basemap;
  /** live FIRMS detections */
  firmsHotspots: FirmsHotspot[];
  showFirms: boolean;
  /** selected ("pinned") FIRMS hotspot, keyed like the marker keys */
  selectedHotspotKey?: string | null;
  onSelectHotspot: (key: string | null) => void;
  onTilesLoading: () => void;
  onTilesLoaded: () => void;
  /** viewport bbox reporting (parent debounces before refetching) */
  onViewport: (b: [number, number, number, number]) => void;
}) {
  return (
    <MapContainer
      center={view.center}
      zoom={view.zoom}
      scrollWheelZoom
      className="h-full w-full"
      attributionControl
      zoomControl={false}
      preferCanvas
    >
      <BaseLayer
        basemap={basemap}
        onLoading={onTilesLoading}
        onLoaded={onTilesLoaded}
      />
      <ViewportAnimator view={view} />
      <ViewportReporter onViewport={onViewport} />
      {showFirms && firmsHotspots.length > 0 && (
        <FirmsMarkers
          hotspots={firmsHotspots}
          selectedHotspotKey={selectedHotspotKey}
          onSelectHotspot={onSelectHotspot}
        />
      )}
      <ClusteredFacilities
        analyses={analyses}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    </MapContainer>
  );
}
