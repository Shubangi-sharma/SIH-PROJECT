"""Risk score derivation + top contributing features.

Risk score (0–100), per spec:

    risk = 100 × (
        w_industrial × P(Industrial)
      + w_mining     × P(Mining_Extraction)
      + w_other      × P(Other_Persistent_Thermal_Source)
      + w_agri       × P(Agricultural_Vegetation)
    )

Weights are threat-severity ordered. This is a deterministic derivation from
the model's probability distribution — no hand-tuned thresholds on top.
"""

from __future__ import annotations

from typing import Final

from app.feature_schema import TRAINING_MEDIANS
from app.ml.model_loader import get_model

RISK_WEIGHTS: Final[dict[str, float]] = {
    "Industrial": 1.0,
    "Mining_Extraction": 0.85,
    "Other_Persistent_Thermal_Source": 0.6,
    "Agricultural_Vegetation": 0.3,
}

# Land-cover ratio features bound to [0, 1]; used for display normalization.
RATIO_FEATURES: Final[frozenset[str]] = frozenset(
    n for n in TRAINING_MEDIANS if n.startswith("lc_")
)


def compute_risk_score(probabilities: dict[str, float]) -> float:
    """Weighted probability sum → 0–100 risk score (rounded to 1 dp)."""
    risk = 100.0 * sum(
        RISK_WEIGHTS.get(cls, 0.0) * float(p) for cls, p in probabilities.items()
    )
    return round(risk, 1)


def key_contributors(
    features: dict[str, float | str],
    top_k: int = 5,
) -> list[dict]:
    """Top-k features driving this prediction.

    Heuristic (documented, deterministic): rank features by
        deviation × importance
    where deviation for numerics is the symmetric log-ratio vs the training
    median, |log((|v|+ε)/(|m|+ε))| — scale-free, so a huge deviation in a
    near-zero-importance feature cannot drown a moderate deviation in a
    dominant one — and importance is the GBM's feature_importances_.
    Purely explanatory — never fed back into the model.
    """
    import math

    eps = 1e-9
    max_deviation = 10.0  # cap: e^10 ≈ 22000× off-median is already maximal
    model = get_model()
    importances = model.importances or {}

    scored: list[tuple[float, str, object]] = []
    for name, value in features.items():
        imp = importances.get(name, 0.0)
        if imp <= 0.0:
            continue
        if isinstance(value, str):
            # Categorical: nominal contribution via its OHE importance slice.
            deviation = 1.0
            score = imp * deviation
        else:
            median = TRAINING_MEDIANS.get(name)
            if median is None:
                continue
            if name in RATIO_FEATURES:
                deviation = min(abs(float(value) - median), max_deviation)
            else:
                deviation = min(
                    abs(math.log((abs(float(value)) + eps) / (abs(median) + eps))),
                    max_deviation,
                )
            score = imp * deviation
        scored.append((score, name, value))

    scored.sort(key=lambda t: (-t[0], t[1]))
    return [
        {"feature": name, "value": value, "importance": round(importances[name], 6)}
        for _, name, value in scored[:top_k]
    ]
