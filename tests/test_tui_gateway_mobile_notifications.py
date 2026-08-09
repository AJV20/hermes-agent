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
