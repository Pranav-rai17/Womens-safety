import json
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_user
from ..config import get_settings
from ..db import get_db
from ..models import LegalDocument

router = APIRouter(prefix="/api/legal", tags=["legal"])

# ---------------------------------------------------------------------------
# Strict Pre-LLM Immediate Physical Danger Guardrail
# ---------------------------------------------------------------------------

IMMEDIATE_DANGER_PATTERNS = [
    r"\bfollowing me\b",
    r"\bchasing me\b",
    r"\bbehind me\b",
    r"\battack(ing|ed)?\b",
    r"\bassault(ing|ed)?\b",
    r"\btrapped\b",
    r"\blocked (me|in)\b",
    r"\bweapon\b",
    r"\bknife\b",
    r"\bgun\b",
    r"\bbleeding\b",
    r"\bgrabbed me\b",
    r"\bhelp me now\b",
    r"\bimmediate danger\b",
    r"\bin danger right now\b",
    r"\bstalking me right now\b",
    r"\bthreatening to kill\b",
]


def is_immediate_danger(message: str) -> bool:
    text = message.lower().strip()
    return any(re.search(pattern, text) for pattern in IMMEDIATE_DANGER_PATTERNS)


class LegalAssistRequest(BaseModel):
    message: str = Field(..., min_length=2, max_length=4000)
    location: str = Field(default="Bengaluru, Karnataka")
    incident_datetime: Optional[str] = None
    complainant_name: Optional[str] = None


@router.post("/assist")
async def legal_assist(
    body: LegalAssistRequest,
    current_user: Dict[str, Any] = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    # 1. Pre-LLM immediate physical danger guardrail
    if is_immediate_danger(body.message):
        return {
            "emergency_bypass": True,
            "action": "CALL_112_OR_SOS",
            "message": (
                "Immediate physical danger detected. Do not wait to draft a legal document — "
                "call 112 or trigger the SOS / Duress alert immediately."
            ),
        }

    settings = get_settings()
    if not settings.GEMINI_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GEMINI_API_KEY is not configured for Legal RAG",
        )

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    # 2. Embed user query using Gemini text-embedding-004 (768-d)
    embed_resp = await client.aio.models.embed_content(
        model="text-embedding-004",
        contents=body.message,
        config=types.EmbedContentConfig(output_dimensionality=768),
    )
    query_vec = embed_resp.embeddings[0].values

    # 3. Cosine-similarity pgvector search in PostgreSQL `legal_documents`
    stmt = (
        select(LegalDocument)
        .where(LegalDocument.embedding.isnot(None))
        .order_by(LegalDocument.embedding.cosine_distance(query_vec))
        .limit(4)
    )
    result = await db.execute(stmt)
    docs: List[LegalDocument] = list(result.scalars().all())
    if not docs:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Legal knowledge base is empty. Run seed_legal_rag.py first.",
        )

    context_block = "\n\n".join(
        f"[{d.section} — {d.title}]\n{d.content}" for d in docs
    )
    complainant = body.complainant_name or current_user.get("full_name") or current_user.get("identifier")

    prompt = (
        "You are SafeGuard AI's Grounded Indian Legal Assistant. Using ONLY the statutory provisions "
        "retrieved below, return valid JSON with two string keys: 'guidance' and 'complaint_draft'.\n"
        "- 'guidance': concise, accurate legal steps citing the exact BNSS/POSH sections.\n"
        "- 'complaint_draft': a formal, copy-ready Zero FIR / police complaint addressed to the "
        f"Officer-in-Charge at {body.location} on behalf of {complainant} "
        f"(incident datetime: {body.incident_datetime or 'Unspecified'}).\n\n"
        f"STATUTORY PROVISIONS:\n{context_block}\n\n"
        f"USER QUERY:\n{body.message}"
    )

    gen_resp = await client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.15,
        ),
    )

    parsed = json.loads(gen_resp.text)

    return {
        "emergency_bypass": False,
        "llm_mode": "gemini-2.5-flash+pgvector",
        "citations": [
            {
                "id": d.id,
                "section": d.section,
                "title": d.title,
                "summary": d.content,
            }
            for d in docs
        ],
        "guidance": parsed.get("guidance", ""),
        "complaint_draft": parsed.get("complaint_draft", ""),
    }
