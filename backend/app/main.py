import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .ai.guardian_agent import router as guardian_router, run_guardian_agent
from .ai.legal_rag import router as legal_router
from .ai.saferoute import router as saferoute_router
from .auth import decode_access_token, require_admin, require_user, router as auth_router
from .config import get_settings
from .db import get_db, init_db
from .models import DispatchLog, Incident
from .notifications import send_dispatch_webhook, send_twilio_alert
from .storage import router as storage_router
from .ws_manager import ws_manager


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    yield


settings = get_settings()
app = FastAPI(
    title=settings.APP_NAME,
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(storage_router)
app.include_router(guardian_router)
app.include_router(saferoute_router)
app.include_router(legal_router)


# ---------------------------------------------------------------------------
# Serialization Helpers
# ---------------------------------------------------------------------------

def _serialize_incident(inc: Incident) -> Dict[str, Any]:
    latest_dispatch = inc.dispatches[-1] if inc.dispatches else None
    return {
        "id": inc.id,
        "user_id": inc.user_id,
        "trigger_type": inc.trigger_type,
        "status": inc.status,
        "is_covert": inc.is_covert,
        "lat": inc.lat,
        "lng": inc.lng,
        "notes": inc.notes,
        "ai_confidence": inc.ai_confidence,
        "ai_reasoning": inc.ai_reasoning,
        "dispatch_unit": latest_dispatch.unit_id if latest_dispatch else None,
        "dispatch_eta_minutes": latest_dispatch.eta_minutes if latest_dispatch else None,
        "dispatch_notes": latest_dispatch.notes if latest_dispatch else None,
        "dispatched_at": (
            latest_dispatch.dispatched_at.isoformat()
            if latest_dispatch and latest_dispatch.dispatched_at
            else None
        ),
        "resolved_at": inc.resolved_at.isoformat() if inc.resolved_at else None,
        "created_at": inc.created_at.isoformat() if inc.created_at else None,
        "updated_at": inc.updated_at.isoformat() if inc.updated_at else None,
        "user": (
            {
                "id": inc.user.id,
                "phone": inc.user.phone or inc.user.identifier,
                "email": inc.user.email,
                "full_name": inc.user.full_name,
                "emergency_contacts": inc.user.emergency_contacts or [],
            }
            if inc.user
            else None
        ),
        "audio_chunks": [
            {
                "id": rec.id,
                "chunk_id": rec.id,
                "chunk_index": rec.chunk_index,
                "storage_key": rec.storage_key,
                "sha256_hash": rec.sha256_hash,
                "duration_seconds": rec.duration_seconds,
                "size_bytes": rec.size_bytes,
                "created_at": rec.created_at.isoformat() if rec.created_at else None,
            }
            for rec in sorted(inc.recordings, key=lambda r: r.chunk_index)
        ],
    }


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

TriggerType = Literal["SOS", "DURESS_PIN", "DEADMAN_SWITCH", "AI_ANOMALY"]


class TriggerIncidentRequest(BaseModel):
    trigger_type: TriggerType
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    notes: Optional[str] = ""
    ai_confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    ai_reasoning: Optional[str] = ""
    battery_pct: int = Field(default=78, ge=0, le=100)
    zone_risk: Optional[str] = Field(default=None, pattern="^(LOW|MODERATE|HIGH)$")


class DispatchRequest(BaseModel):
    unit_id: str = "PCR-01"
    eta_minutes: int = Field(default=5, ge=1, le=120)
    notes: Optional[str] = ""


# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------

@app.get("/health")
def health_check() -> Dict[str, str]:
    return {"status": "ok", "service": "safeguard-ai-backend"}


# ---------------------------------------------------------------------------
# Incident & Police Dispatch API
# ---------------------------------------------------------------------------

@app.post("/api/incidents/trigger", status_code=status.HTTP_201_CREATED)
async def trigger_incident(
    body: TriggerIncidentRequest,
    current_user: Dict[str, Any] = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    is_covert = body.trigger_type == "DURESS_PIN"
    inc = Incident(
        user_id=current_user["id"],
        trigger_type=body.trigger_type,
        status="ACTIVE",
        is_covert=is_covert,
        lat=body.lat,
        lng=body.lng,
        notes=(body.notes or "").strip(),
        ai_confidence=body.ai_confidence,
        ai_reasoning=(body.ai_reasoning or "").strip(),
    )
    db.add(inc)
    await db.flush()

    res = await db.execute(
        select(Incident)
        .options(
            selectinload(Incident.user),
            selectinload(Incident.recordings),
            selectinload(Incident.dispatches),
        )
        .where(Incident.id == inc.id)
    )
    loaded = res.scalar_one()
    incident_dict = _serialize_incident(loaded)
    await db.commit()

    await ws_manager.broadcast_new_incident(incident_dict)

    # Send real SMS / WhatsApp alerts via Twilio to user's saved emergency contacts
    tracking_link = f"{settings.PUBLIC_TRACKING_BASE_URL}/track/{loaded.id}"
    contacts = current_user.get("emergency_contacts") or []
    sms_results = []
    for contact in contacts:
        phone = contact.get("phone")
        if not phone:
            continue
        alert_text = (
            f"EMERGENCY ({body.trigger_type}): {current_user.get('full_name') or current_user.get('identifier')} "
            f"needs help at ({body.lat:.5f}, {body.lng:.5f}). Live tracking: {tracking_link}"
        )
        sms_results.append(await send_twilio_alert(phone, alert_text, whatsapp=False))
        if settings.TWILIO_WHATSAPP_FROM:
            sms_results.append(await send_twilio_alert(phone, alert_text, whatsapp=True))

    asyncio.create_task(
        run_guardian_agent(
            user_id=current_user["id"],
            trigger_type=body.trigger_type,
            lat=body.lat,
            lng=body.lng,
            incident_id=loaded.id,
            battery_pct=body.battery_pct,
            zone_risk=body.zone_risk,
            notes=body.notes or "",
        )
    )

    if is_covert:
        return {
            "incident_id": loaded.id,
            "status": "SAFE_DISARMED",
            "covert": True,
            "message": "System disarmed",
        }

    return {
        "incident": incident_dict,
        "sms_alerts": sms_results,
        "message": f"Incident triggered ({body.trigger_type})",
    }


@app.get("/api/admin/incidents")
async def list_admin_incidents(
    _: Dict[str, Any] = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    res = await db.execute(
        select(Incident)
        .options(
            selectinload(Incident.user),
            selectinload(Incident.recordings),
            selectinload(Incident.dispatches),
        )
        .order_by(desc(Incident.created_at))
    )
    rows = res.scalars().all()
    incidents = [_serialize_incident(r) for r in rows]
    return {"incidents": incidents, "count": len(incidents)}


@app.post("/api/admin/incidents/{incident_id}/dispatch")
async def dispatch_police(
    incident_id: str,
    body: Optional[DispatchRequest] = None,
    current_admin: Dict[str, Any] = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    dispatch_data = body or DispatchRequest()

    res = await db.execute(select(Incident).where(Incident.id == incident_id))
    inc = res.scalar_one_or_none()
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    inc.status = "DISPATCHED"
    log_entry = DispatchLog(
        incident_id=inc.id,
        admin_id=current_admin["id"],
        unit_id=dispatch_data.unit_id,
        eta_minutes=dispatch_data.eta_minutes,
        notes=(dispatch_data.notes or "").strip(),
    )
    db.add(log_entry)
    await db.flush()

    loaded_res = await db.execute(
        select(Incident)
        .options(
            selectinload(Incident.user),
            selectinload(Incident.recordings),
            selectinload(Incident.dispatches),
        )
        .where(Incident.id == incident_id)
    )
    loaded = loaded_res.scalar_one()
    incident_dict = _serialize_incident(loaded)
    await db.commit()

    await ws_manager.broadcast_police_dispatched(incident_dict)

    webhook_res = await send_dispatch_webhook(
        {
            "event": "POLICE_DISPATCHED",
            "incident_id": incident_dict["id"],
            "trigger_type": incident_dict["trigger_type"],
            "unit_id": dispatch_data.unit_id,
            "eta_minutes": dispatch_data.eta_minutes,
            "lat": incident_dict["lat"],
            "lng": incident_dict["lng"],
            "dispatched_by": current_admin["email"],
        }
    )

    return {
        "incident": incident_dict,
        "webhook_dispatch": webhook_res,
        "user_notified": incident_dict["trigger_type"] != "DURESS_PIN"
        and not incident_dict["is_covert"],
    }


@app.post("/api/admin/incidents/{incident_id}/resolve")
async def resolve_incident(
    incident_id: str,
    _: Dict[str, Any] = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    res = await db.execute(select(Incident).where(Incident.id == incident_id))
    inc = res.scalar_one_or_none()
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    inc.status = "RESOLVED"
    inc.resolved_at = datetime.now(timezone.utc)
    await db.flush()

    loaded_res = await db.execute(
        select(Incident)
        .options(
            selectinload(Incident.user),
            selectinload(Incident.recordings),
            selectinload(Incident.dispatches),
        )
        .where(Incident.id == incident_id)
    )
    loaded = loaded_res.scalar_one()
    return {"incident": _serialize_incident(loaded)}


# ---------------------------------------------------------------------------
# Real-Time WebSocket Endpoints
# ---------------------------------------------------------------------------

@app.websocket("/ws/user")
async def user_websocket(
    websocket: WebSocket,
    token: str = Query(...),
) -> None:
    try:
        payload = decode_access_token(token)
        if payload.get("role") != "USER":
            await websocket.close(code=4003)
            return
        user_id = payload["sub"]
    except HTTPException:
        await websocket.close(code=4001)
        return

    room = ws_manager.user_room(user_id)
    await ws_manager.connect(websocket, room)
    try:
        while True:
            data = await websocket.receive_json()
            if isinstance(data, dict):
                await ws_manager.handle_user_message(user_id, data)
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, room)
    except Exception:
        ws_manager.disconnect(websocket, room)


@app.websocket("/ws/admin")
async def admin_websocket(
    websocket: WebSocket,
    token: str = Query(...),
) -> None:
    try:
        payload = decode_access_token(token)
        if payload.get("role") != "ADMIN":
            await websocket.close(code=4003)
            return
    except HTTPException:
        await websocket.close(code=4001)
        return

    await ws_manager.connect(websocket, ws_manager.ADMIN_ROOM)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, ws_manager.ADMIN_ROOM)
    except Exception:
        ws_manager.disconnect(websocket, ws_manager.ADMIN_ROOM)
