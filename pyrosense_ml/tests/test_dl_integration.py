"""DL integration tests — Phase 2A models + decision-(b) routing.

Shape/plumbing tests only: synthetic np.random inputs with the correct shapes,
no real data, no accuracy claims (docs/CLASSIFIER_DECISION.md explains why no
accuracy claims are possible in this repo yet).
"""

from __future__ import annotations

import numpy as np
import pytest

from app.feature_schema import (
    CLASSIFIER_CLASSES,
    CLASSIFIER_CLASSES_OLD,
    CLASSIFIER_FEATURES,
    CLASSIFIER_FEATURES_OLD,
    CLASSIFIER_USED_NEW,
    CLASSIFIER_USED_OLD,
    RISK_FEATURES,
    SchemaViolation,
)
from app.ml.inference import predict
from app.ml.model_loader import get_model, load_model
from app.ml import risk_score as rs


@pytest.fixture(scope="module", autouse=True)
def _models():
    load_model()


@pytest.fixture
def random_new_features() -> dict:
    """Known-valid synthetic 43-feature payload (shape/plumbing, not real data)."""
    feats = {name: float(np.random.uniform(0, 100)) for name in CLASSIFIER_FEATURES}
    for name in (
        "near_industrial_500m",
        "near_power_1km",
        "near_mining_5km",
        "near_fuel_2km",
        "near_transport_1km",
        "near_agriculture_1km",
    ):
        feats[name] = float(np.random.randint(0, 2))
    return feats


@pytest.fixture
def random_old_features() -> dict:
    """Known-valid synthetic 36-feature payload for the legacy GBM."""
    feats = {name: float(np.random.uniform(0, 100)) for name in CLASSIFIER_FEATURES_OLD}
    feats["dominant_land_cover"] = np.random.choice(
        ["bare", "built", "crops", "shrub_and_scrub", "trees", "water"]
    )
    return feats


# ── Loaded-model shape checks ────────────────────────────────────────────────


def test_all_models_loaded_with_expected_shapes():
    m = get_model()
    assert m.classifier.input_shape[-1] == len(CLASSIFIER_FEATURES) == 43
    assert m.gbm_pipeline is not None, "decision (b) requires the legacy GBM at startup"
    assert [str(c) for c in m.label_encoder.classes_] == list(CLASSIFIER_CLASSES)
    assert [str(c) for c in m.gbm_pipeline.classes_] == list(CLASSIFIER_CLASSES_OLD)
    for horizon, model in m.risk_models.items():
        assert tuple(model.input_shape) == (None, 30, len(RISK_FEATURES))


def test_new_mlp_produces_expected_output_shape(random_new_features):
    out = rs.classify(random_new_features, model_version="new")
    assert out["classifier_model_used"] == CLASSIFIER_USED_NEW
    assert out["predicted_class"] in CLASSIFIER_CLASSES
    assert set(out["probabilities"]) == set(CLASSIFIER_CLASSES)
    assert abs(sum(out["probabilities"].values()) - 1.0) < 1e-3
    assert 0.0 <= out["confidence"] <= 1.0


def test_old_gbm_produces_expected_output_shape(random_old_features):
    out = rs.classify(random_old_features, model_version="old")
    assert out["classifier_model_used"] == CLASSIFIER_USED_OLD
    assert out["predicted_class"] in CLASSIFIER_CLASSES_OLD
    assert set(out["probabilities"]) == set(CLASSIFIER_CLASSES_OLD)
    assert abs(sum(out["probabilities"].values()) - 1.0) < 1e-3


def test_risk_models_produce_expected_output_shape():
    seq = np.random.rand(30, len(RISK_FEATURES)).astype("float32")
    result = rs.score_risk(seq)
    assert set(result) == {"1day", "3day", "7day", "overall"}
    for h in ("1day", "3day", "7day"):
        assert 0.0 <= result[h]["score"] <= 1.0
        assert result[h]["level"] in ("HIGH", "LOW")
    assert result["overall"] in ("HIGH", "MODERATE", "LOW")


