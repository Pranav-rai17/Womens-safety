from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Set

from fastapi import WebSocket
from sqlalchemy import desc, select

from .db import AsyncSessionLocal
from .models import Incident, LocationPing


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ConnectionManager:
    """Manages isolated WebSocket rooms: `user:{user_id}` and `admin:command_center`."""

    ADMIN_ROOM = "admin:command_center"

    def __init__(self) -> None:
        self.rooms: Dict[str, Set[WebSocket]] = defaultdict(set)

    @staticmethod
    def user_room(user_id: str) -> str:
        return f"user:{user_id}"

    async def connect(self, websocket: WebSocket, room: str) -> None:
        await websocket.accept()
        self.rooms[room].add(websocket)

    def disconnect(self, websocket: WebSocket, room: str) -> None:
        if room in self.rooms:
            self.rooms[room].discard(websocket)
            if not self.rooms[room]:
                del self.rooms[room]

    async def send_to_room(self, room: str, event_type: str, data: Dict[str, Any]) -> None:
        sockets = list(self.rooms.get(room, ()))
        if not sockets:
            return
        message = {
            "type": event_type,
            "data": data,
            "timestamp": _utc_now_iso(),
        }
        dead: list[WebSocket] = []
        for ws in sockets:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, room)

    async def send_to_user(self, user_id: str, event_type: str, data: Dict[str, Any]) -> None:
        await self.send_to_room(self.user_room(user_id), event_type, data)

    async def broadcast_to_admins(self, event_type: str, data: Dict[str, Any]) -> None:
        await self.send_to_room(self.ADMIN_ROOM, event_type, data)

    async def broadcast_new_incident(self, incident: Dict[str, Any]) -> None:
        await self.broadcast_to_admins("NEW_INCIDENT", incident)

    async def broadcast_location_update(self, payload: Dict[str, Any]) -> None:
        await self.broadcast_to_admins("SOS_LOCATION_UPDATE", payload)

    async def broadcast_ai_thought(self, payload: Dict[str, Any]) -> None:
        await self.broadcast_to_admins("AI_THOUGHT_STREAM", payload)

    async def broadcast_new_audio_chunk(self, payload: Dict[str, Any]) -> None:
        await self.broadcast_to_admins("NEW_AUDIO_CHUNK", payload)

    async def broadcast_police_dispatched(self, incident: Dict[str, Any]) -> None:
        await self.broadcast_to_admins("POLICE_DISPATCHED", incident)
        # Covert mode: NEVER send a visible dispatch alert to the user on DURESS_PIN
        if incident.get("trigger_type") != "DURESS_PIN" and not incident.get("is_covert"):
            await self.send_to_user(
                incident["user_id"],
                "POLICE_DISPATCHED",
                {
                    "incident_id": incident["id"],
                    "status": incident["status"],
                    "dispatch_unit": incident.get("dispatch_unit"),
                    "dispatch_eta_minutes": incident.get("dispatch_eta_minutes"),
                    "dispatched_at": incident.get("dispatched_at"),
                },
            )

    async def handle_user_message(self, user_id: str, payload: Dict[str, Any]) -> None:
        msg_type = payload.get("type")

        if msg_type == "LOCATION_PING":
            lat = payload.get("lat")
            lng = payload.get("lng")
            if lat is None or lng is None:
                return
            incident_id = payload.get("incident_id")
            now_iso = _utc_now_iso()

            async with AsyncSessionLocal() as session:
                if incident_id:
                    res = await session.execute(
                        select(Incident).where(
                            Incident.id == incident_id,
                            Incident.user_id == user_id,
                        )
                    )
                    inc = res.scalar_one_or_none()
                else:
                    res = await session.execute(
                        select(Incident)
                        .where(Incident.user_id == user_id, Incident.status != "RESOLVED")
                        .order_by(desc(Incident.created_at))
                        .limit(1)
                    )
                    inc = res.scalar_one_or_none()
                    if inc:
                        incident_id = inc.id

                if inc:
                    inc.lat = float(lat)
                    inc.lng = float(lng)

                ping = LocationPing(
                    incident_id=incident_id,
                    user_id=user_id,
                    lat=float(lat),
                    lng=float(lng),
                    accuracy=payload.get("accuracy"),
                    speed=payload.get("speed"),
                    battery_pct=payload.get("battery"),
                )
                session.add(ping)
                await session.commit()

            await self.broadcast_location_update(
                {
                    "user_id": user_id,
                    "incident_id": incident_id,
                    "lat": float(lat),
                    "lng": float(lng),
                    "accuracy": payload.get("accuracy"),
                    "speed": payload.get("speed"),
                    "battery": payload.get("battery"),
                    "updated_at": now_iso,
                }
            )

            if payload.get("route_deviation") or payload.get("missed_checkin"):
                import asyncio
                from .ai.guardian_agent import run_guardian_agent

                event_type = "ROUTE_DEVIATION" if payload.get("route_deviation") else "MISSED_CHECKIN"
                battery_val = payload.get("battery")
                asyncio.create_task(
                    run_guardian_agent(
                        user_id=user_id,
                        trigger_type=event_type,
                        lat=float(lat),
                        lng=float(lng),
                        incident_id=incident_id,
                        battery_pct=int(battery_val) if battery_val is not None else 70,
                    )
                )

        elif msg_type == "AI_THOUGHT_STREAM":
            await self.broadcast_ai_thought(
                {
                    "user_id": user_id,
                    "incident_id": payload.get("incident_id"),
                    "thought": payload.get("thought", ""),
                    "confidence": payload.get("confidence"),
                    "stage": payload.get("stage", "ANALYSIS"),
                }
            )


ws_manager = ConnectionManager()
