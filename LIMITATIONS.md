# PyroSense — Known Limitations (consolidated, verbatim from the handoff docs)

> Judges ask better questions than users do. This list is load-bearing for the
> demo: state these precisely, and the numbers that remain become credible.
> Every item below is lifted from the Phase 1 model cards and the handoff
> PDFs' documented caveats — nothing new was invented here.

## 1. Classification labels are contextual, not causal

The hotspot classifier's five classes (`Agricultural`, `Forest_Vegetation`,
`Industrial`, `Infrastructure_Energy`, `Mining`) are **evidence-derived
contextual labels** — inferred from OSM proximity, land cover, and fire
history around a cluster. They are **not** independent ground-truth ignition
causes. The UI surfaces this as "context-derived classification — not an
independent ignition cause" on every classified hotspot, and the API attaches
the same note (`contextual_note` field).

## 2. The Unknown / Needs Review path is mandatory

When the classifier's confidence is low (`< 0.40`) or feature engineering had
to fall back on missing sources, the cluster is flagged `needs_review=true`
and rendered **"Needs Review"** in the UI. The classifier is never forced into
one of the five classes when evidence is ambiguous. (This threshold is an
engineering decision, documented here so it can be audited.)

## 3. Risk levels are decision thresholds, not probabilities

Each GRU horizon score crosses a fixed threshold (1-day 0.65, 3-day 0.40,
7-day 0.35) to become a HIGH/LOW signal; overall is ≥2 HIGH → HIGH,
exactly 1 → MODERATE, 0 → LOW. These thresholds were chosen at handoff as
engineering decision points. **They are not calibrated probabilities** — the
legend says "risk signal" wherever scores are shown, never "% chance of fire".

## 4. The 7-day horizon is a weak, long-range signal

The 7-day model's validation ranking metrics were weak, and 3-day/7-day test
metrics reflect a large prevalence shift versus validation. Treat 3-day and
especially 7-day outputs as long-range signals — the UI labels them as such,
and demo commentary must not present them as equally reliable as the 1-day
output.

## 5. Limited spatial coverage in training

Only a limited number of unique H3 cells (documented in the risk model card:
563-cell spatial coverage limit) are represented in training. Nationwide
spatial generalization has **not** been proven; the map's "insufficient
history" state exists partly for this reason and is shown honestly rather
than hiding cells.

## 6. Weather inputs have documented gaps

- Live `/predict` + `/observations` now derive relative humidity (mean/min)
  and solar radiation (mean/max ssrd) from Open-Meteo's HOURLY series — real
  derivations, no longer training-prior fallbacks. The H3 feature-store
  pipeline still approximates: RH from hourly aggregates, ssrd derived from
  `shortwave_radiation_sum` ÷ 86400 (daily mean as a conservative max
  proxy). Both derivations are marked in `fill_applied` provenance on every
  feature-store row.
- Weather is **forward-filled at most 7 days, never backward-filled** (the
  V3→V4 lesson). Beyond that, the cell-day is excluded — a missing value is
  never guessed.
- The live weather window ends at the ERA5 publication tail (~5 days lag),
  discovered automatically from the archive's 400 error and clamped —
  fresh points no longer silently fall back to zero priors.
- The OSM-derived land-cover source has no snow/ice class — that ratio is
  always the 0.0 training prior (a documented approximation, also shown on
  the facility page).

## 7. Feature engineering approximations (live vs. training parity)

- `unique_h3_cells` for the classifier is approximated by counting distinct
  rounded detection locations in the radius (documented in
  `features/engineer.py`).
- Proximity flags (`near_*`) derive from the same Overpass distances as the
  `distance_to_*_km` features (thresholds 500 m/1 km/2 km/5 km); when a
  category's distance is unknown the flag stays at its 0.0 training prior.
- Daily wind mean falls back to the mean of daily maxima when the archive's
  mean is unavailable; temperature `max_/min_` are window extremes (max of
  daily maxima, min of daily minima); `mean_precipitation` derives from the
  daily sum ÷ 24.

## 8. Operational facts the demo should state

- FIRMS NRT data can lag; every response carries `data_timestamp` and the UI
  shows "as of" times instead of implying live certainty.
- The Node side's facility matching/GenAI remains on its own SQLite store;
  only ML data lives in Postgres/PostGIS.
- Risk predictions exist only for cells with 30 consecutive days of feature
  history; everything else reports `insufficient_history` on the map.
