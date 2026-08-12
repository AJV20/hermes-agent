"""TDD coverage for the credential-free direct web extraction plugin."""

import httpx
import pytest

from agent import web_search_registry
from tests.tools.conftest import register_all_web_providers


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_direct_extract_returns_clean_markdown_for_html(monkeypatch):
    from plugins.web.direct.provider import DirectWebExtractProvider

    async def allow_public_url(url: str) -> bool:
        return True

    monkeypatch.setattr("plugins.web.direct.provider.async_is_safe_url", allow_public_url)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        return httpx.Response(
            200,
            headers={"content-type": "text/html; charset=utf-8"},
            text="<html><head><title>Docs</title></head><body><h1>Getting started</h1><p>Install <a href=\"/guide\">the guide</a>.</p><script>ignore()</script></body></html>",
            request=request,
        )

    def client_factory(**kwargs):
        return httpx.AsyncClient(transport=httpx.MockTransport(handler), **kwargs)

    result = await DirectWebExtractProvider(client_factory=client_factory).extract(
        ["https://docs.example.test/start"]
    )

    assert result == [{
        "url": "https://docs.example.test/start",
        "title": "Docs",
        "content": "# Getting started\n\nInstall [the guide](/guide).",
        "raw_content": "# Getting started\n\nInstall [the guide](/guide).",
        "metadata": {"content_type": "text/html", "sourceURL": "https://docs.example.test/start"},
    }]


@pytest.mark.anyio
async def test_direct_extract_blocks_private_url_before_request(monkeypatch):
    from plugins.web.direct.provider import DirectWebExtractProvider

    async def block_private_url(url: str) -> bool:
        return False

    monkeypatch.setattr("plugins.web.direct.provider.async_is_safe_url", block_private_url)

    def forbidden_client_factory(**kwargs):
        pytest.fail("direct HTTP client must not be created for a private URL")

    result = await DirectWebExtractProvider(client_factory=forbidden_client_factory).extract(
        ["http://127.0.0.1/admin"]
    )

    assert result[0]["error"] == "Blocked: URL targets a private or internal network address"


@pytest.mark.anyio
async def test_direct_extract_blocks_redirect_to_private_url(monkeypatch):
    from plugins.web.direct.provider import DirectWebExtractProvider

    checked_urls = []

    async def safe_only_public(url: str) -> bool:
        checked_urls.append(url)
        return url != "http://127.0.0.1/secret"

    monkeypatch.setattr("plugins.web.direct.provider.async_is_safe_url", safe_only_public)

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://public.example.test/start"
        return httpx.Response(302, headers={"location": "http://127.0.0.1/secret"}, request=request)

    def client_factory(**kwargs):
        return httpx.AsyncClient(transport=httpx.MockTransport(handler), **kwargs)

    result = await DirectWebExtractProvider(client_factory=client_factory).extract(
        ["https://public.example.test/start"]
    )

    assert checked_urls == ["https://public.example.test/start", "http://127.0.0.1/secret"]
    assert result[0]["url"] == "http://127.0.0.1/secret"
    assert result[0]["error"] == "Blocked: URL targets a private or internal network address"


@pytest.mark.anyio
async def test_direct_extract_rejects_oversized_response(monkeypatch):
    from plugins.web.direct.provider import DirectWebExtractProvider

    async def allow_public_url(url: str) -> bool:
        return True

    monkeypatch.setattr("plugins.web.direct.provider.async_is_safe_url", allow_public_url)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/plain", "content-length": "11"},
            content=b"01234567890",
            request=request,
        )

    def client_factory(**kwargs):
        return httpx.AsyncClient(transport=httpx.MockTransport(handler), **kwargs)

    result = await DirectWebExtractProvider(
        client_factory=client_factory, max_response_bytes=10
    ).extract(["https://docs.example.test/large"])

    assert result[0]["error"] == "Response exceeds 10-byte limit"


