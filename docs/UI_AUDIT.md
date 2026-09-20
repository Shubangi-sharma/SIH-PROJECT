# Frontend UI Audit — 2026-09-20 (initial audit on `integrate-dl-models`; re-verified on branch `frontend-ui-overhaul`)

---

## Re-verification — 2026-09-20, branch `frontend-ui-overhaul`

An independent second pass was run on top of the work below (base: `main` @
`528adcb`, `git pull --ff-only origin main` → "Already up to date"). Result:
**the tree is already clean — no further deletions or additions were needed**
for this session; findings were confirmed, not re-done.

1. **Full mechanical re-sweep of every exported name** in
   `frontend/components/*.tsx` and `frontend/lib/*.ts` (names extracted from
   `^export` lines, not filenames):

   ```bash
   for f in frontend/components/*.tsx frontend/lib/*.ts; do
     names=$(grep -oE '^export (default )?(async )?(function|const|class|interface|type) [A-Za-z0-9_]+' "$f" | awk '{print $NF}')
     for n in $names; do
       cnt=$(grep -rl --include='*.ts' --include='*.tsx' -w "$n" frontend/app frontend/components frontend/lib \
              | grep -v "^$f$" | wc -l)
       [ "$cnt" -eq 0 ] && echo "NOREF: $f :: $n (own-file occurrences: $(grep -cw "$n" "$f"))"
     done
   done
   ```

   Output: **26 names flagged, all with own-file occurrences ≥ 2** — i.e.
   every one is used inside its own file (the "Not dead — internal use only"
   list below, reproduced exactly). **Zero names have their definition as
   their only occurrence ⇒ no confirmed-dead exports remain.** The deletions
   listed in this file (commit `32f47e2`) are all still gone and nothing new
   turned up.

2. **Baseline typecheck:** `cd frontend && npx tsc --noEmit` → exit 0 before
   any change this session.

3. **OPENROUTER_API_KEY re-confirmed** (`backend/src/config/env.ts:38`):
   `OPENROUTER_API_KEY: z.string().trim().optional().default("")` — **optional**;
   `hasAiProvider()` (`env.ts:128`) guards both `summary.controller.ts:27` and
   `chatService.ts:280` with graceful degradation.

