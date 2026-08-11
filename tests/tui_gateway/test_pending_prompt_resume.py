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
    entries = [
        approval._ApprovalEntry({"command": "first command", "description": "first", "allow_permanent": False}),
        approval._ApprovalEntry({"command": "second command", "description": "second"}),
    ]
    approval._gateway_queues["stored-session"] = entries
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
            "request_id": entries[0].data["request_id"],
        },
    }
    assert "second command" not in repr(payload)


def test_stale_approval_request_id_cannot_resolve_the_hidden_fifo_head():
    first = approval._ApprovalEntry({"command": "first"})
    second = approval._ApprovalEntry({"command": "second"})
    approval._gateway_queues["request-bound"] = [first, second]
    try:
        assert approval.resolve_gateway_approval(
            "request-bound", "once", expected_request_id=second.data["request_id"]
        ) == 0
        assert approval._gateway_queues["request-bound"] == [first, second]
        assert not first.event.is_set()
        assert approval.resolve_gateway_approval(
            "request-bound", "once", expected_request_id=first.data["request_id"]
        ) == 1
        assert approval._gateway_queues["request-bound"] == [second]
        assert first.event.is_set()
        assert not second.event.is_set()
    finally:
        approval._gateway_queues.pop("request-bound", None)


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
