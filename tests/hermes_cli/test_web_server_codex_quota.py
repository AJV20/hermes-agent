from datetime import datetime, timezone

from fastapi.testclient import TestClient

from agent.account_usage import AccountUsageSnapshot, AccountUsageWindow
from hermes_cli import web_server


def test_codex_quota_endpoint_requires_dashboard_auth(monkeypatch):
    had_previous = hasattr(web_server.app.state, "auth_required")
    previous = getattr(web_server.app.state, "auth_required", False)
    web_server.app.state.auth_required = False
    try:
        with TestClient(web_server.app) as client:
            response = client.get("/api/mobile/codex-quota")
        assert response.status_code == 401
    finally:
        if had_previous:
            web_server.app.state.auth_required = previous
        else:
            web_server.app.state._state.pop("auth_required", None)


def test_codex_quota_endpoint_serializes_profile_scoped_account_limits(monkeypatch, tmp_path):
    calls = []
    resolved_profiles = []

    def fake_fetch(provider, **kwargs):
        calls.append((provider, kwargs))
        return AccountUsageSnapshot(
            provider="openai-codex",
            source="usage_api",
            fetched_at=datetime(2026, 8, 9, 12, 0, tzinfo=timezone.utc),
            plan="Pro",
            windows=(
                AccountUsageWindow(
                    label="Session",
                    used_percent=20.0,
                    reset_at=datetime(2026, 8, 9, 17, 0, tzinfo=timezone.utc),
                ),
                AccountUsageWindow(label="Weekly", used_percent=55.0),
            ),
            details=("You have 1 reset banked",),
        )

    monkeypatch.setattr("agent.account_usage.fetch_account_usage", fake_fetch)
    profile_dir = tmp_path / "mabel"
    profile_dir.mkdir()

    def fake_resolve_profile(profile):
        resolved_profiles.append(profile)
        return profile_dir

    monkeypatch.setattr(web_server, "_resolve_profile_dir", fake_resolve_profile)
    had_previous = hasattr(web_server.app.state, "auth_required")
    previous = getattr(web_server.app.state, "auth_required", False)
    web_server.app.state.auth_required = False
    try:
        with TestClient(web_server.app) as client:
            response = client.get(
                "/api/mobile/codex-quota?profile=mabel",
                headers={web_server._SESSION_HEADER_NAME: web_server._SESSION_TOKEN},
            )
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.json() == {
            "available": True,
            "details": ["You have 1 reset banked"],
            "fetched_at": "2026-08-09T12:00:00+00:00",
            "plan": "Pro",
            "provider": "openai-codex",
            "windows": [
                {
                    "label": "Session",
                    "reset_at": "2026-08-09T17:00:00+00:00",
                    "used_percent": 20.0,
                },
                {"label": "Weekly", "reset_at": None, "used_percent": 55.0},
            ],
        }
        assert calls == [("openai-codex", {})]
        assert resolved_profiles == ["mabel"]
    finally:
        if had_previous:
            web_server.app.state.auth_required = previous
        else:
            web_server.app.state._state.pop("auth_required", None)
