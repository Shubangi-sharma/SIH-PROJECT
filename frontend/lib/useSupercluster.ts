"use client";

/**
 * useSupercluster
 * ----------------
 * Replaces `react-leaflet-cluster` (last published 2022, not React-18
 * strict-mode safe, and the source of most of the map's intermittent
 * crashes — see notes in MapInner.tsx).
 *
 * `supercluster` is the same clustering engine Mapbox/Uber use. It:
 *   - Builds a KD-tree index ONCE per data change (not per render).
 *   - Answers `getClusters(bbox, zoom)` in microseconds even for 50k+
 *     points, because it only walks the tree nodes inside the viewport —
 *     this is the actual "10x faster" lever, not just fewer DOM nodes.
 *   - Never touches Leaflet internals or marker `.options`, so there is
 *     no more reading `_leaflet_pos`/`payload` off half-initialized
 *     marker instances (the historical crash source).
 *
 * The hook recomputes clusters only on `moveend`/`zoomend` (already
 * debounced upstream) and when the input point set changes — never on
 * every pan frame.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Supercluster from "supercluster";
import { useMap, useMapEvents } from "react-leaflet";

export interface ClusterPoint<P> {
  properties: P;
  lat: number;
  lng: number;
}

export type ClusterFeature<P> =
  | {
      type: "cluster";
      id: number;
      lat: number;
      lng: number;
      pointCount: number;
      /** Index into the original `points` array for every leaf in this cluster. */
      leaves: P[];
    }
  | {
      type: "point";
      lat: number;
      lng: number;
      properties: P;
    };

interface Options {
  radius?: number;
  maxZoom?: number;
  /** Extra leaves to fetch per cluster for computing e.g. worst-severity colour. Caps cost. */
  maxLeavesForAggregate?: number;
}

export function useSupercluster<P>(
  points: ClusterPoint<P>[],
  { radius = 60, maxZoom = 16, maxLeavesForAggregate = 200 }: Options = {},
): ClusterFeature<P>[] {
  const map = useMap();
  const [bboxKey, setBboxKey] = useState(0);
  const boundsRef = useRef<[number, number, number, number]>([-180, -85, 180, 85]);
  const zoomRef = useRef(2);

  // Recompute the viewport query only when the map actually settles —
  // mirrors the parent's own debounced fetch pattern so clustering never
  // runs on every intermediate animation frame during a flyTo/pan.
  useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      boundsRef.current = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      zoomRef.current = map.getZoom();
      setBboxKey((k) => k + 1);
    },
    zoomend: () => {
      zoomRef.current = map.getZoom();
      setBboxKey((k) => k + 1);
    },
  });

  useEffect(() => {
    const b = map.getBounds();
    boundsRef.current = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    zoomRef.current = map.getZoom();
    setBboxKey((k) => k + 1);
    // run once on mount so the first paint is already clustered correctly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  const index = useMemo(() => {
    const sc = new Supercluster<{ idx: number }>({
      radius,
      maxZoom,
      // supercluster clones properties per feature; keep it cheap by
      // storing only the index and resolving real data via `points`.
    });
    sc.load(
      points.map((p, idx) => ({
        type: "Feature" as const,
        properties: { idx },
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      })),
    );
    return sc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, radius, maxZoom]);

  return useMemo<ClusterFeature<P>[]>(() => {
    if (points.length === 0) return [];
    const [west, south, east, north] = boundsRef.current;
    // pad the bbox slightly so clusters just off-screen don't pop in/out
    const pad = (east - west) * 0.15 || 1;
    const bbox: [number, number, number, number] = [
      west - pad,
      south - pad,
      east + pad,
      north + pad,
    ];
    const zoom = Math.round(zoomRef.current);

    let raw: ReturnType<Supercluster["getClusters"]>;
    try {
      raw = index.getClusters(bbox, zoom);
    } catch {
      // Defensive: a malformed bbox (e.g. antimeridian wrap at low zoom)
      // must never crash the render — fall back to unclustered, capped.
      raw = index.getClusters([-180, -85, 180, 85], zoom);
    }

    return raw.map((f): ClusterFeature<P> => {
      const [lng, lat] = f.geometry.coordinates;
      if (f.properties.cluster) {
        const clusterId = f.properties.cluster_id as number;
        const pointCount = f.properties.point_count as number;
        let leaves: P[] = [];
        try {
          leaves = index
            .getLeaves(clusterId, Math.min(pointCount, maxLeavesForAggregate))
            .map((leaf) => points[leaf.properties.idx].properties);
        } catch {
          leaves = [];
        }
        return { type: "cluster", id: clusterId, lat, lng, pointCount, leaves };
      }
      const idx = (f.properties as { idx: number }).idx;
      return { type: "point", lat, lng, properties: points[idx].properties };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, bboxKey, points, maxLeavesForAggregate]);
}
