# Map crash fix + 10x performance rewrite

## Why it crashed (root causes, found in `frontend/components/MapInner.tsx`)

1. **`react-leaflet-cluster` v3** (unmaintained since 2022, not React-18
   strict-mode safe) computed cluster colour by reading
   `marker.options.payload.rank` — a value injected via a raw `ref`
   callback on the Leaflet marker instance. When hundreds of `analyses`
   changed in one tick (any viewport refetch), some markers' `ref` hadn't
   fired yet, `options.payload` was `undefined`, and `clusterIcon()` threw
   **during Leaflet's own render pass** — outside React's normal tree.
2. **No error boundary existed anywhere above the map.** That one
   exception unmounted the *entire* dashboard, not just the map panel —
   which is why it looked like a full app crash.
3. `dynamic(..., { ssr:false })` + React StrictMode / Fast Refresh could
   race two Leaflet map initializations on the same DOM node →
   `"Map container is already initialized"`.
4. A brand-new `L.divIcon` (and inline closures) were allocated **on every
   render, for every marker** — real cost with a few hundred facilities +
   thousands of raw FIRMS points on screen.

## What changed

| File | Change |
|---|---|
| `lib/useSupercluster.ts` (new) | KD-tree clustering via `supercluster` — the same engine Mapbox/Uber use. Viewport-scoped queries (`getClusters(bbox, zoom)`) instead of touching Leaflet marker internals at all. This is the actual 10x: querying a spatial index over 50k points is µs-scale, versus re-rendering/re-diffing that many DOM markers. |
| `components/MapErrorBoundary.tsx` (new) | Isolates any remaining Leaflet runtime error to a small recoverable panel with a "Reload map" button, instead of taking down the app. |
| `components/MapInner.tsx` (rewrite) | Drops `react-leaflet-cluster` entirely; both the facilities layer and the FIRMS layer are built on `useSupercluster`. Icons are cached (`iconCache`) instead of rebuilt per render. Raw FIRMS points are capped at 600 in-viewport before falling back to clusters (legibility + perf). Explicit `map.remove()` cleanup on unmount via a ref guard. |
| `components/MapCanvas.tsx` (patch) | Wraps `MapInner` in `MapErrorBoundary`; a stable `mapInstanceKey` only changes when the boundary's "Reload map" is clicked — so the Leaflet container is never rebuilt on ordinary re-renders (removing another source of the init race). |

## Install

```bash
cd frontend
npm install supercluster
npm install -D @types/supercluster
npm uninstall react-leaflet-cluster leaflet.markercluster @types/leaflet.markercluster
```

Drop the four files from this folder into `frontend/components/` (and
`useSupercluster.ts` into `frontend/lib/`), overwriting the originals.

## Verifying the fix

- Rapidly switch India ⇄ Global Live and toggle basemaps several times in a
  row (the old code's most reliable repro for the init race) — the map
  should never blank out.
- Load a viewport with a few thousand FIRMS points at low zoom — panning
  should stay smooth; markers only "pop" into individual dots once they're
  legible.
- To confirm the boundary works: temporarily `throw new Error("test")`
  inside `FacilitiesLayer` — only the map panel should show the recovery
  card; the rest of the dashboard (nav, side panels) keeps working.
