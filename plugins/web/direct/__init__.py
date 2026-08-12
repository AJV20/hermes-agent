"""Bundled direct HTTP extraction provider."""

from plugins.web.direct.provider import DirectWebExtractProvider


def register(ctx) -> None:
    """Register the credential-free extraction-only provider."""
    ctx.register_web_search_provider(DirectWebExtractProvider())
