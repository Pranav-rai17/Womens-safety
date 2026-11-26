import asyncio

from google import genai
from google.genai import types
from sqlalchemy import select

from app.config import get_settings
from app.db import AsyncSessionLocal, init_db
from app.models import LegalDocument

STATUTORY_CORPUS = [
    {
        "section": "BNSS Section 173(1) — Zero FIR",
        "title": "Mandatory Registration Regardless of Territorial Jurisdiction",
        "content": (
            "Under Section 173(1) of the Bharatiya Nagarik Suraksha Sanhita (BNSS), 2023, "
            "every information relating to the commission of a cognizable offence, irrespective "
            "of the area where the offence is committed, may be given orally or by electronic "
            "communication to an officer in charge of a police station. Any police station is "
            "legally bound to register a Zero FIR and subsequently transfer it to the police "
            "station having territorial jurisdiction."
        ),
    },
    {
        "section": "BNSS Section 173(1)(ii) — e-FIR",
        "title": "Electronic FIR & 3-Day Signing Requirement",
        "content": (
            "Under Section 173(1)(ii) of BNSS, 2023, information relating to a cognizable "
            "offence given by electronic communication (e-FIR) shall be taken on record by the "
            "police officer on being signed by the person giving it within three (3) days. "
            "Preliminary verification or formal signing within 3 days completes registration."
        ),
    },
    {
        "section": "BNSS Section 173(2) — Free FIR Copy",
        "title": "Right to Free Copy of Recorded FIR Forthwith",
        "content": (
            "Under Section 173(2) of BNSS, 2023, a copy of the information as recorded under "
            "sub-section (1) shall be given forthwith, free of cost, to the informant or the "
            "victim."
        ),
    },
    {
        "section": "BNSS Section 173(4) — SP & Magistrate Escalation",
        "title": "Remedy Upon Refusal by Officer-in-Charge",
        "content": (
            "Under Section 173(4) of BNSS, 2023, any person aggrieved by a refusal on the part "
            "of an officer in charge of a police station to record the information referred to "
            "in sub-section (1) may send the substance of such information, in writing and by "
            "post, to the Superintendent of Police (SP) concerned. If the SP is satisfied that "
            "such information discloses the commission of a cognizable offence, they shall "
            "either investigate the case themselves or direct an investigation. Failing this, "
            "the aggrieved person may make an application to the Magistrate under Section 175(3)."
        ),
    },
    {
        "section": "POSH Act, 2013 (Sections 9, 11, 12, 16)",
        "title": "Sexual Harassment of Women at Workplace — IC, LC & Confidentiality",
        "content": (
            "Under the Sexual Harassment of Women at Workplace (Prevention, Prohibition and "
            "Redressal) Act, 2013: (1) Section 9 allows a written complaint to the Internal "
            "Committee (IC) within 3 months of the last incident (extendable by 3 months); "
            "(2) If the workplace has fewer than 10 workers or the complaint is against the "
            "employer, the complaint goes to the District Local Committee (LC); "
            "(3) Section 12 entitles the aggrieved woman to interim relief such as transfer "
            "or up to 3 months paid leave; (4) Section 16 strictly prohibits disclosure of the "
            "complainant's identity."
        ),
    },
]


async def seed_legal_rag() -> None:
    settings = get_settings()
    if not settings.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY must be set to embed statutory documents.")

    await init_db()
    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    async with AsyncSessionLocal() as session:
        for item in STATUTORY_CORPUS:
            embed_resp = await client.aio.models.embed_content(
                model="text-embedding-004",
                contents=f"{item['section']} - {item['title']}\n{item['content']}",
                config=types.EmbedContentConfig(output_dimensionality=768),
            )
            vec = list(embed_resp.embeddings[0].values)

            res = await session.execute(
                select(LegalDocument).where(LegalDocument.section == item["section"])
            )
            existing = res.scalar_one_or_none()
            if existing:
                existing.title = item["title"]
                existing.content = item["content"]
                existing.embedding = vec
            else:
                session.add(
                    LegalDocument(
                        section=item["section"],
                        title=item["title"],
                        content=item["content"],
                        embedding=vec,
                    )
                )

        await session.commit()
        print(f"[seed_legal_rag] Upserted {len(STATUTORY_CORPUS)} embedded statutory chunks into pgvector.")


if __name__ == "__main__":
    asyncio.run(seed_legal_rag())
