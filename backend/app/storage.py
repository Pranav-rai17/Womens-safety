import uuid
from typing import Any, Dict, Optional

import boto3
from botocore.client import Config as BotoConfig
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import require_admin, require_user
from .config import get_settings
from .db import get_db
from .models import Incident, IncidentRecording
from .ws_manager import ws_manager

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


def _get_s3_client():
    settings = get_settings()
    return boto3.client(
        service_name="s3",
        endpoint_url=settings.S3_ENDPOINT or None,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
        config=BotoConfig(signature_version="s3v4"),
    )


class UploadUrlRequest(BaseModel):
    incident_id: str
    chunk_index: int = Field(..., ge=0)
    content_type: str = "audio/webm"


class ConfirmRecordingRequest(BaseModel):
    incident_id: str
    chunk_index: int = Field(..., ge=0)
    storage_key: str
    sha256_hash: str = Field(..., min_length=32, max_length=128)
    duration_seconds: float = Field(default=10.0, gt=0, le=60)
    size_bytes: int = Field(default=0, ge=0)


@router.post("/upload-url")
async def create_presigned_upload_url(
    body: UploadUrlRequest,
    current_user: Dict[str, Any] = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    result = await db.execute(
        select(Incident).where(
            Incident.id == body.incident_id,
            Incident.user_id == current_user["id"],
        )
    )
    incident = result.scalar_one_or_none()
    if not incident:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident not found for this user",
        )

    settings = get_settings()
    chunk_uuid = str(uuid.uuid4())
    storage_key = (
        f"evidence/{current_user['id']}/{body.incident_id}/"
        f"chunk_{body.chunk_index:05d}_{chunk_uuid}.webm"
    )

    s3 = _get_s3_client()
    presigned_put = s3.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": settings.S3_BUCKET,
            "Key": storage_key,
            "ContentType": body.content_type,
        },
        ExpiresIn=300,
    )

    return {
        "upload_url": presigned_put,
        "storage_key": storage_key,
        "bucket": settings.S3_BUCKET,
        "method": "PUT",
        "expires_in": 300,
    }


@router.post("/confirm", status_code=status.HTTP_201_CREATED)
async def confirm_recording_upload(
    body: ConfirmRecordingRequest,
    current_user: Dict[str, Any] = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    result = await db.execute(
        select(Incident).where(
            Incident.id == body.incident_id,
            Incident.user_id == current_user["id"],
        )
    )
    incident = result.scalar_one_or_none()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found for this user")

    recording = IncidentRecording(
        incident_id=body.incident_id,
        user_id=current_user["id"],
        chunk_index=body.chunk_index,
        storage_key=body.storage_key,
        sha256_hash=body.sha256_hash,
        duration_seconds=body.duration_seconds,
        size_bytes=body.size_bytes,
    )
    db.add(recording)
    await db.flush()

    payload = {
        "chunk_id": recording.id,
        "incident_id": recording.incident_id,
        "user_id": recording.user_id,
        "chunk_index": recording.chunk_index,
        "storage_key": recording.storage_key,
        "sha256_hash": recording.sha256_hash,
        "duration_seconds": recording.duration_seconds,
        "size_bytes": recording.size_bytes,
        "created_at": recording.created_at.isoformat() if recording.created_at else None,
    }
    await ws_manager.broadcast_new_audio_chunk(payload)

    return {"recording": payload}


@router.get("/playback-url")
async def get_presigned_playback_url(
    chunk_id: Optional[str] = Query(default=None),
    storage_key: Optional[str] = Query(default=None),
    _: Dict[str, Any] = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    if not chunk_id and not storage_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide either chunk_id or storage_key",
        )

    if chunk_id:
        result = await db.execute(
            select(IncidentRecording).where(IncidentRecording.id == chunk_id)
        )
    else:
        result = await db.execute(
            select(IncidentRecording).where(IncidentRecording.storage_key == storage_key)
        )

    recording = result.scalar_one_or_none()
    if not recording:
        raise HTTPException(status_code=404, detail="Recording chunk not found")

    settings = get_settings()
    s3 = _get_s3_client()
    presigned_get = s3.generate_presigned_url(
        ClientMethod="get_object",
        Params={
            "Bucket": settings.S3_BUCKET,
            "Key": recording.storage_key,
        },
        ExpiresIn=300,
    )

    return {
        "chunk_id": recording.id,
        "incident_id": recording.incident_id,
        "chunk_index": recording.chunk_index,
        "storage_key": recording.storage_key,
        "sha256_hash": recording.sha256_hash,
        "playback_url": presigned_get,
        "expires_in": 300,
    }
