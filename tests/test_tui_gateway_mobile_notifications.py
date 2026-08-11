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


def test_gateway_uses_one_active_home_vapid_identity_for_profile_local_queue(monkeypatch, tmp_path):
    active_home = tmp_path / "active"
    profile_home = tmp_path / "profile"
    active_home.mkdir()
    profile_home.mkdir()
    (active_home / "config.yaml").write_text(
        "mobile:\n  push:\n    enabled: true\n    vapid_subject: mailto:test@example.test\n"
    )
    senders = []
    kicked = []
    monkeypatch.setattr(server, "_hermes_home", active_home)
    monkeypatch.setattr(server, "write_json", lambda _frame: None)
    monkeypatch.setattr(mobile_push, "make_pywebpush_sender", lambda _getter, *, home, subject: senders.append((home, subject)) or object())
    monkeypatch.setattr(mobile_push, "kick_delivery_worker", lambda home, *, send: kicked.append((home, send)))
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

    assert senders == [(active_home, "mailto:test@example.test")]
    assert kicked and kicked[0][0] == profile_home
