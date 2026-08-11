import sqlite3

from hermes_cli import mobile_push
from hermes_cli.mobile_notifications import list_notifications
from tui_gateway import server


def test_gateway_notice_is_persisted_before_fanout_and_clear_dismisses(monkeypatch, tmp_path):
    emitted = []
    monkeypatch.setattr(server, "write_json", emitted.append)
    with server._sessions_lock:
        server._sessions["runtime-1"] = {
            "profile_home": str(tmp_path),
            "session_key": "stored/session 1",
        }
    try:
        payload = {
            "id": "credits-low",
            "key": "credits-low",
            "kind": "credits",
            "level": "warning",
            "text": "Credits are running low.",
        }
        server._emit("notification.show", "runtime-1", payload)

        items, total = list_notifications(tmp_path, include_dismissed=False, limit=10)
        assert total == 1
        assert items[0]["body"] == "Credits are running low."
        assert items[0]["profile"] == tmp_path.name
        assert items[0]["session_id"] == "stored/session 1"
        assert items[0]["target"] == "/mobile/chat/stored%2Fsession%201"
        assert emitted[-1]["params"]["type"] == "notification.show"

        server._emit("notification.clear", "runtime-1", {"key": "credits-low"})
        active, active_total = list_notifications(tmp_path, include_dismissed=False, limit=10)
        assert active == []
        assert active_total == 0
        assert emitted[-1]["params"]["type"] == "notification.clear"
    finally:
        with server._sessions_lock:
            server._sessions.pop("runtime-1", None)


def test_gateway_uses_target_profile_vapid_identity_for_profile_local_queue(monkeypatch, tmp_path):
    active_home = tmp_path / "active"
    profile_home = tmp_path / "profile"
    active_home.mkdir()
    profile_home.mkdir()
    (active_home / "config.yaml").write_text(
        "mobile:\n  push:\n    enabled: true\n    vapid_subject: mailto:wrong@example.test\n"
    )
    (profile_home / "config.yaml").write_text(
        "mobile:\n  push:\n    enabled: true\n    vapid_subject: mailto:profile@example.test\n"
    )
    senders = []
    readiness = []
    kicked = []
    scopes = []
    monkeypatch.setattr(server, "_hermes_home", active_home)
    monkeypatch.setattr(server, "write_json", lambda _frame: None)
    monkeypatch.setattr(
        server,
        "build_profile_secret_scope",
        lambda home: scopes.append(home) or {"home": str(home)},
    )
    monkeypatch.setattr(
        mobile_push,
        "is_delivery_ready",
        lambda _getter, *, home, subject: readiness.append((home, subject)) or True,
    )
    monkeypatch.setattr(
        mobile_push,
        "make_pywebpush_sender",
        lambda _getter, *, home, subject: senders.append((home, subject)) or object(),
    )
    monkeypatch.setattr(
        mobile_push,
        "kick_delivery_worker",
        lambda home, *, send: kicked.append((home, send)),
    )
    with server._sessions_lock:
        server._sessions["runtime-push"] = {
            "profile_home": str(profile_home),
            "session_key": "session",
        }
    try:
        server._emit("notification.show", "runtime-push", {"key": "profile-event", "text": "Done"})
    finally:
        with server._sessions_lock:
            server._sessions.pop("runtime-push", None)

    expected = (profile_home, "mailto:profile@example.test")
    assert scopes == [profile_home]
    assert readiness == [expected]
    assert senders == [expected]
    assert kicked and kicked[0][0] == profile_home


def test_gateway_does_not_queue_when_transport_or_vapid_identity_is_unusable(monkeypatch, tmp_path):
    active_home = tmp_path / "active"
    profile_home = tmp_path / "profile"
    active_home.mkdir()
    profile_home.mkdir()
    (active_home / "config.yaml").write_text("mobile:\n  push:\n    enabled: true\n")
    monkeypatch.setattr(server, "_hermes_home", active_home)
    monkeypatch.setattr(server, "write_json", lambda _frame: None)
    monkeypatch.setattr(mobile_push, "_resolve_host_addresses", lambda _host: ["142.250.72.202"])
    monkeypatch.setattr(mobile_push, "is_delivery_ready", lambda _getter, *, home, subject: False)
    mobile_push.upsert_subscription(
        profile_home,
        device_id="disableddevice123",
        endpoint="https://fcm.googleapis.com/push/unavailable",
        p256dh="A" * 87,
        auth="B" * 22,
        categories=["info"],
    )
    with server._sessions_lock:
        server._sessions["runtime-disabled-push"] = {
            "profile_home": str(profile_home),
            "session_key": "session",
        }
    try:
        server._emit("notification.show", "runtime-disabled-push", {"key": "disabled-event", "text": "Saved only"})
    finally:
        with server._sessions_lock:
            server._sessions.pop("runtime-disabled-push", None)

    with sqlite3.connect(profile_home / "mobile_notifications.db") as conn:
        assert conn.execute("SELECT COUNT(*) FROM mobile_push_deliveries").fetchone()[0] == 0


def test_successful_response_completion_persists_generic_chat_notification(monkeypatch, tmp_path):
    emitted = []
    monkeypatch.setattr(server, "write_json", emitted.append)
    with server._sessions_lock:
        server._sessions["runtime-response"] = {
            "profile_home": str(tmp_path),
            "session_key": "stored/response 1",
        }
    try:
        server._emit_mobile_response_completion(
            "runtime-response",
            server._sessions["runtime-response"],
            "turn-marker-1",
            eligible=True,
        )
        server._emit_mobile_response_completion(
            "runtime-response",
            server._sessions["runtime-response"],
            "turn-marker-1",
            eligible=True,
        )

        items, total = list_notifications(tmp_path, include_dismissed=False, limit=10)
        assert total == 1
        assert items[0]["title"] == "Hermes response complete"
        assert items[0]["body"] == "Hermes finished responding."
        assert items[0]["type"] == "response_complete"
        assert items[0]["session_id"] == "stored/response 1"
        assert items[0]["target"] == "/mobile/chat/stored%2Fresponse%201"
        assert "Private answer" not in str(items[0])
        assert emitted[-1]["params"]["type"] == "notification.show"
    finally:
        with server._sessions_lock:
            server._sessions.pop("runtime-response", None)


def test_synthetic_turn_is_not_eligible_for_response_ready_notification(monkeypatch, tmp_path):
    emitted = []
    monkeypatch.setattr(server, "write_json", emitted.append)
    session = {"profile_home": str(tmp_path), "session_key": "stored-synthetic"}
    with server._sessions_lock:
        server._sessions["runtime-synthetic"] = session
    try:
        server._emit_mobile_response_completion(
            "runtime-synthetic", session, "synthetic-marker", eligible=False
        )
        items, total = list_notifications(tmp_path, include_dismissed=False, limit=10)
        assert total == 0
        assert items == []
        assert emitted == []
    finally:
        with server._sessions_lock:
            server._sessions.pop("runtime-synthetic", None)


def test_global_message_complete_does_not_create_response_ready_notification(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "write_json", lambda _frame: None)
    with server._sessions_lock:
        server._sessions["runtime-response-error"] = {
            "profile_home": str(tmp_path),
            "session_key": "stored-error",
        }
    try:
        server._emit("message.complete", "runtime-response-error", {"status": "complete", "text": "Mirrored child response"})
        items, total = list_notifications(tmp_path, include_dismissed=False, limit=10)
        assert items == []
        assert total == 0
    finally:
        with server._sessions_lock:
            server._sessions.pop("runtime-response-error", None)
