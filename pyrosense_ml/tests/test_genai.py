"""GenAI grounding tests — ungrounded-number validation + think-block stripping."""

from __future__ import annotations

from app.genai.explanation_service import _strip_think, ungrounded_numbers

FACTS = (
    "- Predicted class: Industrial\n"
    "- Confidence: 95% (maximum class probability)\n"
    "- Risk score: 99.3 / 100 (high severity)\n"
    "- distance_to_industrial_km=0.8\n"
    "- lc_crops_ratio=0.02\n"
)


def test_all_numbers_grounded_passes():
    out = (
        "The hotspot is Industrial with 95% confidence and a risk score of "
        "99.3 out of 100, only 0.8 km from industrial infrastructure."
    )
    assert ungrounded_numbers(out, FACTS) == []


def test_invented_number_is_flagged():
    out = "The hotspot is Industrial with 95% confidence, roughly 12 km from a city."
    problems = ungrounded_numbers(out, FACTS)
    assert "12" in problems


def test_leading_zero_variants_tolerated():
    assert ungrounded_numbers("confidence 095 percent", FACTS) == []


def test_no_numbers_at_all_passes():
    assert ungrounded_numbers("Industrial classification, high risk.", FACTS) == []


def test_think_block_stripped():
    text = "<think>scratch arithmetic 7*9=63</think>The hotspot is Industrial."
    assert _strip_think(text) == "The hotspot is Industrial."


def test_unterminated_think_block_dropped():
    text = "The hotspot is <think>reasoning forever without close tag"
    assert _strip_think(text) == "The hotspot is"
