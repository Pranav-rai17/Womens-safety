import secrets
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any, Dict, List, Optional

import aiosmtplib
import bcrypt
import httpx
import jwt
import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import get_db
from .models import Admin, User
from .notifications import send_twilio_alert

router = APIRouter(tags=["auth"])
bearer_scheme = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# Redis Client Helper
# ---------------------------------------------------------------------------

def get_redis() -> aioredis.Redis:
    settings = get_settings()
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


# ---------------------------------------------------------------------------
# Password / PIN / OTP Hashing Helpers
# ---------------------------------------------------------------------------

def hash_secret(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_secret(plain: str, hashed: Optional[str]) -> bool:
    if not hashed or not plain:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def serialize_user(user: User) -> Dict[str, Any]:
    return {
        "id": user.id,
        "identifier": user.identifier,
        "phone": user.phone or user.identifier,
        "email": user.email,
        "full_name": user.full_name,
        "has_safe_pin": bool(user.safe_pin_hash),
        "has_duress_pin": bool(user.duress_pin_hash),
        "emergency_contacts": user.emergency_contacts or [],
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
        "role": "USER",
    }


# ---------------------------------------------------------------------------
# JWT Helpers
# ---------------------------------------------------------------------------

def create_access_token(subject: str, role: str, extra: Optional[Dict[str, Any]] = None) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "sub": subject,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Dict[str, Any]:
    settings = get_settings()
    try:
        return jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
        )


# ---------------------------------------------------------------------------
# Strict Async RBAC Dependencies
# ---------------------------------------------------------------------------

async def require_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    payload = decode_access_token(credentials.credentials)
    if payload.get("role") != "USER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="USER role required",
        )
    result = await db.execute(select(User).where(User.id == payload.get("sub")))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account not found",
        )
    return serialize_user(user)


async def require_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    payload = decode_access_token(credentials.credentials)
    if payload.get("role") != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ADMIN role required",
        )
    result = await db.execute(select(Admin).where(Admin.id == payload.get("sub")))
    admin = result.scalar_one_or_none()
    if not admin:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin account not found",
        )
    return {
        "id": admin.id,
        "email": admin.email,
        "full_name": admin.full_name,
        "role": "ADMIN",
        "created_at": admin.created_at.isoformat() if admin.created_at else None,
    }


# ---------------------------------------------------------------------------
# Real OTP Delivery (SMTP Email via aiosmtplib / SMS via Twilio)
# ---------------------------------------------------------------------------

async def _send_email_otp(recipient: str, otp: str) -> None:
    settings = get_settings()
    if not settings.SMTP_HOST or not settings.SMTP_USER or not settings.SMTP_PASS:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) are not configured",
        )

    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = recipient
    msg["Subject"] = "SafeGuard AI — Your 6-Digit Verification Code"
    msg.set_content(
        f"Your SafeGuard AI verification code is: {otp}\n\n"
        "This code expires in 5 minutes. Do not share it with anyone."
    )

    await aiosmtplib.send(
        msg,
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        start_tls=True,
        username=settings.SMTP_USER,
        password=settings.SMTP_PASS,
    )


async def _send_sms_otp(phone: str, otp: str) -> None:
    res = await send_twilio_alert(
        phone,
        f"SafeGuard AI verification code: {otp} (valid for 5 minutes).",
        whatsapp=False,
    )
    if not res.get("sent"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=res.get("reason") or res.get("error") or "Failed to deliver SMS OTP",
        )


# ---------------------------------------------------------------------------
# Request Schemas
# ---------------------------------------------------------------------------

class OTPRequest(BaseModel):
    identifier: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None

    def target(self) -> str:
        val = (self.identifier or self.email or self.phone or "").strip()
        if not val:
            raise HTTPException(status_code=422, detail="Provide email or phone identifier")
        return val


class OTPVerifyRequest(BaseModel):
    identifier: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    otp: str = Field(..., min_length=6, max_length=6)
    full_name: Optional[str] = None

    def target(self) -> str:
        val = (self.identifier or self.email or self.phone or "").strip()
        if not val:
            raise HTTPException(status_code=422, detail="Provide email or phone identifier")
        return val


class AdminLoginRequest(BaseModel):
    email: str
    password: str


class EmergencyContact(BaseModel):
    name: str
    phone: str
    relation: Optional[str] = "Trusted Contact"


