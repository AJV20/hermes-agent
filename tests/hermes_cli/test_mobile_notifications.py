"""Behavior tests for the authenticated, profile-scoped mobile notification API."""

from fastapi.testclient import TestClient

from hermes_cli import web_server


def _client_for_homes(monkeypatch, tmp_path):
    default_home = tmp_path / "default"
    profiles = {"other": tmp_path / "other"}
    default_home.mkdir()
    profiles["other"].mkdir()
    monkeypatch.setattr(web_server, "get_hermes_home", lambda: default_home)
    monkeypatch.setattr(web_server, "_resolve_profile_dir", lambda name: profiles[name])
    web_server.app.state.auth_required = False
    return TestClient(web_server.app), default_home, profiles


def _headers():
    return {"X-Hermes-Session-Token": web_server._SESSION_TOKEN}


def test_mobile_notifications_require_dashboard_authentication(monkeypatch, tmp_path):
    client, _default_home, _profiles = _client_for_homes(monkeypatch, tmp_path)

    response = client.get("/api/mobile/notifications")

    assert response.status_code == 401


def test_mobile_notifications_are_durable_deduplicated_and_profile_scoped(monkeypatch, tmp_path):
    client, default_home, profiles = _client_for_homes(monkeypatch, tmp_path)
    payload = {
        "body": "The build finished.",
        "dedupe_key": "build:finished",
        "level": "success",
        "session_id": None,
        "target": "/mobile/chats",
        "title": "Build complete",
        "type": "build",
    }

    created = client.post("/api/mobile/notifications", json=payload, headers=_headers())
    replaced = client.post(
        "/api/mobile/notifications",
        params={"profile": "other"},
        json={**payload, "title": "Other profile build"},
        headers=_headers(),
    )
    updated = client.post("/api/mobile/notifications", json={**payload, "body": "The build finished again."}, headers=_headers())

    assert created.status_code == 200
    assert updated.status_code == 200
    assert created.json()["id"] == updated.json()["id"]
    assert client.get("/api/mobile/notifications", headers=_headers()).json()["total"] == 1
    assert client.get("/api/mobile/notifications", params={"profile": "other"}, headers=_headers()).json() == {
        "items": [replaced.json()],
        "total": 1,
    }
    assert (default_home / "mobile_notifications.db").exists()
    assert (profiles["other"] / "mobile_notifications.db").exists()


def test_mobile_notifications_mark_read_and_dismiss_without_cross_profile_leak(monkeypatch, tmp_path):
    client, _default_home, _profiles = _client_for_homes(monkeypatch, tmp_path)
    created = client.post(
        "/api/mobile/notifications",
        json={"body": "Low credits", "level": "warning", "title": "Credits", "type": "credits"},
        headers=_headers(),
    ).json()
    notification_id = created["id"]

    marked = client.post(f"/api/mobile/notifications/{notification_id}/read", headers=_headers())
    dismissed = client.post(f"/api/mobile/notifications/{notification_id}/dismiss", headers=_headers())
    active = client.get("/api/mobile/notifications", headers=_headers())
    including_dismissed = client.get("/api/mobile/notifications?include_dismissed=true", headers=_headers())
    other = client.post(
        f"/api/mobile/notifications/{notification_id}/dismiss",
        params={"profile": "other"},
        headers=_headers(),
    )

    assert marked.status_code == 200
    assert marked.json()["read_at"] is not None
    assert dismissed.status_code == 200
    assert dismissed.json()["dismissed_at"] is not None
    assert active.json() == {"items": [], "total": 0}
    assert including_dismissed.json()["items"][0]["id"] == notification_id
    assert other.status_code == 404


def test_mobile_notifications_reject_unsafe_content_and_targets(monkeypatch, tmp_path):
    client, _default_home, _profiles = _client_for_homes(monkeypatch, tmp_path)

    unsafe_title = client.post(
        "/api/mobile/notifications",
        json={"body": "ok", "title": "<script>alert(1)</script>", "type": "notice"},
        headers=_headers(),
    )
    unsafe_target = client.post(
        "/api/mobile/notifications",
        json={"body": "ok", "target": "https://attacker.test/", "title": "Notice", "type": "notice"},
        headers=_headers(),
    )
    oversized_title = client.post(
        "/api/mobile/notifications",
        json={"body": "ok", "title": "x" * 161, "type": "notice"},
        headers=_headers(),
    )

    assert unsafe_title.status_code == 422
    assert unsafe_target.status_code == 422
    assert oversized_title.status_code == 422