# ── Schema-violation paths (never raw numpy/keras exceptions) ───────────────


def test_classifier_rejects_wrong_feature_set(random_new_features):
    # Missing one feature and one unexpected feature — both must surface as
    # SchemaViolation, not a raw numpy/keras shape error.
    broken = dict(random_new_features)
    broken.pop("mean_frp")
    with pytest.raises(SchemaViolation, match="missing"):
        rs.classify(broken, model_version="new")
    with pytest.raises(SchemaViolation, match="unexpected"):
        rs.classify({**random_new_features, "mystery": 1.0}, model_version="new")


def test_classifier_rejects_non_numeric_value(random_new_features):
    with pytest.raises(SchemaViolation, match="non-numeric feature value"):
        rs.classify({**random_new_features, "mean_frp": "high"}, model_version="new")


def test_old_classifier_rejects_wrong_feature_set(random_old_features):
    broken = dict(random_old_features)
    broken.pop("mean_FRP")
    with pytest.raises(SchemaViolation, match="old-classifier feature mismatch"):
        rs.classify(broken, model_version="old")
    bad_cat = {**random_old_features, "dominant_land_cover": "lava"}
    with pytest.raises(SchemaViolation, match="dominant_land_cover"):
        rs.classify(bad_cat, model_version="old")


def test_risk_rejects_wrong_shape():
    for bad in (np.zeros((10, 17)), np.zeros((30, 5)), np.zeros((29, 17))):
        with pytest.raises(SchemaViolation, match="risk sequence shape mismatch"):
            rs.score_risk(bad)


def test_classify_rejects_unknown_model_version(random_new_features):
    with pytest.raises(SchemaViolation, match="model_version"):
        rs.classify(random_new_features, model_version="bert")


# ── Decision (b): routing actually reaches different models ─────────────────


def test_routing_new_and_old_hit_different_models(monkeypatch):
    """Assert WHICH internal path ran per version — mocking, not just no-error."""
    new_calls, old_calls = [], []

    def fake_new(features):
        new_calls.append(features)
        return {
            "predicted_class": "Industrial",
            "probabilities": {c: 0.2 for c in CLASSIFIER_CLASSES},
            "confidence": 0.2,
            "classifier_model_used": CLASSIFIER_USED_NEW,
        }

    def fake_old(features):
        old_calls.append(features)
        return {
            "predicted_class": "Industrial",
            "probabilities": {c: 0.25 for c in CLASSIFIER_CLASSES_OLD},
            "confidence": 0.25,
            "classifier_model_used": CLASSIFIER_USED_OLD,
        }

    monkeypatch.setattr(rs, "_classify_new", fake_new)
    monkeypatch.setattr(rs, "_classify_old", fake_old)

    old_payload = {name: 0.0 for name in CLASSIFIER_FEATURES_OLD}
    old_payload["dominant_land_cover"] = "built"
    new_payload = {name: 0.0 for name in CLASSIFIER_FEATURES}

    out_new = rs.classify(new_payload, model_version="new")
    out_old = rs.classify(old_payload, model_version="old")

    assert len(new_calls) == 1 and len(old_calls) == 1
    assert out_new["classifier_model_used"] == CLASSIFIER_USED_NEW
    assert out_old["classifier_model_used"] == CLASSIFIER_USED_OLD


def test_routing_default_is_new():
    """Decision (b) default: model_version=None must resolve to the MLP."""
    assert rs.resolve_classifier_version(None) == "new"


def test_predict_passthrough_keeps_model_used(random_new_features, random_old_features):
    res_new = predict(random_new_features, model_version="new")
    assert res_new.classifier_model_used == CLASSIFIER_USED_NEW
    res_old = predict(random_old_features, model_version="old")
    assert res_old.classifier_model_used == CLASSIFIER_USED_OLD
