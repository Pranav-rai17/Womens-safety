import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from sqlalchemy import desc, select

from ..auth import require_user
from ..config import get_settings
from ..db import AsyncSessionLocal
from ..models import Incident, LocationPing, User
from ..notifications import send_twilio_alert
from ..ws_manager import ws_manager
from .saferoute import query_overpass_safe_havens

router = APIRouter(prefix="/api/guardian", tags=["guardian"])


# ---------------------------------------------------------------------------
# Real Guardian Agent Tools (Overpass API, PostgreSQL, Twilio)
# ---------------------------------------------------------------------------

async def query_nearest_safe_havens(lat: float, lng: float) -> Dict[str, Any]:
    """Query OpenStreetMap Overpass API for nearest police stations, hospitals, and pharmacies."""
    havens = await query_overpass_safe_havens(lat, lng, radius_m=2500, limit=5)
    return {"count": len(havens), "safe_havens": havens}


async def check_user_telemetry(incident_id: str) -> Dict[str, Any]:
    """Query PostgreSQL for incident details, user profile, and latest GPS/battery ping."""
    async with AsyncSessionLocal() as session:
        inc_res = await session.execute(select(Incident).where(Incident.id == incident_id))
        inc = inc_res.scalar_one_or_none()
        if not inc:
            return {"error": f"Incident {incident_id} not found"}

        user_res = await session.execute(select(User).where(User.id == inc.user_id))
        user = user_res.scalar_one_or_none()

        ping_res = await session.execute(
            select(LocationPing)
            .where(LocationPing.user_id == inc.user_id)
            .order_by(desc(LocationPing.created_at))
            .limit(1)
        )
        latest_ping = ping_res.scalar_one_or_none()

        return {
            "incident_id": inc.id,
            "trigger_type": inc.trigger_type,
            "status": inc.status,
            "is_covert": inc.is_covert,
            "lat": inc.lat,
            "lng": inc.lng,
            "notes": inc.notes,
            "battery_pct": latest_ping.battery_pct if latest_ping else None,
            "speed": latest_ping.speed if latest_ping else None,
            "user_name": user.full_name if user else None,
            "emergency_contacts_count": len(user.emergency_contacts or []) if user else 0,
        }


async def dispatch_emergency_contacts(incident_id: str, summary: str) -> Dict[str, Any]:
    """Persist AI reasoning to PostgreSQL and send real Twilio SMS alerts to emergency contacts."""
    settings = get_settings()
    async with AsyncSessionLocal() as session:
        inc_res = await session.execute(select(Incident).where(Incident.id == incident_id))
        inc = inc_res.scalar_one_or_none()
        if not inc:
            return {"error": f"Incident {incident_id} not found"}

        inc.ai_reasoning = summary
        inc.ai_confidence = 0.95

        user_res = await session.execute(select(User).where(User.id == inc.user_id))
        user = user_res.scalar_one_or_none()
        contacts = (user.emergency_contacts or []) if user else []
        await session.commit()

    tracking_url = f"{settings.PUBLIC_TRACKING_BASE_URL}/track/{incident_id}"
    deliveries = []
    for contact in contacts:
        phone = contact.get("phone")
        if not phone:
            continue
        sms_body = (
            f"SAFEGUARD AI GUARDIAN ALERT: {summary}\n"
            f"Live tracking: {tracking_url}"
        )
        res = await send_twilio_alert(phone, sms_body, whatsapp=False)
        deliveries.append({"name": contact.get("name"), "phone": phone, **res})

    return {"persisted": True, "incident_id": incident_id, "sms_deliveries": deliveries}


# Gemini Function Declarations
_TOOL_DECLARATIONS = types.Tool(
    function_declarations=[
        types.FunctionDeclaration(
            name="query_nearest_safe_havens",
            description="Query OpenStreetMap Overpass API for nearest 24/7 police stations, hospitals, and pharmacies.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "lat": types.Schema(type="NUMBER", description="Latitude"),
                    "lng": types.Schema(type="NUMBER", description="Longitude"),
                },
                required=["lat", "lng"],
            ),
        ),
        types.FunctionDeclaration(
            name="check_user_telemetry",
            description="Query PostgreSQL for incident trigger type, latest GPS coordinates, battery %, and emergency contact count.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "incident_id": types.Schema(type="STRING", description="Incident UUID"),
                },
                required=["incident_id"],
            ),
        ),
        types.FunctionDeclaration(
            name="dispatch_emergency_contacts",
            description="Persist the compiled AI situational summary to PostgreSQL and send SMS alerts to emergency contacts.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "incident_id": types.Schema(type="STRING", description="Incident UUID"),
                    "summary": types.Schema(type="STRING", description="Concise situational brief for police & contacts"),
                },
                required=["incident_id", "summary"],
            ),
        ),
    ]
)


# ---------------------------------------------------------------------------
# Real Gemini 2.5 Flash Agent Loop
# ---------------------------------------------------------------------------