4. **Chat failure state re-confirmed as adequate (Step 5 skip stands):**
   `lib/hooks.ts:283-291` (`useChat` catch → assistant bubble "Sorry, I
   couldn't process your request. Please try again.", `provider: "fallback"`);
   `app/chat/page.tsx:229-231` renders a `"fallback"` chip on such messages;
   `AiSummaryBlock.tsx:44-49` labels template output "no AI provider
   configured, or provider unavailable". Adding a separate "AI assistant
   unavailable" empty state would duplicate three existing honest failure
   surfaces — skipped per protocol.

5. **Freshness indicator re-confirmed as covered (Step 5 skip stands):**
   `FreshnessBadge` exists and is reused by `DetailDrawer`'s empty state (fed
   with the newest real detection's `acqDate`/`acqTime`) and by `CellPanel`.

6. **Nav audit re-confirmed:** all 8 `NAV_ITEMS` hrefs resolve to real pages;
   `/compare` remains the only page without a nav entry (informational, see
   Nav audit below).

7. **Two-pane layout re-confirmed in code:** `app/map/page.tsx` renders
   `flex-col lg:flex-row` with `MapCanvas` (floating basemap pill + layer
   toggles + `RiskLegend` + status chips all intact — `MapCanvas.tsx:334-380`)
   and a sibling `DetailDrawer`; no slide-over overlay remains.

---

Two-pass dead-export audit of `frontend/components/` and `frontend/lib/`, per the
task protocol. Every exported name was extracted from the source files (not
filenames) and checked mechanically.

## Method

For every exported name `X` in file `F`:

- **Pass 1 (JSX usage):** `grep -rl "<X" frontend/app frontend/components --include="*.tsx" | grep -v "components/<F>"` — empty ⇒ no JSX usage outside the defining file.
- **Pass 2 (any reference):** `grep -rln "\bX\b" frontend/app frontend/components frontend/lib frontend/pages --include="*.ts" --include="*.tsx" | grep -v "^F$"` — empty ⇒ no reference of any kind outside the defining file.
- **Own-file check:** for every name that passed both checks as "empty", the defining file was re-grepped for `\bX\b`. If the name is referenced inside its own file (internal use, self-reference in a type, iteration by its own component), it is NOT dead — only the *export keyword* is unused. Those are listed under "Not dead — internal use only", not deleted.

A name is **confirmed dead** only when: pass 1 empty, pass 2 empty, and the
definition line is its only occurrence in its own file.

## Confirmed dead (both grep passes empty, no internal use)

### Components (files)

| Item | Evidence |
|---|---|
| `components/FacilityDetailPanel.tsx` → `FacilityDetailPanel` (default export, the file's only export) | Pass 1: `grep -rl "<FacilityDetailPanel" frontend/app frontend/components --include="*.tsx" | grep -v "components/FacilityDetailPanel.tsx"` → empty. Pass 2: `grep -rln "\bFacilityDetailPanel\b" frontend --include="*.ts" --include="*.tsx" | grep -v "components/FacilityDetailPanel.tsx"` → empty. Occurrences in own file: 1 (the definition). **Restored, not kept deleted:** tsc stayed clean after `rm`, but the map page's facility slide-over is an inline *duplicate* of this component's JSX, and Step 4 of the task explicitly requires wrapping `FacilityDetailPanel` inside the new `DetailDrawer`. Deleted → restored via `git checkout --`, and it becomes live again when the drawer imports it. The map page's inline duplicate is removed in the same change.

### Lib exports (deleted from their files, files kept)

| Item | Evidence |
|---|---|
| `lib/api.ts` → `fetchCoverage` | Pass 1 n/a (function). Pass 2: only occurrence anywhere is the definition (line 178). |
| `lib/api.ts` → `fetchHealth` | Same: only occurrence is the definition (line 183). |
| `lib/api.ts` → `CoverageDto` | Only referenced by `fetchCoverage`/`fetchHealth` (own file), which are themselves dead → transitive chain. |
| `lib/hooks.ts` → `useFacilities` | Definition is the only occurrence anywhere. (Its helper `FACILITIES_REFRESH_INTERVAL` is module-private and deleted with it.) |
| `lib/mlApi.ts` → `fetchMlHealth` | Definition is the only occurrence anywhere. |
| `lib/mlApi.ts` → `MlHealthDto` | Only referenced by `fetchMlHealth` (own file) → dead chain. |
| `lib/riskApi.ts` → `fetchRiskForBbox` | Definition is the only occurrence anywhere. |
| `lib/riskApi.ts` → `RiskBatchResponse` | Only referenced by `fetchRiskForBbox` → dead chain. |
| `lib/riskApi.ts` → `RiskEntry` | Only referenced by `RiskBatchResponse.risks` → dead chain. |
| `lib/riskApi.ts` → `HotspotsResponse` | Only referenced by `fetchHotspotClusters` → dead chain. |
| `lib/riskApi.ts` → `fetchHotspotClusters` | Definition is the only occurrence anywhere. |
| `lib/riskApi.ts` → `HOTSPOT_CLASSES` | Only referenced by the `HotspotClass` type alias in the same file. |
| `lib/riskApi.ts` → `HotspotClass` | Only occurrence is its own alias definition (nothing imports it) → dead chain. |
| `lib/compare.ts` → `COMPARE_MIN` | Definition is the only occurrence anywhere (`COMPARE_MAX` IS used internally — kept). |
| `lib/features.ts` → `FEATURE_LABEL_ALIASES` | Definition is the only occurrence anywhere. |
| `lib/firms.ts` → `formatDetectionTime` | Alias of `detectionTimestamp`; only occurrence is the alias itself. `detectionTimestamp` itself is used by `parseFirmsCsv` — kept. |
| `lib/regions.ts` → `FIRMS_WINDOW_DAYS` | Definition is the only occurrence anywhere. |
| `components/MapInner.tsx` → `INDIA_VIEW` | Definition is the only occurrence anywhere (map page hardcodes the same literals inline). |
| `components/MapInner.tsx` → `GLOBAL_VIEW` | Same. |

## Not dead — internal use only (export keyword unused; left in place)

These names failed the "dead" test only because they are used *inside their own
file*. Deleting them would break their own module. Left untouched:

`FreshnessBadge.MetaLike`, `LeftNav.NAV_ITEMS`, `MapCanvas.LAYERS`,
`MapInner.ESRI_IMAGERY_URL`, `MapInner.WIKIMEDIA_LABELS_URL`, `MapInner.BASEMAPS`,
`MapMarkerTooltips.TooltipActionHint`, `MapMarkerTooltips.TooltipStatusPill`,
`api.FacilityDto`, `api.DetectionEventDto`, `api.NarrativeDto`,
`api.PersistenceBlockDto`, `api.FireCharacteristicsBlockDto`, `api.ChatResponseDto`,
`compare.COMPARE_MAX`, `hooks.FIRMS_REFRESH_INTERVAL_MS`, `mlApi.ML_PROXY_BASE`,
`mlApi.ContributingFeatureDto`, `mlApi.MlApiError`, `regions.RegionId`,
`regions.GLOBAL_CHUNKS`, `replay.buildReplaySequence`, `riskApi.ResponseMeta`,
`riskApi.RiskHorizonEntry`, `types.CommandFacility`, `useSupercluster.ClusterFeature`.

## Nav audit (informational)

Real pages (`find frontend/app -name "page.tsx"`): `/` (dashboard), `/map`,
`/analytics`, `/predict`, `/about`, `/facilities`, `/facilities/[id]`, `/chat`,
`/settings`, `/compare`.

- `LeftNav.NAV_ITEMS` (8 entries): `/`, `/map`, `/analytics`, `/predict`,
  `/about`, `/facilities`, `/chat`, `/settings` — **every href has a real page.**
- **Page with no nav entry: `/compare`** — the Compare page exists
  (`frontend/app/compare/page.tsx`, uses `useCompareIds`, `useAnalyses`,
  `useFirms`, `haversineKm`, `INDIA_BBOX`) but is not in `NAV_ITEMS` and has no
  inbound `<Link href="/compare">` anywhere. Left in place (informational only;
  adding nav is a product decision, not a trivial typo).
- No nav item points nowhere.

## AI key finding (OPENROUTER_API_KEY)

`backend/src/config/env.ts`:

```ts
OPENROUTER_API_KEY: z.string().trim().optional().default(""),
```

- **OPTIONAL.** Only `FIRMS_MAP_KEY` is required. `.env.example` ships
  `OPENROUTER_API_KEY=` (empty). The module exports `hasAiProvider()` =
  `Boolean(env.OPENROUTER_API_KEY)`, and the env-file comment states keys are
  "OPTIONAL by design: without a key the service degrades gracefully to the
  deterministic templated summary (§5) instead of failing the endpoint."
- Frontend chat failure path already exists: `useChat`'s `catch` injects an
  assistant bubble "Sorry, I couldn't process your request. Please try again."
  (`lib/hooks.ts`), and `AiSummaryBlock` labels `provider === "template"` /
  fallback as "no AI provider configured, or provider unavailable".

## Step 5 gap checks

- **Data-freshness indicator:** `FreshnessBadge` already exists and is used by
  `CellPanel`. The map page's drawer has no freshness display, and `Detection` /
  `FirmsHotspot` carry **no fetch-time timestamp** — only per-detection
  `acqDate`/`acqTime`/`ageDays`. So the drawer's empty state reuses
  `FreshnessBadge` fed with `{ data_timestamp: newest detection's real
  acquisition timestamp }` — no new timestamp field invented.
- **AI-unavailable empty state:** skipped — a reasonable failure state already
  exists (see AI key finding above). Adding another would be a duplicate.

## Deletion log (updated as deletions happen)

(each deletion followed by `cd frontend && npx tsc --noEmit`; baseline run before any change was **clean, exit 0**)

1. `rm components/FacilityDetailPanel.tsx` → tsc clean → **restored via `git checkout --`** (see note in table above: Step 4 revives it).
2. `api.ts`: remove `fetchCoverage` → tsc clean
3. `api.ts`: remove `fetchHealth` → tsc clean
4. `api.ts`: remove `CoverageDto` (chain) → tsc clean
5. `hooks.ts`: remove `useFacilities` + module-private `FACILITIES_REFRESH_INTERVAL` → tsc clean
6. `hooks.ts`: drop now-unused `fetchFacilities` import; fresh grep shows `fetchFacilities` has exactly one reference left (its own definition) → removed from `api.ts` (cascade) → tsc clean
7. `mlApi.ts`: remove `fetchMlHealth` → tsc clean
8. `mlApi.ts`: remove `MlHealthDto` (chain) → tsc clean
9. `riskApi.ts`: remove `fetchRiskForBbox` → tsc clean
10. `riskApi.ts`: remove `RiskBatchResponse` (chain) → tsc clean
11. `riskApi.ts`: remove `RiskEntry` (chain) → tsc clean
12. `riskApi.ts`: remove `fetchHotspotClusters` → tsc clean; module-private `bboxParams` left definition-only → removed (cascade) → tsc clean
13. `riskApi.ts`: remove `HotspotsResponse` (chain) → tsc clean
14. `riskApi.ts`: remove `HOTSPOT_CLASSES` + `HotspotClass` (chain) → tsc clean
15. `compare.ts`: remove `COMPARE_MIN` → tsc clean
16. `features.ts`: remove `FEATURE_LABEL_ALIASES` → tsc clean
17. `firms.ts`: remove `formatDetectionTime` alias → tsc clean
18. `regions.ts`: remove `FIRMS_WINDOW_DAYS` → tsc clean
19. `MapInner.tsx`: remove `INDIA_VIEW` + `GLOBAL_VIEW` → tsc clean

Nothing was kept deleted against evidence; nothing needed an emergency restore.
`ResponseMeta` and `RiskHorizonEntry` were kept even though two of their
consumers died, because `CellDetailResponse` (live, used by `CellPanel`)
references both. `FacilityDto` kept (used by `FacilityAnalysisResponseDto`).
`toFacility` kept in `hooks.ts` (used by `toAnalysis` → `useAnalyses`).

## COULD NOT CONFIRM, LEFT IN PLACE

- (none — every export was resolved to either "used", "internal-use only", or "confirmed dead")

## Step 4 — two-pane map layout (DetailDrawer)

- New `frontend/components/DetailDrawer.tsx`: persistent detail pane — right
  pane (~380px) on `lg:`+ (the breakpoint the app's page grids already use for
  major layout switches), bottom sheet below it. Collapsible via a toggle
  button (ChevronUp/ChevronsLeft when collapsed, ChevronDown/ChevronsRight when
  expanded — responsive icons, no JS breakpoint detection). Any new selection
  auto-expands the drawer (mirrors the old slide-over's auto-open); collapsing
  is operator-controlled only.
- Exactly one state renders at a time, driven by the page's *existing*
  mutually-exclusive selection state (untouched):
  1. **empty** → live viewport summary (hotspot count, FRP-band breakdown via
     the same `frpBandIndex`/`FRP_BANDS` the markers/legend use, facility
     risk-status breakdown via `STATUS_META`) + `FreshnessBadge` fed with the
     newest REAL detection's acquisition timestamp (`acqDate`/`acqTime`) — no
     new timestamp field invented (the Detection type has no fetch-time field).
  2. **facility** → wraps the existing `FacilityDetailPanel` (imported, not
     copied). Two additive optional changes were made to that component so
     wrapping preserves prior behavior: `timelineActiveIndex?` (forwards to
     `IncidentTimeline` so replay highlighting keeps working) and
     `provider={summary?.provider}` on its AiSummaryBlock.
  3. **hotspot** → `FirmsHotspotDetail` (already formats FRP / brightness /
     confidence / coordinates / acquisition from real fields), satellite
     fly-to, and the corroboration list. No hotspot-type or risk-horizon UI —
     those fields do not exist for individual detections (see Needs backend
     work).
  3b. **cell** → H3-cell clicks now render the existing `CellPanel` inside
     the pane instead of as an overlay, so the map has one detail surface.
- `map/page.tsx`: the old absolute-positioned slide-over `<aside>` (an inline
  DUPLICATE of FacilityDetailPanel's content) and the CellPanel overlay were
  removed; the page is now `flex-col lg:flex-row` around the unchanged
  `MapCanvas` (all floating basemap/layer/legend/status controls untouched).
  TimelineSlider's reserved `right-[420px]` (slide-over clearance) became
  `right-4` since the drawer is now a sibling pane, not an overlay.
- Removed from the page as now-unused: local `MonoStat`/`DetailSkeleton`
  helpers (only the duplicate used them) and the `relatedDetections` memo
  (only the duplicate facility card consumed it).

### Reachability trace (verified in code, MapInner.tsx line numbers from HEAD)

- **empty** — initial render: all three selection states start `null` →
  `{kind:"empty"}`. Return paths: each panel's close button
  (`setSelectedId(null)` / `setSelectedHotspotKey(null)` / `setSelectedCell(null)`),
  hotspot toggle-click (`MapInner.tsx:360` passes `null` when already selected),
  and mode change (resets all three).
- **facility** — facility marker click → `onSelect(facility.id)`
  (`MapInner.tsx:282/290/294`) → `handleSelect` → `selected` memo non-null →
  `{kind:"facility"}` → DetailDrawer renders `FacilityDetailPanel`; the
  narrative/summary effect fetches on `selectedId` change.
- **hotspot** — hotspot marker click → `onSelectHotspot(key)`
  (`MapInner.tsx:360/367/371`) → `selectedHotspot` memo resolves the pinned
  detection → `{kind:"hotspot"}`.
- **cell** — map background click → `onCellClick(h3.latLngToCell(..., 7))`
  (`MapInner.tsx:129`) → `{kind:"cell"}`.

## Pre-existing build warning (out of scope, untouched)

`next build` warns: `Attempted import error: 'h3-js' does not contain a default
export (imported as 'h3Js')` — caused by `import h3Js from "h3-js"` at
`MapInner.tsx:58`, present at HEAD before this change. Runtime is already
defended: line 131 resolves `(h3Js as { default?: typeof h3Js }).default ??
h3Js`. Left as-is (build exits 0); fixing the import shape is a separate task.

## Needs backend work

- **Hotspot type / risk-horizon display for pinned FIRMS hotspots:** the
  `/api/v1` contract (`lib/riskApi.ts`) carries hotspot *class* and 1/3/7-day
  risk horizons only for H3-cell clusters (`HotspotClusterDto.class`,
  `RiskHorizonEntry`), keyed by cell — not per individual FIRMS detection.
  A single pinned hotspot has no type/horizon fields anywhere in the current
  API responses, so the DetailDrawer's hotspot state shows only real sensor
  fields (FRP, brightness, confidence, coordinates, acquisition time, source).
  To display hotspot-type / risk-horizon for an individual detection, the
  backend must expose per-detection classification or a detection→cell join;
  noted here instead of inventing placeholder UI.
- **/compare discoverability:** the Compare page has no nav entry. Adding it to
  `NAV_ITEMS` is frontend-only and trivial, but it is a product decision and was
  left untouched (see Nav audit).
