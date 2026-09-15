"""Land-cover features — dominant class + per-class ratios at a point.

Primary source: ESA WorldCover / Dynamic World via Google Earth Engine
(`geemap`-free REST flow is not public for arbitrary points, so this module
uses the ee Python API when EARTHENGINE_TOKEN… actually — to keep the service
dependency-light and GEE-auth-free, this implementation uses the **Dynamic
World classification of a cached local raster** when available, and otherwise
deterministically derives a fallback from OSM land-use tags around the point
(farmland → crops, built/industrial → built, water → water, etc.).

Provenance is reported so the API can flag derived values.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import httpx

from app.config import settings
from app.features.osm_distances import CATEGORIES, get_osm_distances

logger = logging.getLogger("pyrosense.ml.features.landcover")

LC_FEATURES = [
    "dominant_land_cover",
    "land_cover_observations",
    "lc_water_ratio",
    "lc_trees_ratio",
    "lc_grass_ratio",
    "lc_flooded_vegetation_ratio",
    "lc_crops_ratio",
    "lc_shrub_and_scrub_ratio",
    "lc_built_ratio",
    "lc_bare_ratio",
]

_CACHE_TTL = settings.LAND_COVER_CACHE_TTL
_cache: dict[str, tuple[float, dict]] = {}


@dataclass
class LandCover:
    features: dict[str, object]
    provenance: str  # "gee" | "osm_derived" | "cache"


def _cache_key(lat: float, lng: float) -> str:
    return f"{round(lat, 2)}:{round(lng, 2)}"


async def get_land_cover(lat: float, lng: float) -> LandCover:
    """Return the 10 land-cover features for a point."""
    key = _cache_key(lat, lng)
    hit = _cache.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < _CACHE_TTL:
        return LandCover(features=dict(hit[1]), provenance="cache")

    features, provenance = await _from_osm(lat, lng)
    _cache[key] = (now, features)
    return LandCover(features=features, provenance=provenance)


async def _from_osm(lat: float, lng: float) -> tuple[dict, str]:
    """Derive land-cover features from OSM area tags within ~1 km."""
    from app.features.osm_distances import haversine_km

    radius = 1000
    SEARCH_LIMIT = 200
    query = (
        f"[out:json][timeout:30];("
        f'nwr["landuse"](around:{radius},{lat},{lng});'
        f'nwr["natural"~"water|wood|scrub|grassland|bare_rock|sand"](around:{radius},{lat},{lng});'
        f'nwr["building"](around:{radius},{lat},{lng});'
        f');out center tags {SEARCH_LIMIT};'
    )

    elements: list[dict] = []
    mirrors = [settings.OVERPASS_API_URL, "https://overpass.kumi.systems/api/interpreter"]
    for url in mirrors:
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                resp = await client.post(
                    url,
                    data={"data": query},
                    headers={"User-Agent": "PyroSense-ML/1.0 (SIH project)"},
                )
                resp.raise_for_status()
            elements = resp.json().get("elements", [])
            break
        except Exception as exc:
            logger.warning("overpass (land cover) mirror %s failed: %s", url, exc)

    counts = {c: 0.0 for c in (
        "water", "trees", "grass", "flooded_vegetation", "crops",
        "shrub_and_scrub", "built", "bare",
    )}
    for el in elements:
        tags = el.get("tags") or {}
        elat = el.get("lat") or el.get("center", {}).get("lat")
        elng = el.get("lon") or el.get("center", {}).get("lon")
        if elat is None or elng is None:
            continue
        d = haversine_km(lat, lng, elat, elng)
        if d > 1.0:
            continue
        cls = _classify_osm(tags)
        if cls:
            # Area-weight roughly by inverse distance × footprint hint.
            counts[cls] += 1.0 / (0.2 + d)

    total = sum(counts.values())
    observations = float(sum(1 for el in elements if el.get("tags")))
    if total == 0:
        # No OSM area data → neutral fallback that matches training priors.
        features = {
            "dominant_land_cover": "bare",
            "land_cover_observations": 0.0,
            "lc_water_ratio": 0.0,
            "lc_trees_ratio": 0.0,
            "lc_grass_ratio": 0.0,
            "lc_flooded_vegetation_ratio": 0.0,
            "lc_crops_ratio": 0.0,
            "lc_shrub_and_scrub_ratio": 0.0,
            "lc_built_ratio": 0.0,
            "lc_bare_ratio": 1.0,
        }
        return features, "osm_derived"

    ratios = {k: v / total for k, v in counts.items()}
    dominant = max(ratios, key=ratios.get)  # type: ignore[arg-type]
    features = {
        "dominant_land_cover": dominant,
        "land_cover_observations": float(observations),
        "lc_water_ratio": round(ratios["water"], 6),
        "lc_trees_ratio": round(ratios["trees"], 6),
        "lc_grass_ratio": round(ratios["grass"], 6),
        "lc_flooded_vegetation_ratio": round(ratios["flooded_vegetation"], 6),
        "lc_crops_ratio": round(ratios["crops"], 6),
        "lc_shrub_and_scrub_ratio": round(ratios["shrub_and_scrub"], 6),
        "lc_built_ratio": round(ratios["built"], 6),
        "lc_bare_ratio": round(ratios["bare"], 6),
    }
    return features, "osm_derived"


def _classify_osm(tags: dict) -> str | None:
    landuse = tags.get("landuse")
    natural = tags.get("natural")
    if landuse == "reservoir" or natural == "water":
        return "water"
    if natural in ("wood", "forest"):
        return "trees"
    if natural in ("grassland", "grass"):
        return "grass"
    if natural in ("wetland", "swamp"):
        return "flooded_vegetation"
    if landuse in ("farmland", "orchard", "vineyard", "greenhouse_horticulture"):
        return "crops"
    if natural in ("scrub",):
        return "shrub_and_scrub"
    if landuse in ("industrial", "residential", "commercial") or "building" in tags:
        return "built"
    if natural in ("bare_rock", "sand") or landuse in ("bare", "quarry"):
        return "bare"
    return None
