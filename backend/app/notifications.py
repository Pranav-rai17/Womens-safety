from typing import Any, Dict

import httpx

from .config import get_settings


async def send_twilio_alert(to: str, body: str, whatsapp: bool = False) -> Dict[str, Any]:
    """Send a real SMS or WhatsApp message via Twilio REST API."""
    settings = get_settings()
    if not settings.TWILIO_SID or not settings.TWILIO_AUTH_TOKEN:
        return {"sent": False, "reason": "TWILIO_SID or TWILIO_AUTH_TOKEN not configured"}

    from_number = settings.TWILIO_WHATSAPP_FROM if whatsapp else settings.TWILIO_FROM
    if not from_number:
        return {"sent": False, "reason": "TWILIO_FROM not configured"}

    to_addr = f"whatsapp:{to}" if whatsapp and not to.startswith("whatsapp:") else to
    from_addr = (
        f"whatsapp:{from_number}"
        if whatsapp and not from_number.startswith("whatsapp:")
        else from_number
    )

    url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_SID}/Messages.json"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            url,
            auth=(settings.TWILIO_SID, settings.TWILIO_AUTH_TOKEN),
            data={"From": from_addr, "To": to_addr, "Body": body},
        )
        if resp.status_code >= 400:
            return {
                "sent": False,
                "status_code": resp.status_code,
                "error": resp.text[:300],
            }
        data = resp.json()
        return {"sent": True, "sid": data.get("sid"), "to": to_addr}


async def send_dispatch_webhook(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Send a real HTTP POST dispatch payload to a configured PCR/CAD webhook."""
    settings = get_settings()
    if not settings.DISPATCH_WEBHOOK_URL:
        return {"sent": False, "reason": "DISPATCH_WEBHOOK_URL not configured"}

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(settings.DISPATCH_WEBHOOK_URL, json=payload)
        return {
            "sent": resp.status_code < 400,
            "status_code": resp.status_code,
        }
