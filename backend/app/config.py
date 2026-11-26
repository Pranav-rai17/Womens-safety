import os
from functools import lru_cache
from typing import List


class Settings:
    APP_NAME: str = os.getenv("APP_NAME", "SafeGuard AI")
    JWT_SECRET: str = os.getenv("JWT_SECRET", "safeguard-ai-production-secret-change-me")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))
    OTP_TTL_SECONDS: int = int(os.getenv("OTP_TTL_SECONDS", "300"))

    CORS_ORIGINS: List[str] = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if origin.strip()
    ]

    # PostgreSQL + asyncpg + pgvector
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://safeguard:safeguard_secret@localhost:5432/safeguard_ai",
    )

    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    # SMTP (aiosmtplib)
    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASS: str = os.getenv("SMTP_PASS", "")
    SMTP_FROM: str = os.getenv("SMTP_FROM", "noreply@safeguard.ai")

    # Twilio SMS / WhatsApp
    TWILIO_SID: str = os.getenv("TWILIO_SID", os.getenv("TWILIO_ACCOUNT_SID", ""))
    TWILIO_AUTH_TOKEN: str = os.getenv("TWILIO_AUTH_TOKEN", "")
    TWILIO_FROM: str = os.getenv("TWILIO_FROM", os.getenv("TWILIO_FROM_NUMBER", ""))
    TWILIO_WHATSAPP_FROM: str = os.getenv("TWILIO_WHATSAPP_FROM", "")

    # Police / PCR Dispatch Webhook
    DISPATCH_WEBHOOK_URL: str = os.getenv("DISPATCH_WEBHOOK_URL", "")
    PUBLIC_TRACKING_BASE_URL: str = os.getenv("PUBLIC_TRACKING_BASE_URL", "http://localhost:5173")

    # MinIO / S3
    S3_ENDPOINT: str = os.getenv("S3_ENDPOINT", os.getenv("S3_ENDPOINT_URL", "http://localhost:9000"))
    S3_ACCESS_KEY: str = os.getenv("S3_ACCESS_KEY", os.getenv("S3_ACCESS_KEY_ID", "minioadmin"))
    S3_SECRET_KEY: str = os.getenv("S3_SECRET_KEY", os.getenv("S3_SECRET_ACCESS_KEY", "minioadmin"))
    S3_BUCKET: str = os.getenv("S3_BUCKET", os.getenv("S3_BUCKET_NAME", "safeguard-evidence"))
    S3_REGION: str = os.getenv("S3_REGION", "us-east-1")

    # Gemini API & Geospatial APIs
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    OSRM_BASE_URL: str = os.getenv("OSRM_BASE_URL", "https://router.project-osrm.org")
    OVERPASS_URL: str = os.getenv("OVERPASS_URL", "https://overpass-api.de/api/interpreter")
    NOMINATIM_URL: str = os.getenv("NOMINATIM_URL", "https://nominatim.openstreetmap.org/search")

    DEFAULT_ADMIN_EMAIL: str = os.getenv("DEFAULT_ADMIN_EMAIL", "admin@command.local")
    DEFAULT_ADMIN_PASSWORD: str = os.getenv("DEFAULT_ADMIN_PASSWORD", "Admin@SafeGuard2026")


@lru_cache()
def get_settings() -> Settings:
    return Settings()
