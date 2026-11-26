import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..auth import require_user
from ..config import get_settings

router = APIRouter(prefix="/api/saferoute", tags=["saferoute"])

NOMINATIM_HEADERS = {"User-Agent": "SafeGuardAI/2.0 (women-safety-platform)"}


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


class LatLng(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class SafeRouteRequest(BaseModel):
    origin: Optional[LatLng] = None
    destination: Optional[LatLng] = None
    origin_address: Optional[str] = None
    destination_address: Optional[str] = None
    hour_of_day: Optional[int] = Field(default=None, ge=0, le=23)


async def geocode_address(query: str) -> LatLng:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=10.0, headers=NOMINATIM_HEADERS) as client:
        resp = await client.get(
            settings.NOMINATIM_URL,
            params={"q": query, "format": "json", "limit": 1},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Nominatim geocoding service error")
        results = resp.json()
        if not results:
            raise HTTPException(status_code=404, detail=f"Address not found: {query}")
        return LatLng(lat=float(results[0]["lat"]), lng=float(results[0]["lon"]))


@router.get("/geocode")
async def geocode_endpoint(
    q: str = Query(..., min_length=2),
    _: Dict[str, Any] = Depends(require_user),
) -> Dict[str, Any]:
    loc = await geocode_address(q)
    return {"query": q, "lat": loc.lat, "lng": loc.lng}


async def query_overpass_bbox(
    south: float, west: float, north: float, east: float
) -> Tuple[List[Dict[str, Any]], List[Tuple[float, float]]]:
    """Query real OpenStreetMap Overpass API for safe havens and street lamps."""
    settings = get_settings()
    overpass_ql = (
        f"[out:json][timeout:15];"
        f"("
        f'node["amenity"~"^(police|hospital|pharmacy)$"]({south},{west},{north},{east});'
        f'node["highway"="street_lamp"]({south},{west},{north},{east});'
        f");"
        f"out body;"
    )
    async with httpx.AsyncClient(timeout=18.0) as client:
        resp = await client.post(settings.OVERPASS_URL, data={"data": overpass_ql})
        if resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Overpass API error ({resp.status_code})",
            )
        elements = resp.json().get("elements", [])

    havens: List[Dict[str, Any]] = []
    lamps: List[Tuple[float, float]] = []

    for el in elements:
        tags = el.get("tags", {})
        lat = el.get("lat")
        lng = el.get("lon")
        if lat is None or lng is None:
            continue
        if tags.get("highway") == "street_lamp":
            lamps.append((float(lat), float(lng)))
        elif tags.get("amenity") in ("police", "hospital", "pharmacy"):
            amenity = tags["amenity"].upper()
            havens.append(
                {
                    "id": f"osm-{el['id']}",
                    "name": tags.get("name") or f"OSM {amenity.title()}",
                    "category": amenity,
                    "lat": float(lat),
                    "lng": float(lng),
                    "is_24_7": tags.get("opening_hours") == "24/7" or amenity in ("POLICE", "HOSPITAL"),
                    "phone": tags.get("phone") or tags.get("contact:phone") or "112",
                }
            )

    return havens, lamps


async def query_overpass_safe_havens(
    lat: float, lng: float, radius_m: int = 2500, limit: int = 5
) -> List[Dict[str, Any]]:
    """Query real Overpass API around (lat, lng) for nearest police, hospitals, and pharmacies."""
    settings = get_settings()
    overpass_ql = (
        f"[out:json][timeout:15];"
        f'node["amenity"~"^(police|hospital|pharmacy)$"](around:{radius_m},{lat},{lng});'
        f"out body;"
    )
    async with httpx.AsyncClient(timeout=18.0) as client:
        resp = await client.post(settings.OVERPASS_URL, data={"data": overpass_ql})
        if resp.status_code != 200:
            return []
        elements = resp.json().get("elements", [])

    ranked: List[Tuple[float, Dict[str, Any]]] = []
    for el in elements:
        tags = el.get("tags", {})
        h_lat = el.get("lat")
        h_lng = el.get("lon")
        if h_lat is None or h_lng is None:
            continue
        dist_km = haversine_km(lat, lng, float(h_lat), float(h_lng))
        amenity = tags.get("amenity", "police").upper()
        ranked.append(
            (
                dist_km,
                {
                    "id": f"osm-{el['id']}",
                    "name": tags.get("name") or f"OSM {amenity.title()}",
                    "category": amenity,
                    "lat": float(h_lat),
                    "lng": float(h_lng),
                    "is_24_7": tags.get("opening_hours") == "24/7" or amenity in ("POLICE", "HOSPITAL"),
                    "phone": tags.get("phone") or tags.get("contact:phone") or "112",
                    "distance_km": round(dist_km, 2),
                    "distance_m": int(round(dist_km * 1000)),
                },
            )
        )

    ranked.sort(key=lambda x: x[0])
    return [item[1] for item in ranked[:limit]]


