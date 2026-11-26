import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Generator, Optional

from .config import get_settings


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_connection() -> sqlite3.Connection:
    settings = get_settings()
    conn = sqlite3.connect(settings.DATABASE_PATH, timeout=10.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


@contextmanager
def db_session() -> Generator[sqlite3.Connection, None, None]:
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with db_session() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                phone TEXT UNIQUE NOT NULL,
                full_name TEXT DEFAULT '',
                safe_pin_hash TEXT,
                duress_pin_hash TEXT,
                emergency_contacts TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS admins (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT DEFAULT 'Command Center Admin',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS otp_codes (
                phone TEXT PRIMARY KEY,
                otp_hash TEXT NOT NULL,
                expires_at REAL NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS incidents (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                trigger_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                is_covert INTEGER NOT NULL DEFAULT 0,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                notes TEXT DEFAULT '',
                ai_confidence REAL,
                ai_reasoning TEXT DEFAULT '',
                dispatch_unit TEXT,
                dispatch_eta_minutes INTEGER,
                dispatch_notes TEXT,
                dispatched_by TEXT,
                dispatched_at TEXT,
                resolved_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS audio_chunks (
                id TEXT PRIMARY KEY,
                incident_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                object_key TEXT NOT NULL,
                storage_mode TEXT NOT NULL,
                sha256_client TEXT,
                sha256_verified TEXT,
                duration_seconds REAL DEFAULT 10.0,
                size_bytes INTEGER DEFAULT 0,
                uploaded INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (incident_id) REFERENCES incidents(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            """
        )


def serialize_user(row: sqlite3.Row) -> Dict[str, Any]:
    contacts = []
    try:
        contacts = json.loads(row["emergency_contacts"] or "[]")
    except json.JSONDecodeError:
        contacts = []
    return {
        "id": row["id"],
        "phone": row["phone"],
        "full_name": row["full_name"],
        "has_safe_pin": bool(row["safe_pin_hash"]),
        "has_duress_pin": bool(row["duress_pin_hash"]),
        "emergency_contacts": contacts,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def get_user_by_id(user_id: str) -> Optional[sqlite3.Row]:
    with db_session() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
