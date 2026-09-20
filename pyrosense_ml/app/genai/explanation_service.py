"""GenAI explanation layer — grounded LLM explanations for predictions.

Philosophy (mirrors backend/src/services/genaiService.ts):
- The prompt contains ONLY computed facts (class, probabilities, risk score,
  top drivers with values). The model is told to use these numbers and no
  others — a summary is grounded or templated, never invented.
- Deterministic output: temperature 0, reasoning explicitly disabled for
  Nemotron reasoning models, <think> blocks stripped.
- Provider chain: primary → fallback models → deterministic template.
- Explanations are cached in PostgreSQL by hash(features + risk + class);
  identical inputs never pay for a second LLM call.- The classifier's output is a CONTEXTUAL label derived from evidence, never
    presented as proof of ignition cause.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import GenAIExplanation

logger = logging.getLogger("pyrosense.genai")

SYSTEM_PROMPT = (
    "You are PYROSENSE, a thermal-anomaly analyst. You classify persistent "
    "satellite hotspots (VIIRS) into: Agricultural, Forest Vegetation, "
    "Industrial, Infrastructure Energy, or Mining. You write short, grounded "
    "explanations for analysts. You use ONLY the numbers provided in the "
    "prompt — never invent, round, or extrapolate any value. If a number is "
    "not in the facts, you do not mention it. Maximum 120 words. No markdown."
)

_RISK_BUCKETS = [(25.0, "low"), (50.0, "moderate"), (75.0, "elevated"), (101.0, "high")]


def risk_bucket(risk_score: float) -> str:
    """Severity bucket for the legacy 0-100 scalar risk_score column.

    Phase 2A: scalar risk scores are only a compatibility shim now that the
    GRU risk models exist; the pipeline passes risk_score=None until the
    Phase 2C H3 pipeline produces real signals. Prefer the returned class +
    confidence in any UI.
    """
    for ceiling, name in _RISK_BUCKETS:
        if risk_score < ceiling:
            return name
    return "high"


def build_facts(
    *,
    predicted_class: str,
    probabilities: dict[str, float],
    risk_score: float | None,
    confidence: float,
    top_features: list[dict],
    features: dict,
    source: str,
) -> list[str]:
    """Deterministic facts block — the single source the LLM may cite."""
    lines = [
        f"Predicted class: {predicted_class}",
        f"Confidence: {round(confidence * 100)}% (maximum class probability)",
    ]
    if risk_score is not None:
        lines.append(f"Risk score: {risk_score} / 100 ({risk_bucket(risk_score)} severity)")
    lines += [
        f"Data source: {source}",
        "Class probabilities: "
        + ", ".join(f"{k.replace('_', ' ')} {round(v * 100)}%" for k, v in probabilities.items()),
    ]
    if top_features:
        parts = []
        for f in top_features:
            value = f.get("value")
            if isinstance(value, float):
                value = round(value, 4)
            parts.append(f"{f.get('feature')}={value}")
        lines.append("Top contributing features: " + "; ".join(parts))
    return lines


def _user_prompt(facts: list[str]) -> str:
    residual = (
        "Note: this classifier output is a CONTEXTUAL label derived from "
        "spatial/environmental evidence — it is NOT proof of the actual "
        "ignition cause. Say so when confidence is low.\n"
    )
    return (
        "Facts (use ONLY these numbers):\n"
        + "\n".join(f"- {f}" for f in facts)    + "\n\n"
    + residual
    + "Write one grounded paragraph explaining WHY this hotspot received "
    "this classification, referencing the class probabilities with their "
    "exact values."
    )


def features_hash(
    *, features: dict, risk_score: float, predicted_class: str
) -> str:
    payload = json.dumps(
        {"features": features, "risk": risk_score, "class": predicted_class},
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def _strip_think(text: str | None) -> str:
    """Remove reasoning-model leak. An unterminated <think> means the token
    budget ran out mid-thought — drop everything from <think> onward."""
    if not text or not isinstance(text, str):
        return ""  # provider returned null/no content — fall through to next model
    text = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<think>[\s\S]*$", "", text, flags=re.IGNORECASE)
    return text.strip()



def ungrounded_numbers(output: str, facts_text: str) -> list[str]:
    """Every number-like token in the output must be derivable from the facts.

    Port of the Node backend's validator (genaiService.ts): compares pure
    digit strings (formatting-agnostic), tolerating trailing-zero and float
    variants. Any digit token appearing nowhere in the facts is ungrounded.
    """
    candidates = re.findall(r"\d+(?:\.\d+)?", output)
    problems: list[str] = []
    for raw in candidates:
        normalized = re.sub(r"^0+(?=\d)", "", raw)
        if normalized in facts_text:
            continue
        as_float = float(raw) if raw else None
        if as_float is not None and str(as_float) in facts_text:
            continue
        problems.append(raw)
    return problems


async def get_explanation(
    session: AsyncSession,
    *,
    features: dict,
    risk_score: float | None,
    predicted_class: str,
    probabilities: dict[str, float],
    confidence: float,
    top_features: list[dict],
    source: str,
    prediction_id: int | None = None,
) -> tuple[str, str]:
    """Return (explanation, provenance). Cached → LLM → deterministic template."""
    fhash = features_hash(
        features=features, risk_score=risk_score, predicted_class=predicted_class
    )

    cached = (
        await session.execute(
            select(GenAIExplanation).where(GenAIExplanation.features_hash == fhash)
        )
    ).scalar_one_or_none()
    if cached:
        return cached.explanation, "cache"

    if not settings.OPENROUTER_API_KEY:
        explanation = template_explanation(
            predicted_class=predicted_class,
            risk_score=risk_score,
            confidence=confidence,
            top_features=top_features,
            source=source,
        )
        await _store(session, fhash, prediction_id, "template", "", True, explanation)
        return explanation, "template"

    facts = build_facts(
        predicted_class=predicted_class,
        probabilities=probabilities,
        risk_score=risk_score,
        confidence=confidence,
        top_features=top_features,
        features=features,
        source=source,
    )
    explanation, model_name, grounded = await _generate(facts)
    if not explanation:
        # Every provider failed (or produced only ungrounded/no content) —
        # fall back to the deterministic template. NEVER cache or return an
        # empty explanation: a cached "" would poison every future identical
        # request (provenance "cache" replaying nothing, forever).
        explanation = template_explanation(
            predicted_class=predicted_class,
            risk_score=risk_score,
            confidence=confidence,
            top_features=top_features,
            source=source,
        )
        await _store(session, fhash, prediction_id, "template", "", False, explanation)
        return explanation, "template"
    await _store(session, fhash, prediction_id, "openrouter", model_name, grounded, explanation)
    return explanation, "openrouter" if grounded else "template"

async def _store(
    session: AsyncSession,
    fhash: str,
    prediction_id: int | None,
    provider: str,
    model_name: str,
    grounded: bool,
    explanation: str,
) -> None:
    session.add(
        GenAIExplanation(
            prediction_id=prediction_id,
            features_hash=fhash,
            provider=provider,
            model_name=model_name,
            grounded=grounded,
            explanation=explanation,
        )
    )
    try:
        await session.flush()
    except Exception:
        await session.rollback()
        logger.info("explanation cache race on %s — keeping existing", fhash[:12])


async def _generate(facts: list[str]) -> tuple[str, str, bool]:
    """Try primary then fallback OpenRouter models. Returns (text, model, ok).

    Grounding contract (mirrors genaiService.ts): every number in the output
    must be derivable from the facts block — an ungrounded explanation is
    discarded and the next provider tried; if all fail, the caller templates.
    """
    facts_text = "\n".join(f"- {f}" for f in facts)
    prompt = _user_prompt(facts)
    models = [settings.OPENROUTER_MODEL, *settings.fallback_models]
    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "PyroSense ML",
    }
    async with httpx.AsyncClient(timeout=settings.GENAI_TIMEOUT_SECONDS) as client:
        for model in models:
            try:
                resp = await client.post(
                    f"{settings.OPENROUTER_API_URL}/chat/completions",
                    headers=headers,
                    json={
                        "model": model,
                        "temperature": 0,
                        "max_tokens": 400,
                        "reasoning": {"enabled": False},
                        "messages": [
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": prompt},
                        ],
                    },
                )
                resp.raise_for_status()
                content = _strip_think(
                    resp.json().get("choices", [{}])[0].get("message", {}).get("content")
                )
                if not content:
                    logger.warning("genai model %s returned no content", model)
                    continue
                problems = ungrounded_numbers(content, facts_text)
                if problems:
                    logger.warning(
                        "genai model %s discarded — ungrounded numbers %s", model, problems
                    )
                    continue
                return content, model, True
            except (httpx.HTTPError, ValueError, IndexError, KeyError) as exc:
                logger.warning("genai model %s failed: %s", model, exc)
    return "", "", False


def template_explanation(
    *,
    predicted_class: str,
    risk_score: float | None,
    confidence: float,
    top_features: list[dict],
    source: str,
) -> str:
    """Deterministic fallback — always available, always grounded."""
    drivers = ", ".join(
        f.get("feature", "?") for f in top_features[:3]
    ) or "the engineered features"
    risk_part = (
        f"yielding a risk score of {risk_score}/100 ({risk_bucket(risk_score)} severity)"
        if risk_score is not None
        else "with GRU risk signals pending the live H3 pipeline"
    )
    return (
        f"This hotspot is classified as {predicted_class.replace('_', ' ')} "
        f"with {round(confidence * 100)}% confidence, {risk_part} from {source} "
        f"data. The strongest contributing factors were {drivers}. "
        "Explanation generated from the deterministic template (LLM unavailable)."
    ).strip()
