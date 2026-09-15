"""OSM distance features — nearest-facility haversine distances by category.

Computes the six `distance_to_*_km` features via the Overpass API, with an
in-process TTL cache (bbox-keyed) so repeated predictions in the same area do
not hammer the public instance. Degrades gracefully: on any Overpass failure
distances are returned as None → the engineer applies median fallback and
flags provenance.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass

import httpx

from app.config import settings

logger = logging.getLogger("pyrosense.ml.features.osm")

# Category → Overpass filter. Mirrors the Node backend's union query and adds
# mining/fuel/agriculture/transport categories used by the model features.
CATEGORIES: dict[str, str] = {
    "distance_to_industrial_km": 'nwr["man_made"="works"](around:{radius},{lat},{lng});nwr["landuse"="industrial"](around:{radius},{lat},{lng});',
    "distance_to_power_km": 'nwr["power"="plant"](around:{radius},{lat},{lng});nwr["power"="substation"](around:{radius},{lat},{lng});',
    "distance_to_mining_km": 'nwr["landuse"="quarry"](around:{radius},{lat},{lng});nwr["industrial"="mine"](around:{radius},{lat},{lng});',
    "distance_to_fuel_storage_km": 'nwr["man_made"="storage_tank"](around:{radius},{lat},{lng});nwr["industrial"="oil"](around:{radius},{lat},{lng});nwr["man_made"="petroleum_well"](around:{radius},{lat},{lng});',
    "distance_to_agriculture_km": 'nwr["landuse"="farmland"](around:{radius},{lat},{lng});nwr["landuse"="farmyard"](around:{radius},{lat},{lng});',
    "distance_to_transport_km": 'node["railway"="station"](around:{radius},{lat},{lng});nwr["aeroway"="aerodrome"](around:{radius},{lat},{lng});nwr["amenity"="bus_station"](around:{radius},{lat},{lng});',
}

SEARCH_RADIUS_M = 50_000  # 50 km — training distances go well beyond this
_CACHE_TTL = settings.OSM_FACILITIES_CACHE_TTL
_cache: dict[str, tuple[float, dict[str, float | None]]] = {}


@dataclass
class OsmDistances:
    distances: dict[str, float | None]
    cached: bool


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _cache_key(lat: float, lng: float) -> str:
    return f"{round(lat, 2)}:{round(lng, 2)}"


def _overpass_query(lat: float, lng: float) -> str:
    parts = "".join(
        tmpl.format(radius=SEARCH_RADIUS_M, lat=lat, lng=lng)
        for tmpl in CATEGORIES.values()
    )
    return f"[out:json][timeout:60];({parts});out center tags {SEARCH_RADIUS_M // 10};"


async def get_osm_distances(lat: float, lng: float) -> OsmDistances:
    """Nearest distance (km) per category, or None when unavailable/none found."""
    key = _cache_key(lat, lng)
    hit = _cache.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < _CACHE_TTL:
        return OsmDistances(distances=hit[1], cached=True)

    query = _overpass_query(lat, lng)
    mirrors = [settings.OVERPASS_API_URL, "https://overpass.kumi.systems/api/interpreter"]
    elements: list[dict] = []
    fetch_failed = False
    for url in mirrors:
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    url,
                    data={"data": query},
                    headers={"User-Agent": "PyroSense-ML/1.0 (SIH project)"},
                )
                resp.raise_for_status()
            elements = resp.json().get("elements", [])
            break
        except (httpx.HTTPError, ValueError) as exc:
            fetch_failed = True
            logger.warning("overpass mirror %s failed: %s", url, exc)

    if not elements:
        if hit:
            # Both mirrors failed — serve stale cache rather than Nones.
            return OsmDistances(distances=hit[1], cached=True)
        # No data at all — do not cache the failure; retry next call.
        return OsmDistances(
            distances={name: None for name in CATEGORIES}, cached=False
        )

    distances: dict[str, float | None] = {}
    for feature, _tmpl in CATEGORIES.items():
        distances[feature] = _nearest_km(feature, lat, lng, elements)

    _cache[key] = (now, distances)
    return OsmDistances(distances=distances, cached=False)


def _match_category(feature: str, tags: dict) -> bool:
    if feature == "distance_to_industrial_km":
        return tags.get("man_made") == "works" or tags.get("landuse") == "industrial"
    if feature == "distance_to_power_km":
        return tags.get("power") in ("plant", "substation")
    if feature == "distance_to_mining_km":
        return tags.get("landuse") == "quarry" or tags.get("industrial") == "mine"
    if feature == "distance_to_fuel_storage_km":
        return (
            tags.get("man_made") in ("storage_tank", "petroleum_well")
            or tags.get("industrial") == "oil"
        )
    if feature == "distance_to_agriculture_km":
        return tags.get("landuse") in ("farmland", "farmyard")
    if feature == "distance_to_transport_km":
        return (
            tags.get("railway") == "station"
            or tags.get("aeroway") == "aerodrome"
            or tags.get("amenity") == "bus_station"
        )
    return False


def _nearest_km(
    feature: str, lat: float, lng: float, elements: list[dict]
) -> float | None:
    best: float | None = None
    for el in elements:
        tags = el.get("tags") or {}
        if not _match_category(feature, tags):
            continue
        # node → lat/lon; way/relation → center (requested via `out center`)
        elat = el.get("lat") or el.get("center", {}).get("lat")
        elng = el.get("lon") or el.get("center", {}).get("lon")
        if elat is None or elng is None:
            continue
        d = haversine_km(lat, lng, elat, elng)
        if best is None or d < best:
            best = d
    return best
