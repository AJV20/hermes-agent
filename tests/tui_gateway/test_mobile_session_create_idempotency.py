"""Mobile first-message recovery must not create a second gateway session."""

from tui_gateway import server


def test_session_create_reuses_mobile_operation_identity(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "_schedule_agent_build", lambda _sid: None)
    monkeypatch.setattr(server, "_schedule_session_cap_enforcement", lambda: None)
    monkeypatch.setattr(server, "_completion_cwd", lambda _params: str(tmp_path))
    monkeypatch.setattr(server, "_profile_home", lambda _profile: None)
    keys = iter(["stored-first", "stored-duplicate"])
    monkeypatch.setattr(server, "_new_session_key", lambda: next(keys))

    params = {
        "cols": 48,
        "mobile_operation_id": "operation-123",
        "source": "web",
        "title": "Recovered first message",
    }
    first = server._methods["session.create"]("first", params)["result"]
    second = server._methods["session.create"]("second", params)["result"]

    try:
        assert second["session_id"] == first["session_id"]
        assert second["stored_session_id"] == first["stored_session_id"]
    finally:
        with server._sessions_lock:
            server._sessions.pop(first["session_id"], None)
            server._sessions.pop(second["session_id"], None)
