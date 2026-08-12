"""Credential-free, SSRF-safe direct HTTP content extraction provider.

This edge provider intentionally offers extraction only: it never treats a
search backend (including SearXNG) as a page-content service.  Every request
is bounded, redirects are followed manually with a fresh URL-policy check, and
the HTTP transport pins each TCP connection to freshly validated DNS answers.
"""

from __future__ import annotations

import asyncio
from html.parser import HTMLParser
import logging
import re
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import urljoin

import httpx

from agent.web_search_provider import WebSearchProvider
from tools.url_safety import async_is_safe_url, create_ssrf_safe_async_client, normalize_url_for_request
from tools.website_policy import check_website_access

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 15.0
MAX_RESPONSE_BYTES = 2_000_000
MAX_REDIRECTS = 5
_ALLOWED_CONTENT_TYPES = ("text/html", "application/xhtml+xml", "text/plain")


class _MarkdownHTMLParser(HTMLParser):
    """Small dependency-free HTML-to-markdown converter for documentation pages."""

    _SKIP_TAGS = {"script", "style", "noscript", "template", "svg"}
    _BLOCK_TAGS = {"p", "div", "section", "article", "header", "footer", "main", "li", "pre", "blockquote"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._skip_depth = 0
        self._heading: Optional[int] = None
        self._link_href: Optional[str] = None
        self._link_text: list[str] = []
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        tag = tag.lower()
        if tag in self._SKIP_TAGS:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag == "title":
            self._in_title = True
        elif tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self._flush_break()
            self._heading = int(tag[1])
        elif tag in self._BLOCK_TAGS or tag == "br":
            self._flush_break()
        elif tag == "a":
            self._link_href = dict(attrs).get("href")
            self._link_text = []

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self._SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth:
            return
        if tag == "title":
            self._in_title = False
        elif tag in {"h1", "h2", "h3", "h4", "h5", "h6"} and self._heading:
            text = "".join(self._link_text).strip()
            if text:
                self._parts.append(f"{'#' * self._heading} {text}")
            self._link_text = []
            self._heading = None
            self._flush_break()
        elif tag == "a":
            text = "".join(self._link_text).strip()
            if text:
                self._parts.append(f"[{text}]({self._link_href})" if self._link_href else text)
            self._link_href = None
            self._link_text = []
        elif tag in self._BLOCK_TAGS:
            self._flush_break()

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        text = " ".join(data.split())
        if not text:
            return
        if self._in_title:
            self.title = " ".join((self.title, text)).strip()
            return
        if self._heading is not None or self._link_href is not None:
            self._link_text.append(text)
        else:
            self._parts.append(text)

    def _flush_break(self) -> None:
        if self._parts and self._parts[-1] != "\n\n":
            self._parts.append("\n\n")

    def markdown(self) -> str:
        text = " ".join(self._parts)
        text = text.replace(" \n\n ", "\n\n").replace(" \n\n", "\n\n").replace("\n\n ", "\n\n")
        text = re.sub(r"\s+([.,;:!?])", r"\1", text)
        return "\n\n".join(part.strip() for part in text.split("\n\n") if part.strip())


class DirectWebExtractProvider(WebSearchProvider):
    """Bounded direct HTTP extractor with no credentials or search capability."""

    def __init__(
        self,
        *,
        client_factory: Callable[..., httpx.AsyncClient] = create_ssrf_safe_async_client,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        max_response_bytes: int = MAX_RESPONSE_BYTES,
    ) -> None:
        self._client_factory = client_factory
        self._timeout_seconds = timeout_seconds
        self._max_response_bytes = max_response_bytes

    @property
    def name(self) -> str:
        return "direct"

    @property
    def display_name(self) -> str:
        return "Direct HTTP Extract"

    def is_available(self) -> bool:
        return True

    def supports_search(self) -> bool:
        return False

    def supports_extract(self) -> bool:
        return True

    async def extract(self, urls: List[str], **kwargs: Any) -> List[Dict[str, Any]]:
        return [await self._extract_one(url) for url in urls]

    async def _extract_one(self, requested_url: str) -> Dict[str, Any]:
        current_url = normalize_url_for_request(requested_url)
        try:
            for redirect_count in range(MAX_REDIRECTS + 1):
                blocked = check_website_access(current_url)
                if blocked:
                    return self._policy_error(current_url, blocked)
                if not await async_is_safe_url(current_url):
                    return self._error(current_url, "Blocked: URL targets a private or internal network address")

                async with self._client_factory(
                    follow_redirects=False,
                    timeout=httpx.Timeout(self._timeout_seconds),
                    headers={"Accept": "text/html, text/plain;q=0.9, application/xhtml+xml;q=0.8", "User-Agent": "Hermes-Agent/1.0 (+https://hermes-agent.nousresearch.com)"},
                ) as client:
                    async with client.stream("GET", current_url) as response:
                        if response.is_redirect:
                            location = response.headers.get("location")
                            if not location:
                                return self._error(current_url, "Redirect response did not include a Location header")
                            if redirect_count == MAX_REDIRECTS:
                                return self._error(current_url, f"Too many redirects (maximum {MAX_REDIRECTS})")
                            current_url = normalize_url_for_request(urljoin(str(response.url), location))
                            continue

                        response.raise_for_status()
                        content_type = response.headers.get("content-type", "").split(";", 1)[0].lower().strip()
                        if content_type not in _ALLOWED_CONTENT_TYPES:
                            return self._error(current_url, f"Unsupported content type: {content_type or 'unknown'}")
                        content_length = response.headers.get("content-length")
                        if content_length and int(content_length) > self._max_response_bytes:
                            return self._error(current_url, f"Response exceeds {self._max_response_bytes:,}-byte limit")

                        body = await self._read_limited(response)
                        text = body.decode(response.encoding or "utf-8", errors="replace")
                        title, content = self._clean_content(text, content_type)
                        return {
                            "url": str(response.url),
                            "title": title,
                            "content": content,
                            "raw_content": content,
                            "metadata": {"content_type": content_type, "sourceURL": str(response.url)},
                        }

                # The redirect loop's only path past the response context is
                # ``continue`` above. Keep a defensive per-URL result should a
                # custom client violate that contract.
                return self._error(current_url, "Redirect request ended unexpectedly")
        except asyncio.TimeoutError:
            return self._error(current_url, f"Request timed out after {self._timeout_seconds:g}s")
        except httpx.TimeoutException:
            return self._error(current_url, f"Request timed out after {self._timeout_seconds:g}s")
        except httpx.HTTPStatusError as exc:
            return self._error(current_url, f"HTTP {exc.response.status_code}")
        except httpx.RequestError as exc:
            logger.debug("Direct extraction request failed for %s: %s", current_url, exc)
            return self._error(current_url, f"Request failed: {exc}")
        except ValueError as exc:
            return self._error(current_url, f"Invalid response: {exc}")
        except Exception as exc:  # noqa: BLE001 - per-URL failures must not abort a batch
            logger.debug("Direct extraction failed for %s: %s", current_url, exc)
            return self._error(current_url, f"Extraction failed: {exc}")

    async def _read_limited(self, response: httpx.Response) -> bytes:
        chunks: list[bytes] = []
        total = 0
        async for chunk in response.aiter_bytes():
            total += len(chunk)
            if total > self._max_response_bytes:
                raise ValueError(f"Response exceeds {self._max_response_bytes:,}-byte limit")
            chunks.append(chunk)
        return b"".join(chunks)

    @staticmethod
    def _clean_content(text: str, content_type: str) -> tuple[str, str]:
        if content_type == "text/plain":
            return "", text.strip()
        parser = _MarkdownHTMLParser()
        parser.feed(text)
        parser.close()
        return parser.title, parser.markdown()

    @staticmethod
    def _error(url: str, message: str) -> Dict[str, Any]:
        return {"url": url, "title": "", "content": "", "raw_content": "", "error": message}

    @staticmethod
    def _policy_error(url: str, blocked: Dict[str, Any]) -> Dict[str, Any]:
        result = DirectWebExtractProvider._error(url, blocked["message"])
        result["blocked_by_policy"] = {
            "host": blocked["host"], "rule": blocked["rule"], "source": blocked["source"],
        }
        return result

    def get_setup_schema(self) -> Dict[str, Any]:
        return {
            "name": self.display_name,
            "badge": "free · no key",
            "tag": "Bounded direct HTTP extraction for HTML and plain-text pages. No search capability.",
            "env_vars": [],
        }