@pytest.mark.anyio
async def test_direct_extract_rejects_binary_content(monkeypatch):
    from plugins.web.direct.provider import DirectWebExtractProvider

    async def allow_public_url(url: str) -> bool:
        return True

    monkeypatch.setattr("plugins.web.direct.provider.async_is_safe_url", allow_public_url)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "application/pdf"},
            content=b"%PDF-1.7",
            request=request,
        )

    def client_factory(**kwargs):
        return httpx.AsyncClient(transport=httpx.MockTransport(handler), **kwargs)

    result = await DirectWebExtractProvider(client_factory=client_factory).extract(
        ["https://docs.example.test/file.pdf"]
    )

    assert result[0]["error"] == "Unsupported content type: application/pdf"


@pytest.mark.anyio
async def test_direct_extract_reports_timeout_and_keeps_other_url_results(monkeypatch):
    from plugins.web.direct.provider import DirectWebExtractProvider

    async def allow_public_url(url: str) -> bool:
        return True

    monkeypatch.setattr("plugins.web.direct.provider.async_is_safe_url", allow_public_url)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/slow":
            raise httpx.ReadTimeout("simulated timeout", request=request)
        return httpx.Response(
            200,
            headers={"content-type": "text/plain; charset=utf-8"},
            text="Plain documentation text.",
            request=request,
        )

    def client_factory(**kwargs):
        return httpx.AsyncClient(transport=httpx.MockTransport(handler), **kwargs)

    result = await DirectWebExtractProvider(client_factory=client_factory, timeout_seconds=3).extract([
        "https://docs.example.test/slow",
        "https://docs.example.test/plain",
    ])

    assert result[0]["error"] == "Request timed out after 3s"
    assert result[1]["content"] == "Plain documentation text."
    assert result[1]["title"] == ""


def test_direct_provider_is_extract_only_and_available_without_credentials():
    from plugins.web.direct.provider import DirectWebExtractProvider

    provider = DirectWebExtractProvider()

    assert provider.is_available() is True
    assert provider.supports_search() is False
    assert provider.supports_extract() is True


def test_explicit_direct_extract_backend_resolves_without_reinterpreting_searxng(monkeypatch):
    from agent.web_search_registry import _reset_for_tests, get_active_extract_provider, register_provider
    from plugins.web.direct.provider import DirectWebExtractProvider
    from plugins.web.searxng.provider import SearXNGWebSearchProvider

    _reset_for_tests()
    register_provider(SearXNGWebSearchProvider())
    register_provider(DirectWebExtractProvider())
    monkeypatch.setattr(
        "agent.web_search_registry._read_config_key",
        lambda *path: "direct" if path == ("web", "extract_backend") else None,
    )
    try:
        assert get_active_extract_provider().name == "direct"
    finally:
        _reset_for_tests()
        register_all_web_providers()


@pytest.mark.anyio
async def test_direct_extract_tool_uses_explicit_backend_without_credentials(monkeypatch):
    import json

    from agent.web_search_registry import _reset_for_tests, register_provider
    from plugins.web.direct.provider import DirectWebExtractProvider
    from tools import web_tools

    _reset_for_tests()
    provider = DirectWebExtractProvider()
    register_provider(provider)
    monkeypatch.setattr(web_tools, "_ensure_web_plugins_loaded", lambda: None)
    monkeypatch.setattr(web_tools, "_load_web_config", lambda: {"extract_backend": "direct"})

    async def allow_public_url(url: str) -> bool:
        return True

    async def fake_extract(urls, **kwargs):
        return [{"url": urls[0], "title": "Direct", "content": "ok", "raw_content": "ok"}]

    monkeypatch.setattr(web_tools, "async_is_safe_url", allow_public_url)
    monkeypatch.setattr(provider, "extract", fake_extract)
    try:
        result = json.loads(await web_tools.web_extract_tool(["https://docs.example.test/page"]))
        assert result["results"] == [{
            "url": "https://docs.example.test/page", "title": "Direct", "content": "ok", "error": None,
        }]
    finally:
        _reset_for_tests()
        register_all_web_providers()


def test_bundled_provider_fixture_registers_direct_extractor():
    web_search_registry._reset_for_tests()
    try:
        register_all_web_providers()
        assert web_search_registry.get_provider("direct") is not None
    finally:
        web_search_registry._reset_for_tests()
