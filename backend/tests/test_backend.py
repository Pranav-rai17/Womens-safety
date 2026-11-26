import hashlib
import os
import tempfile

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_file = tmp_path / "test_safeguard.db"
    audio_dir = tmp_path / "audio"
    monkeypatch.setenv("DATABASE_PATH", str(db_file))
    monkeypatch.setenv("LOCAL_AUDIO_DIR", str(audio_dir))

    # Clear cached settings so monkeypatched env vars take effect
    from app.config import get_settings

    get_settings.cache_clear()

    from app.main import app

    with TestClient(app) as test_client:
        yield test_client

    get_settings.cache_clear()


def _login_user(client: TestClient, phone: str = "+919876543210") -> tuple[str, dict]:
    req_res = client.post("/api/auth/otp/request", json={"phone": phone})
    assert req_res.status_code == 200
    dev_otp = req_res.json()["dev_otp"]
    assert len(dev_otp) == 6

    ver_res = client.post(
        "/api/auth/otp/verify",
        json={"phone": phone, "otp": dev_otp, "full_name": "Ananya Sharma"},
    )
    assert ver_res.status_code == 200
    data = ver_res.json()
    assert data["role"] == "USER"
    return data["access_token"], data["user"]


def _login_admin(client: TestClient) -> str:
    res = client.post(
        "/api/admin/login",
        json={"email": "admin@command.local", "password": "Admin@SafeGuard2026"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["role"] == "ADMIN"
    return data["access_token"]


def test_auth_and_strict_rbac(client: TestClient):
    user_token, user = _login_user(client)
    admin_token = _login_admin(client)

    assert user["phone"] == "+919876543210"

    # Admin token cannot access user-only route
    res = client.get(
        "/api/user/me",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 403

    # User token cannot access admin-only route
    res = client.get(
        "/api/admin/incidents",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert res.status_code == 403

    # No public admin registration route
    res = client.post(
        "/api/admin/register",
        json={"email": "hacker@evil.com", "password": "pass"},
    )
    assert res.status_code == 404


def test_user_pins_and_emergency_contacts(client: TestClient):
    user_token, _ = _login_user(client)
    headers = {"Authorization": f"Bearer {user_token}"}

    res = client.put(
        "/api/user/settings",
        headers=headers,
        json={
            "safe_pin": "1234",
            "duress_pin": "9999",
            "emergency_contacts": [
                {"name": "Mom", "phone": "+919999988888", "relation": "Mother"}
            ],
        },
    )
    assert res.status_code == 200
    user = res.json()["user"]
    assert user["has_safe_pin"] is True
    assert user["has_duress_pin"] is True
    assert len(user["emergency_contacts"]) == 1

    safe_res = client.post("/api/user/verify-pin", headers=headers, json={"pin": "1234"})
    assert safe_res.status_code == 200
    assert safe_res.json()["pin_type"] == "SAFE"

    duress_res = client.post("/api/user/verify-pin", headers=headers, json={"pin": "9999"})
    assert duress_res.status_code == 200
    assert duress_res.json()["pin_type"] == "DURESS"


def _receive_until_type(ws, target_type: str, max_messages: int = 20) -> tuple[dict, list[dict]]:
    seen = []
    for _ in range(max_messages):
        msg = ws.receive_json()
        seen.append(msg)
        if msg["type"] == target_type:
            return msg, seen
    raise AssertionError(f"Did not receive {target_type}; saw {[m['type'] for m in seen]}")


def test_sos_and_covert_duress_dispatch_websocket(client: TestClient):
    user_token, _ = _login_user(client)
    admin_token = _login_admin(client)
    user_headers = {"Authorization": f"Bearer {user_token}"}
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    with client.websocket_connect(f"/ws/admin?token={admin_token}") as admin_ws:
        with client.websocket_connect(f"/ws/user?token={user_token}") as user_ws:
            # 1. Trigger SOS incident
            sos_res = client.post(
                "/api/incidents/trigger",
                headers=user_headers,
                json={"trigger_type": "SOS", "lat": 12.9716, "lng": 77.5946, "notes": "Help"},
            )
            assert sos_res.status_code == 201
            sos_id = sos_res.json()["incident"]["id"]

            admin_msg, _ = _receive_until_type(admin_ws, "NEW_INCIDENT")
            assert admin_msg["data"]["id"] == sos_id

            # Verify Guardian Agent streams AI_THOUGHT_STREAM tool calls
            esc_msg, thought_msgs = _receive_until_type(admin_ws, "AI_THOUGHT_STREAM")
            assert esc_msg["data"]["incident_id"] == sos_id

            # 2. User sends LOCATION_PING over WebSocket -> Admin gets SOS_LOCATION_UPDATE
            user_ws.send_json(
                {
                    "type": "LOCATION_PING",
                    "incident_id": sos_id,
                    "lat": 12.9720,
                    "lng": 77.5950,
                    "battery": 82,
                }
            )
            loc_msg, _ = _receive_until_type(admin_ws, "SOS_LOCATION_UPDATE")
            assert loc_msg["data"]["lat"] == 12.9720

            # 3. Admin dispatches police for SOS -> BOTH admin and user receive POLICE_DISPATCHED
            disp_res = client.post(
                f"/api/admin/incidents/{sos_id}/dispatch",
                headers=admin_headers,
                json={"unit_id": "PCR-12", "eta_minutes": 4},
            )
            assert disp_res.status_code == 200
            assert disp_res.json()["user_notified"] is True

            admin_disp, _ = _receive_until_type(admin_ws, "POLICE_DISPATCHED")
            assert admin_disp["type"] == "POLICE_DISPATCHED"
            user_disp = user_ws.receive_json()
            assert user_disp["type"] == "POLICE_DISPATCHED"
            assert user_disp["data"]["dispatch_unit"] == "PCR-12"

            # 4. Trigger DURESS_PIN incident -> covert mode
            duress_res = client.post(
                "/api/incidents/trigger",
                headers=user_headers,
                json={"trigger_type": "DURESS_PIN", "lat": 12.9784, "lng": 77.6408},
            )
            assert duress_res.status_code == 201
            assert duress_res.json()["covert"] is True
            duress_id = duress_res.json()["incident_id"]

            admin_duress, _ = _receive_until_type(admin_ws, "NEW_INCIDENT")
            assert admin_duress["data"]["trigger_type"] == "DURESS_PIN"
            assert admin_duress["data"]["is_covert"] is True

            # 5. Admin dispatches police for DURESS_PIN -> user_notified MUST be False!
            duress_disp = client.post(
                f"/api/admin/incidents/{duress_id}/dispatch",
                headers=admin_headers,
                json={"unit_id": "PCR-99", "eta_minutes": 3},
            )
            assert duress_disp.status_code == 200
            assert duress_disp.json()["user_notified"] is False

            admin_duress_disp, _ = _receive_until_type(admin_ws, "POLICE_DISPATCHED")
            assert admin_duress_disp["type"] == "POLICE_DISPATCHED"

            incidents_res = client.get("/api/admin/incidents", headers=admin_headers)
            assert incidents_res.status_code == 200
            assert incidents_res.json()["count"] == 2


def test_audio_chunk_upload_and_playback_local_fallback(client: TestClient):
    user_token, _ = _login_user(client)
    admin_token = _login_admin(client)
    user_headers = {"Authorization": f"Bearer {user_token}"}
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    inc_res = client.post(
        "/api/incidents/trigger",
        headers=user_headers,
        json={"trigger_type": "AI_ANOMALY", "lat": 28.5, "lng": 77.2, "ai_confidence": 0.94},
    )
    assert inc_res.status_code == 201
    incident_id = inc_res.json()["incident"]["id"]

    audio_bytes = b"WEBM_MOCK_10S_AUDIO_DATA"
    sha256_hex = hashlib.sha256(audio_bytes).hexdigest()

    url_res = client.post(
        "/api/recordings/upload-url",
        headers=user_headers,
        json={
            "incident_id": incident_id,
            "chunk_index": 0,
            "sha256": sha256_hex,
            "duration_seconds": 10.0,
        },
    )
    assert url_res.status_code == 200
    upload_info = url_res.json()
    assert upload_info["storage_mode"] == "local"
    chunk_id = upload_info["chunk_id"]

    put_res = client.put(
        upload_info["upload_url"],
        headers=user_headers,
        content=audio_bytes,
    )
    assert put_res.status_code == 200
    assert put_res.json()["sha256"] == sha256_hex

    play_url_res = client.get(
        f"/api/recordings/playback-url?chunk_id={chunk_id}",
        headers=admin_headers,
    )
    assert play_url_res.status_code == 200
    playback_url = play_url_res.json()["playback_url"]

    stream_res = client.get(playback_url, headers=admin_headers)
    assert stream_res.status_code == 200
    assert stream_res.content == audio_bytes


def test_saferoute_calculate_bengaluru_defaults(client: TestClient):
    user_token, _ = _login_user(client)
    headers = {"Authorization": f"Bearer {user_token}"}

    res = client.post("/api/saferoute/calculate", headers=headers, json={"hour_of_day": 22})
    assert res.status_code == 200
    data = res.json()

    assert data["fastest_route"]["geometry"]["type"] == "LineString"
    assert data["safest_route"]["geometry"]["type"] == "LineString"
    assert (
        data["safest_route"]["properties"]["safety_score"]
        > data["fastest_route"]["properties"]["safety_score"]
    )
    assert len(data["safe_havens"]) >= 3


def test_legal_rag_emergency_bypass_and_zero_fir_draft(client: TestClient):
    user_token, _ = _login_user(client)
    headers = {"Authorization": f"Bearer {user_token}"}

    # 1. Immediate physical danger bypasses LLM
    danger_res = client.post(
        "/api/legal/assist",
        headers=headers,
        json={"message": "A man is following me right now and has a knife"},
    )
    assert danger_res.status_code == 200
    assert danger_res.json()["emergency_bypass"] is True
    assert danger_res.json()["action"] == "CALL_112_OR_SOS"

    # 2. Grounded BNSS 173 + POSH retrieval & Zero FIR draft
    legal_res = client.post(
        "/api/legal/assist",
        headers=headers,
        json={
            "message": "Police refused to file my FIR for workplace harassment, how do I file a Zero FIR or escalate to SP?",
            "location": "Indiranagar, Bengaluru",
        },
    )
    assert legal_res.status_code == 200
    data = legal_res.json()
    assert data["emergency_bypass"] is False
    sections = [c["section"] for c in data["citations"]]
    assert any("173" in s for s in sections)
    assert any("POSH" in s for s in sections)
    assert "Zero FIR" in data["complaint_draft"]


def test_guardian_agent_route_deviation_streams_thoughts(client: TestClient):
    user_token, _ = _login_user(client)
    admin_token = _login_admin(client)
    user_headers = {"Authorization": f"Bearer {user_token}"}

    with client.websocket_connect(f"/ws/admin?token={admin_token}") as admin_ws:
        eval_res = client.post(
            "/api/guardian/evaluate",
            headers=user_headers,
            json={
                "event_type": "ROUTE_DEVIATION",
                "lat": 12.9716,
                "lng": 77.5946,
                "battery_pct": 14,
                "notes": "Deviated 600m from SafeRoute",
            },
        )
        assert eval_res.status_code == 200
        assert eval_res.json()["escalation"]["escalated"] is True

        tools_seen = set()
        for _ in range(7):
            msg = admin_ws.receive_json()
            assert msg["type"] == "AI_THOUGHT_STREAM"
            if msg["data"].get("tool_name"):
                tools_seen.add(msg["data"]["tool_name"])

        assert {
            "find_open_safe_havens",
            "compile_incident_brief",
            "escalate_to_admin",
        }.issubset(tools_seen)