async def run_guardian_agent(
    *,
    user_id: str,
    trigger_type: str,
    lat: float,
    lng: float,
    incident_id: Optional[str] = None,
    battery_pct: int = 78,
    zone_risk: Optional[str] = None,
    notes: str = "",
) -> Dict[str, Any]:
    settings = get_settings()

    async def emit(
        step_index: int,
        stage: str,
        thought: str,
        tool_name: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
    ) -> None:
        await ws_manager.broadcast_ai_thought(
            {
                "incident_id": incident_id,
                "user_id": user_id,
                "step_index": step_index,
                "stage": stage,
                "tool_name": tool_name,
                "thought": thought,
                "data": data or {},
            }
        )

    if not settings.GEMINI_API_KEY:
        await emit(
            1,
            "CONFIG_ERROR",
            "GEMINI_API_KEY is not configured; real Gemini 2.5 Flash Guardian Agent cannot run.",
        )
        return {"escalated": False, "error": "GEMINI_API_KEY not configured"}

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    system_instruction = (
        "You are SafeGuard AI's Autonomous Guardian Agent. When an emergency or route deviation occurs: "
        "(1) Call check_user_telemetry if an incident_id is available, "
        "(2) Call query_nearest_safe_havens(lat, lng) to find real nearby police/hospitals, "
        "(3) Call dispatch_emergency_contacts(incident_id, summary) with a concise, actionable brief. "
        "Keep reasoning concise and factual."
    )
    user_prompt = (
        f"Event: {trigger_type} | incident_id={incident_id or 'none'} | "
        f"coords=({lat}, {lng}) | battery={battery_pct}% | zone_risk={zone_risk or 'UNKNOWN'} | notes={notes}"
    )

    contents: List[types.Content] = [
        types.Content(role="user", parts=[types.Part.from_text(text=user_prompt)])
    ]

    step_idx = 0
    final_text = ""
    tool_outputs: List[Dict[str, Any]] = []

    for _ in range(5):
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                tools=[_TOOL_DECLARATIONS],
                temperature=0.1,
            ),
        )

        candidate = response.candidates[0] if response.candidates else None
        if not candidate or not candidate.content or not candidate.content.parts:
            break

        contents.append(candidate.content)
        fn_calls = []

        for part in candidate.content.parts:
            if getattr(part, "text", None):
                step_idx += 1
                final_text = part.text.strip()
                await emit(step_idx, "GEMINI_REASONING", final_text)
            if getattr(part, "function_call", None):
                fn_calls.append(part.function_call)

        if not fn_calls:
            break

        response_parts: List[types.Part] = []
        for fc in fn_calls:
            name = fc.name
            args = dict(fc.args or {})
            step_idx += 1
            await emit(
                step_idx,
                "TOOL_CALL",
                f"Gemini invoked {name}({json.dumps(args)})",
                tool_name=name,
                data={"args": args},
            )

            if name == "query_nearest_safe_havens":
                result = await query_nearest_safe_havens(float(args["lat"]), float(args["lng"]))
            elif name == "check_user_telemetry":
                result = await check_user_telemetry(str(args["incident_id"]))
            elif name == "dispatch_emergency_contacts":
                result = await dispatch_emergency_contacts(
                    str(args["incident_id"]), str(args["summary"])
                )
            else:
                result = {"error": f"Unknown tool: {name}"}

            tool_outputs.append({"tool": name, "result": result})
            step_idx += 1
            await emit(
                step_idx,
                "TOOL_RESULT",
                f"{name} returned {json.dumps(result)[:240]}",
                tool_name=name,
                data=result,
            )

            response_parts.append(
                types.Part.from_function_response(name=name, response=result)
            )

        contents.append(types.Content(role="user", parts=response_parts))

    return {
        "escalated": True,
        "incident_id": incident_id,
        "summary": final_text,
        "tool_outputs": tool_outputs,
    }


class GuardianEvaluateRequest(BaseModel):
    event_type: str = Field(..., pattern="^(ROUTE_DEVIATION|MISSED_CHECKIN|ANOMALY)$")
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    battery_pct: int = Field(default=65, ge=0, le=100)
    zone_risk: Optional[str] = Field(default=None, pattern="^(LOW|MODERATE|HIGH)$")
    incident_id: Optional[str] = None
    notes: Optional[str] = ""


@router.post("/evaluate")
async def evaluate_guardian_event(
    body: GuardianEvaluateRequest,
    current_user: Dict[str, Any] = Depends(require_user),
) -> Dict[str, Any]:
    result = await run_guardian_agent(
        user_id=current_user["id"],
        trigger_type=body.event_type,
        lat=body.lat,
        lng=body.lng,
        incident_id=body.incident_id,
        battery_pct=body.battery_pct,
        zone_risk=body.zone_risk,
        notes=body.notes or "",
    )
    return {"status": "evaluated", "escalation": result}
