import threading

from tools import approval
from tui_gateway import server


def test_live_session_payload_recovers_safe_pending_clarify_after_reconnect(monkeypatch):
    session = {
        "created_at": 1.0,
        "display_history_prefix": [],
        "history": [],
        "history_lock": threading.RLock(),
        "running": True,
        "session_key": "stored-session",
    }
    request_id = "request-1"
    server._pending[request_id] = ("runtime-1", threading.Event())
    server._pending_prompt_payloads[request_id] = (
        "clarify.request",
        {
            "request_id": request_id,
            "question": "Which environment?",
            "choices": ["staging", "production"],
            "multi_select": False,
        },
    )
    monkeypatch.setattr(server, "_get_db", lambda: None)
    monkeypatch.setattr(server, "_fallback_session_info", lambda _session: {})

    payload = server._live_session_payload("runtime-1", session, omit_messages=True)

    assert payload["pending_prompt"] == {
        "type": "clarify.request",
        "payload": {
            "request_id": request_id,
            "question": "Which environment?",
            "choices": ["staging", "production"],
            "multi_select": False,
        },
    }


def test_live_session_payload_recovers_oldest_pending_approval_after_reconnect(monkeypatch):
    session = {
        "created_at": 1.0,
        "display_history_prefix": [],
        "history": [],
        "history_lock": threading.RLock(),
        "running": True,
        "session_key": "stored-session",
    }
    approval._gateway_queues["stored-session"] = [
        approval._ApprovalEntry({"command": "first command", "description": "first", "allow_permanent": False}),
        approval._ApprovalEntry({"command": "second command", "description": "second"}),
    ]
    monkeypatch.setattr(server, "_get_db", lambda: None)
    monkeypatch.setattr(server, "_fallback_session_info", lambda _session: {})
    try:
        payload = server._live_session_payload("runtime-1", session, omit_messages=True)
    finally:
        approval._gateway_queues.pop("stored-session", None)

    assert payload["pending_prompt"] == {
        "type": "approval.request",
        "payload": {
            "allow_permanent": False,
            "choices": ["once", "session", "deny"],
            "command": "first command",
            "description": "first",
        },
    }
    assert "second command" not in repr(payload)


def test_live_session_payload_never_replays_sensitive_prompt_payload(monkeypatch):
    session = {
        "created_at": 1.0,
        "display_history_prefix": [],
        "history": [],
        "history_lock": threading.RLock(),
        "running": True,
        "session_key": "stored-session",
    }
    request_id = "secret-1"
    server._pending[request_id] = ("runtime-1", threading.Event())
    server._pending_prompt_payloads[request_id] = (
        "secret.request",
        {
            "request_id": request_id,
            "env_var": "API_TOKEN",
            "prompt": "paste the token",
        },
    )
    monkeypatch.setattr(server, "_get_db", lambda: None)
    monkeypatch.setattr(server, "_fallback_session_info", lambda _session: {})

    payload = server._live_session_payload("runtime-1", session, omit_messages=True)

    assert payload["pending_prompt"] == {
        "type": "sensitive.request",
        "payload": {"request_id": request_id},
    }
    assert "API_TOKEN" not in repr(payload)
    assert "paste the token" not in repr(payload)
