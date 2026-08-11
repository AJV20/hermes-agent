"""Mobile first-message recovery must not create a second gateway session."""

from concurrent.futures import ThreadPoolExecutor
import threading

from tui_gateway import server


def test_session_create_reuses_mobile_operation_identity(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "_schedule_agent_build", lambda _sid: None)
    monkeypatch.setattr(server, "_schedule_session_cap_enforcement", lambda: None)
    monkeypatch.setattr(server, "_completion_cwd", lambda _params: str(tmp_path))
    monkeypatch.setattr(server, "_profile_home", lambda _profile: None)
    monkeypatch.setattr(server, "_hermes_home", tmp_path)
    keys = iter(["stored-first", "stored-duplicate"])
    monkeypatch.setattr(server, "_new_session_key", lambda: next(keys))

    params = {
        "cols": 48,
        "mobile_operation_id": "6f434ee8-e020-4b31-9a21-c56c88fbe288",
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


def test_session_create_reuses_durable_identity_after_gateway_restart(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "_schedule_agent_build", lambda _sid: None)
    monkeypatch.setattr(server, "_schedule_session_cap_enforcement", lambda: None)
    monkeypatch.setattr(server, "_completion_cwd", lambda _params: str(tmp_path))
    monkeypatch.setattr(server, "_profile_home", lambda _profile: None)
    monkeypatch.setattr(server, "_hermes_home", tmp_path)
    keys = iter(["stored-before-restart", "stored-after-restart"])
    monkeypatch.setattr(server, "_new_session_key", lambda: next(keys))
    params = {
        "cols": 48,
        "mobile_operation_id": "99e7a76f-62f1-48f7-86dd-b307d4df0ea2",
        "source": "web",
    }

    first = server._methods["session.create"]("before", params)["result"]
    with server._sessions_lock:
        server._sessions.clear()
    second = server._methods["session.create"]("after", params)["result"]
    try:
        assert second["session_id"] == first["session_id"]
        assert second["stored_session_id"] == first["stored_session_id"]
        assert second["session_id"] in server._sessions
    finally:
        with server._sessions_lock:
            server._sessions.pop(first["session_id"], None)


def test_session_create_rejects_non_uuid_mobile_operation_identity(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "_completion_cwd", lambda _params: str(tmp_path))
    monkeypatch.setattr(server, "_profile_home", lambda _profile: None)
    response = server._methods["session.create"]("invalid", {
        "mobile_operation_id": "guessable-operation",
        "source": "web",
    })

    assert response["error"]["code"] == 4002


def test_session_create_reserves_mobile_operation_identity_atomically(monkeypatch, tmp_path):
    workers = 8
    barrier = threading.Barrier(workers)
    monkeypatch.setattr(server, "_schedule_agent_build", lambda _sid: None)
    monkeypatch.setattr(server, "_schedule_session_cap_enforcement", lambda: None)
    monkeypatch.setattr(server, "_profile_home", lambda _profile: None)
    monkeypatch.setattr(server, "_hermes_home", tmp_path)
    monkeypatch.setattr(server, "_new_session_key", lambda: f"stored-{threading.get_ident()}")

    def completion_cwd(_params):
        barrier.wait(timeout=5)
        return str(tmp_path)

    monkeypatch.setattr(server, "_completion_cwd", completion_cwd)
    params = {
        "cols": 48,
        "mobile_operation_id": "7ab0a510-dff6-4c3e-80d1-74b94dac6b10",
        "source": "web",
        "title": "Concurrent recovery",
    }

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda index: server._methods["session.create"](f"rid-{index}", params)["result"], range(workers)))

    session_ids = {result["session_id"] for result in results}
    stored_ids = {result["stored_session_id"] for result in results}
    try:
        assert len(session_ids) == 1
        assert len(stored_ids) == 1
    finally:
        with server._sessions_lock:
            for session_id in session_ids:
                server._sessions.pop(session_id, None)
