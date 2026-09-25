# Known Limitations & Possible Improvements

## Known Limitations

- **Classification labels are contextual, not causal:** The hotspot classifier's labels (`Agricultural`, `Forest_Vegetation`, `Industrial`, `Infrastructure_Energy`, `Mining`) are inferred from OSM proximity, land cover, and fire history around a cluster. They are not independent ground-truth ignition causes.
- **The Unknown / Needs Review path is mandatory:** When the classifier's confidence is `< 0.40`, or feature engineering falls back on missing sources, the cluster is flagged for review. The classifier never forces an ambiguous detection into a class.
- **Risk levels are decision thresholds, not probabilities:** The 1-day, 3-day, and 7-day risk GRU models operate on fixed thresholds (0.65, 0.40, and 0.35). They map strictly to risk signals, not calibrated percentage chances of fire.
- **The 7-day horizon is a weak, long-range signal:** The 7-day model has weak validation ranking metrics and reflects a large prevalence shift from its training data.
- **Limited spatial coverage in training:** Only 563 unique H3 cells were used in training the risk model. Nationwide spatial generalization has not been proven.
- **Weather inputs have documented gaps:** Weather is forward-filled at most 7 days and never backward-filled. Missing points fall back to degraded priors or are excluded.
- **Feature engineering approximations:** Unique H3 cells are approximated by counting distinct rounded detection locations in a radius. 

## Possible Improvements

- **Per-detection Classification API:** Currently, the API (per `api-contract-v2.md`) only exposes hotspot classifications and risk-horizons for H3-cell clusters. The backend must expose a per-detection classification or a detection-to-cell join so the frontend detail drawer can display individual FIRMS hotspot types.
- **Model Baseline Evaluation:** The old GBM classifier has no verified evaluation numbers on a held-out set. A proper side-by-side evaluation dataset needs to be established and run on the GBM to fairly compare it with the new MLP classifier.
- **Compare Page Navigation:** The `/compare` route is fully functional but currently has no inbound link in the primary navigation items.
- **Persistent Backend FIRMS Cache:** The Node.js backend maintains the rolling 10-day FIRMS history entirely in process memory. Swapping this out for a small local key-value store (like Redis or SQLite) behind the same route logic would allow warm 10-day windows to survive deployments and restarts.
