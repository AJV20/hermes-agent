"""Behavior tests for the authenticated, profile-scoped mobile notification API."""

import sqlite3

from fastapi.testclient import TestClient

from hermes_cli import mobile_push, web_server
from hermes_cli.config_defaults import DEFAULT_CONFIG


def _client_for_homes(monkeypatch, tmp_path):
    default_home = tmp_path / "default"
    profiles = {"other": tmp_path / "other"}
    default_home.mkdir()
    profiles["other"].mkdir()
    monkeypatch.setattr(web_server, "get_hermes_home", lambda: default_home)
    monkeypatch.setattr(web_server, "_resolve_profile_dir", lambda name: profiles[name])
    monkeypatch.setattr(web_server, "load_config", lambda: {"mobile": {"push": {"enabled": True}}})
    monkeypatch.setattr(mobile_push, "_resolve_host_addresses", lambda _host: ["142.250.72.202"])
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


def test_disabled_push_server_does_not_backlog_notification_api_deliveries(monkeypatch, tmp_path):
    client, default_home, _profiles = _client_for_homes(monkeypatch, tmp_path)
    monkeypatch.setattr(web_server, "_get_mobile_push_public_key", lambda: "B" * 87)
    monkeypatch.setattr(mobile_push, "is_transport_available", lambda: True)
    subscribed = client.put(
        "/api/mobile/push/subscription",
        json={
            "device_id": "disabled-device",
            "endpoint": "https://fcm.googleapis.com/subscription/disabled",
            "keys": {"p256dh": "A" * 87, "auth": "C" * 22},
            "categories": ["warning"],
        },
        headers=_headers(),
    )
    assert subscribed.status_code == 200
    monkeypatch.setattr(web_server, "load_config", lambda: {"mobile": {"push": {"enabled": False}}})

    created = client.post(
        "/api/mobile/notifications",
        json={"body": "Saved only in the inbox", "level": "warning", "title": "Disabled", "type": "warning"},
        headers=_headers(),
    )

    assert created.status_code == 200
    with sqlite3.connect(default_home / "mobile_notifications.db") as conn:
        assert conn.execute("SELECT COUNT(*) FROM mobile_push_deliveries").fetchone()[0] == 0


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


def test_mobile_push_capability_and_subscription_are_authenticated_no_store_and_profile_scoped(monkeypatch, tmp_path):
    client, default_home, profiles = _client_for_homes(monkeypatch, tmp_path)
    monkeypatch.setattr(web_server, "_get_mobile_push_public_key", lambda: "B" * 87)
    monkeypatch.setattr(web_server, "load_config", lambda: {"mobile": {"push": {"enabled": True}}})
    monkeypatch.setattr(mobile_push, "is_transport_available", lambda: True)
    payload = {
        "device_id": "device-opaque-123",
        "endpoint": "https://fcm.googleapis.com/subscription/abc",
        "keys": {"p256dh": "A" * 87, "auth": "C" * 22},
        "categories": ["warning", "error"],
    }

    unauthenticated = client.get("/api/mobile/push/capability")
    capability = client.get("/api/mobile/push/capability", headers=_headers())
    created = client.put("/api/mobile/push/subscription", json=payload, headers=_headers())
    other = client.get(f"/api/mobile/push/subscription/{payload['device_id']}", params={"profile": "other"}, headers=_headers())
    current = client.get(f"/api/mobile/push/subscription/{payload['device_id']}", headers=_headers())
    listing = client.get("/api/mobile/push/subscription", headers=_headers())

    assert unauthenticated.status_code == 401
    assert capability.status_code == 200
    assert capability.headers["cache-control"] == "no-store"
    assert capability.json() == {"enabled": True, "public_key": "B" * 87, "preview": False}
    assert created.status_code == 200
    assert created.headers["cache-control"] == "no-store"
    assert current.status_code == 200
    assert current.headers["cache-control"] == "no-store"
    assert current.json() == {"subscription": {"device_id": payload["device_id"], "categories": ["error", "warning"]}}
    assert other.status_code == 200
    assert other.json() == {"subscription": None}
    assert listing.status_code == 404
    assert (default_home / "mobile_notifications.db").exists()
    assert (profiles["other"] / "mobile_notifications.db").exists()