class UserSettingsUpdate(BaseModel):
    full_name: Optional[str] = None
    safe_pin: Optional[str] = Field(default=None, min_length=4, max_length=8)
    duress_pin: Optional[str] = Field(default=None, min_length=4, max_length=8)
    emergency_contacts: Optional[List[EmergencyContact]] = None


class VerifyPinRequest(BaseModel):
    pin: str = Field(..., min_length=4, max_length=8)


# ---------------------------------------------------------------------------
# Auth Routes (Production Redis + SMTP/Twilio + PostgreSQL)
# ---------------------------------------------------------------------------

@router.post("/api/auth/otp/request")
async def request_otp(body: OTPRequest) -> Dict[str, Any]:
    target = body.target().lower() if "@" in body.target() else body.target()
    otp = f"{secrets.randbelow(1_000_000):06d}"
    settings = get_settings()

    redis_client = get_redis()
    try:
        await redis_client.set(f"otp:{target}", hash_secret(otp), ex=settings.OTP_TTL_SECONDS)
    finally:
        await redis_client.aclose()

    if "@" in target:
        await _send_email_otp(target, otp)
        channel = "email"
    else:
        await _send_sms_otp(target, otp)
        channel = "sms"

    return {
        "message": f"OTP sent via {channel}",
        "identifier": target,
        "ttl_seconds": settings.OTP_TTL_SECONDS,
    }


@router.post("/api/auth/otp/verify")
async def verify_otp(
    body: OTPVerifyRequest,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    raw_target = body.target()
    target = raw_target.lower() if "@" in raw_target else raw_target
    redis_key = f"otp:{target}"

    redis_client = get_redis()
    try:
        otp_hash = await redis_client.get(redis_key)
        if not otp_hash:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="OTP expired or not requested",
            )
        if not verify_secret(body.otp.strip(), otp_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid OTP",
            )
        await redis_client.delete(redis_key)
    finally:
        await redis_client.aclose()

    # Upsert user in PostgreSQL
    result = await db.execute(select(User).where(User.identifier == target))
    user = result.scalar_one_or_none()

    if not user:
        user = User(
            identifier=target,
            email=target if "@" in target else None,
            phone=target if "@" not in target else None,
            full_name=(body.full_name or "").strip(),
            emergency_contacts=[],
        )
        db.add(user)
        await db.flush()
    elif body.full_name and not user.full_name:
        user.full_name = body.full_name.strip()
        await db.flush()

    token = create_access_token(
        subject=user.id,
        role="USER",
        extra={"identifier": user.identifier},
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": "USER",
        "user": serialize_user(user),
    }


@router.post("/api/admin/login")
async def admin_login(
    body: AdminLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    email = body.email.strip().lower()
    result = await db.execute(select(Admin).where(Admin.email == email))
    admin = result.scalar_one_or_none()

    if not admin or not verify_secret(body.password, admin.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin credentials",
        )

    token = create_access_token(
        subject=admin.id,
        role="ADMIN",
        extra={"email": admin.email},
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": "ADMIN",
        "admin": {
            "id": admin.id,
            "email": admin.email,
            "full_name": admin.full_name,
            "role": "ADMIN",
        },
    }


# ---------------------------------------------------------------------------
# User Profile, PINs & Emergency Contacts
# ---------------------------------------------------------------------------

@router.get("/api/user/me")
async def get_me(current_user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    return {"user": current_user}


@router.put("/api/user/settings")
async def update_user_settings(
    body: UserSettingsUpdate,
    current_user: Dict[str, Any] = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    if body.safe_pin and body.duress_pin and body.safe_pin == body.duress_pin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Safe PIN and Duress PIN must be different",
        )

    result = await db.execute(select(User).where(User.id == current_user["id"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.full_name is not None:
        user.full_name = body.full_name.strip()
    if body.safe_pin is not None:
        user.safe_pin_hash = hash_secret(body.safe_pin)
    if body.duress_pin is not None:
        user.duress_pin_hash = hash_secret(body.duress_pin)
    if body.emergency_contacts is not None:
        user.emergency_contacts = [c.model_dump() for c in body.emergency_contacts]

    await db.flush()
    return {"user": serialize_user(user)}


@router.post("/api/user/verify-pin")
async def verify_user_pin(
    body: VerifyPinRequest,
    current_user: Dict[str, Any] = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    result = await db.execute(select(User).where(User.id == current_user["id"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if verify_secret(body.pin, user.safe_pin_hash):
        return {"pin_type": "SAFE", "valid": True}
    if verify_secret(body.pin, user.duress_pin_hash):
        return {"pin_type": "DURESS", "valid": True}

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid PIN",
    )
