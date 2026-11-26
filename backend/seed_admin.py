import asyncio

import bcrypt
from sqlalchemy import select

from app.config import get_settings
from app.db import AsyncSessionLocal, init_db
from app.models import Admin


async def seed_admin() -> None:
    settings = get_settings()
    await init_db()

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Admin).where(Admin.email == settings.DEFAULT_ADMIN_EMAIL.lower())
        )
        existing = result.scalar_one_or_none()
        if existing:
            print(f"[seed_admin] Admin already exists: {existing.email}")
            return

        password_hash = bcrypt.hashpw(
            settings.DEFAULT_ADMIN_PASSWORD.encode("utf-8"),
            bcrypt.gensalt(),
        ).decode("utf-8")

        admin = Admin(
            email=settings.DEFAULT_ADMIN_EMAIL.lower(),
            password_hash=password_hash,
            full_name="Command Center Admin",
        )
        session.add(admin)
        await session.commit()
        print(f"[seed_admin] Seeded production admin account: {admin.email}")


if __name__ == "__main__":
    asyncio.run(seed_admin())