def test_web_worker_uses_one_active_home_vapid_identity_for_profile_local_queue(monkeypatch, tmp_path):
    active_home = tmp_path / "active"
    profile_home = tmp_path / "profile"
    active_home.mkdir()
    profile_home.mkdir()
    senders = []
    kicked = []
    monkeypatch.setattr(web_server, "get_hermes_home", lambda: active_home)
    monkeypatch.setattr(web_server, "load_config", lambda: {"mobile": {"push": {"enabled": True}}})
    monkeypatch.setattr(mobile_push, "make_pywebpush_sender", lambda _getter, *, home, subject: senders.append((home, subject)) or object())
    monkeypatch.setattr(mobile_push, "kick_delivery_worker", lambda home, *, send: kicked.append((home, send)))

    web_server._kick_mobile_push_delivery(profile_home)

    assert senders == [(active_home, "mailto:admin@localhost")]
    assert kicked and kicked[0][0] == profile_home


def test_mobile_push_is_config_gated_and_disabled_by_default(monkeypatch, tmp_path):
    client, _default_home, _profiles = _client_for_homes(monkeypatch, tmp_path)
    monkeypatch.setattr(web_server, "_get_mobile_push_public_key", lambda: "B" * 87)
    monkeypatch.setattr(web_server, "load_config", lambda: DEFAULT_CONFIG)
    monkeypatch.setattr(mobile_push, "is_transport_available", lambda: True)

    capability = client.get("/api/mobile/push/capability", headers=_headers())

    assert DEFAULT_CONFIG["mobile"]["push"]["enabled"] is False
    assert capability.json() == {"enabled": False, "public_key": None, "preview": False}


def test_mobile_push_capability_is_disabled_when_the_optional_transport_is_absent(monkeypatch, tmp_path):
    client, _default_home, _profiles = _client_for_homes(monkeypatch, tmp_path)
    monkeypatch.setattr(web_server, "_get_mobile_push_public_key", lambda: "B" * 87)
    monkeypatch.setattr(mobile_push, "is_transport_available", lambda: False)
    payload = {
        "device_id": "device-opaque-123",
        "endpoint": "https://fcm.googleapis.com/subscription/abc",
        "keys": {"p256dh": "A" * 87, "auth": "C" * 22},
        "categories": ["error"],
    }

    capability = client.get("/api/mobile/push/capability", headers=_headers())
    created = client.put("/api/mobile/push/subscription", json=payload, headers=_headers())

    assert capability.json() == {"enabled": False, "public_key": None, "preview": False}
    assert created.status_code == 409


def test_mobile_push_rejects_malformed_origins_and_noncanonical_keys(monkeypatch, tmp_path):
    client, _default_home, _profiles = _client_for_homes(monkeypatch, tmp_path)
    monkeypatch.setattr(web_server, "_get_mobile_push_public_key", lambda: "B" * 87)
    monkeypatch.setattr(mobile_push, "is_transport_available", lambda: True)
    base = {
        "device_id": "device-opaque-123",
        "endpoint": "https://fcm.googleapis.com/subscription/abc",
        "keys": {"p256dh": "A" * 87, "auth": "C" * 22},
        "categories": ["warning"],
    }
    payloads = [
        {**base, "endpoint": "https://user@push.example.test/a"},
        {**base, "endpoint": "https://127.0.0.1/a"},
        {**base, "endpoint": "https://fcm.googleapis.com/a#fragment"},
        {**base, "endpoint": "https://internal.attacker.test/push"},
        {**base, "keys": {"p256dh": "A" * 86, "auth": "C" * 22}},
        {**base, "keys": {"p256dh": "A" * 87, "auth": "C" * 23}},
    ]

    responses = [client.put("/api/mobile/push/subscription", json=payload, headers=_headers()) for payload in payloads]

    assert [response.status_code for response in responses] == [422, 422, 422, 422, 422, 422]


def test_mobile_push_rejects_non_https_subscription_and_disables_without_public_key(monkeypatch, tmp_path):
    client, _default_home, _profiles = _client_for_homes(monkeypatch, tmp_path)
    monkeypatch.setattr(web_server, "_get_mobile_push_public_key", lambda: None)
    disabled = client.get("/api/mobile/push/capability", headers=_headers())
    invalid = client.put("/api/mobile/push/subscription", json={
        "device_id": "device-opaque-123", "endpoint": "http://push.example.test/a",
        "keys": {"p256dh": "A" * 87, "auth": "C" * 22}, "categories": ["warning"],
    }, headers=_headers())
    assert disabled.json() == {"enabled": False, "public_key": None, "preview": False}
    assert invalid.status_code == 422