def _score_osrm_route(
    coords: List[List[float]],
    havens: List[Dict[str, Any]],
    lamps: List[Tuple[float, float]],
    is_night: bool,
) -> Tuple[int, int, int]:
    """
    Score an OSRM route ([lng, lat] list) against real OSM Safe Havens & street lamps.
    Returns (safety_score_0_100, lighting_score_0_100, nearby_havens_count).
    """
    if not coords:
        return 50, 50, 0

    step = max(1, len(coords) // 20)
    sampled = coords[::step]

    lamp_hits = 0
    haven_ids_near = set()

    for lng, lat in sampled:
        for l_lat, l_lng in lamps:
            if haversine_km(lat, lng, l_lat, l_lng) <= 0.12:
                lamp_hits += 1
                break
        for h in havens:
            if haversine_km(lat, lng, h["lat"], h["lng"]) <= 0.65:
                haven_ids_near.add(h["id"])

    lamp_ratio = lamp_hits / max(1, len(sampled))
    lighting_score = int(round(min(100, 35 + lamp_ratio * 65)))
    haven_bonus = min(35, len(haven_ids_near) * 9)
    night_penalty = 14 if (is_night and lighting_score < 60) else 0

    raw_score = int(round(lighting_score * 0.6 + haven_bonus + 15 - night_penalty))
    safety_score = max(15, min(99, raw_score))
    return safety_score, lighting_score, len(haven_ids_near)


@router.post("/calculate")
async def calculate_saferoute(
    body: SafeRouteRequest,
    _: Dict[str, Any] = Depends(require_user),
) -> Dict[str, Any]:
    origin = body.origin
    if not origin and body.origin_address:
        origin = await geocode_address(body.origin_address)
    dest = body.destination
    if not dest and body.destination_address:
        dest = await geocode_address(body.destination_address)

    if not origin or not dest:
        raise HTTPException(
            status_code=422,
            detail="Provide origin/destination coordinates or origin_address/destination_address",
        )

    hour = body.hour_of_day if body.hour_of_day is not None else datetime.now(timezone.utc).hour
    is_night = hour >= 20 or hour <= 5

    # 1. Call real OSRM Public Routing API
    settings = get_settings()
    osrm_url = (
        f"{settings.OSRM_BASE_URL}/route/v1/foot/"
        f"{origin.lng},{origin.lat};{dest.lng},{dest.lat}"
    )
    async with httpx.AsyncClient(timeout=15.0) as client:
        osrm_resp = await client.get(
            osrm_url,
            params={"alternatives": "true", "geometries": "geojson", "overview": "full"},
        )
        if osrm_resp.status_code != 200:
            raise HTTPException(status_code=502, detail="OSRM routing service unavailable")
        osrm_data = osrm_resp.json()

    routes = osrm_data.get("routes", [])
    if not routes:
        raise HTTPException(status_code=404, detail="No pedestrian route found between points")

    # 2. Compute bounding box across all returned OSRM routes and query Overpass API
    all_lngs = [pt[0] for r in routes for pt in r["geometry"]["coordinates"]]
    all_lats = [pt[1] for r in routes for pt in r["geometry"]["coordinates"]]
    pad = 0.008
    havens, lamps = await query_overpass_bbox(
        south=min(all_lats) - pad,
        west=min(all_lngs) - pad,
        north=max(all_lats) + pad,
        east=max(all_lngs) + pad,
    )

    # 3. Score each real OSRM route
    scored_features: List[Dict[str, Any]] = []
    for r in routes:
        coords = r["geometry"]["coordinates"]
        safety_score, lighting_score, nearby_count = _score_osrm_route(
            coords, havens, lamps, is_night
        )
        scored_features.append(
            {
                "type": "Feature",
                "geometry": r["geometry"],
                "properties": {
                    "distance_km": round(r["distance"] / 1000.0, 2),
                    "eta_minutes": max(1, int(round(r["duration"] / 60.0))),
                    "safety_score": safety_score,
                    "lighting_score": lighting_score,
                    "safe_havens_count": nearby_count,
                    "osm_street_lamps_sampled": len(lamps),
                },
            }
        )

    fastest = min(scored_features, key=lambda f: f["properties"]["eta_minutes"])
    safest = max(scored_features, key=lambda f: f["properties"]["safety_score"])

    fastest["properties"]["route_type"] = "fastest"
    safest["properties"]["route_type"] = "safest"

    # Compute distance from route midpoint to each Overpass safe haven
    mid_lat = (origin.lat + dest.lat) / 2.0
    mid_lng = (origin.lng + dest.lng) / 2.0
    enriched_havens = []
    for h in havens:
        dkm = haversine_km(mid_lat, mid_lng, h["lat"], h["lng"])
        enriched_havens.append({**h, "distance_km": round(dkm, 2), "distance_m": int(round(dkm * 1000))})
    enriched_havens.sort(key=lambda h: h["distance_m"])

    return {
        "origin": origin.model_dump(),
        "destination": dest.model_dump(),
        "time_context": "NIGHT_HIGH_CAUTION" if is_night else "DAYLIGHT",
        "fastest_route": fastest,
        "safest_route": safest,
        "safe_havens": enriched_havens[:15],
    }
