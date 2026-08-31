from pathlib import Path

import httpx
import pytest

from app.config import get_settings
from app.models import SearchCandidate
from app.research.search import SearchClient

QUESTION = "Is DBS Group Holdings financially healthy enough to be a supplier?"


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code < 400:
            return None
        request = httpx.Request("POST", "https://search-provider.test")
        response = httpx.Response(self.status_code, request=request)
        raise httpx.HTTPStatusError(
            "search provider rejected the request",
            request=request,
            response=response,
        )

    def json(self) -> dict:
        return self._payload


def _client(tmp_path: Path) -> SearchClient:
    return SearchClient(
        get_settings().model_copy(
            update={
                "search_provider": "tavily",
                "tavily_api_key": "test-tavily-key",
                "serper_api_key": "test-serper-key",
                "usage_db_path": tmp_path / "search-usage.sqlite3",
            }
        )
    )


def _candidate() -> SearchCandidate:
    return SearchCandidate(
        url="https://example.com/dbs-annual-report",
        title="DBS Group Holdings annual report",
        snippet="DBS Group Holdings published its annual results.",
        query_role="SUPPORT",
    )


async def test_opaque_provider_urls_are_dropped_instead_of_aborting_the_run(
    tmp_path: Path,
) -> None:
    """Tavily returns Google redirect tokens in place of URLs for some results."""
    client = _client(tmp_path)
    payload = {
        "results": [
            {"url": "CAESpwIB6zswFRfWnhNNmGLiXYQy44gkRkIdUqJ6", "title": "Redirect token"},
            {"url": "https://example.com/report", "title": "Filed results", "content": "text"},
            {"title": "Result with no url at all", "content": "text"},
            {"url": None, "title": "Null url", "content": "text"},
            "not-a-dict",
        ]
    }

    async def fake_post(*_args: object, **_kwargs: object) -> _FakeResponse:
        return _FakeResponse(payload)

    client.client.post = fake_post  # type: ignore[method-assign]
    try:
        candidates = await client._search("query", "SUPPORT")
    finally:
        await client.close()

    assert [str(candidate.url) for candidate in candidates] == ["https://example.com/report"]


async def test_discovery_survives_individual_query_failures(tmp_path: Path) -> None:
    client = _client(tmp_path)
    attempts = {"count": 0}

    async def fake_search(_query: str, _role: str) -> list[SearchCandidate]:
        attempts["count"] += 1
        if attempts["count"] % 2 == 0:
            raise httpx.ConnectTimeout("search provider timed out")
        return [_candidate()]

    client._search = fake_search  # type: ignore[method-assign]
    try:
        candidates = await client.discover(QUESTION)
    finally:
        await client.close()

    assert [str(candidate.url) for candidate in candidates] == [
        "https://example.com/dbs-annual-report"
    ]


async def test_tavily_quota_failure_falls_back_to_serper(tmp_path: Path) -> None:
    client = _client(tmp_path)
    requested_urls: list[str] = []

    async def fake_post(url: str, **_kwargs: object) -> _FakeResponse:
        requested_urls.append(url)
        if "tavily" in url:
            return _FakeResponse({}, status_code=429)
        return _FakeResponse(
            {
                "organic": [
                    {
                        "link": "https://example.com/serper-report",
                        "title": "DBS Group Holdings report",
                        "snippet": "DBS Group Holdings annual results.",
                    }
                ]
            }
        )

    client.client.post = fake_post  # type: ignore[method-assign]
    try:
        candidates = await client._search("query", "SUPPORT")
    finally:
        await client.close()

    assert requested_urls == [
        "https://api.tavily.com/search",
        "https://google.serper.dev/search",
    ]
    assert [str(candidate.url) for candidate in candidates] == ["https://example.com/serper-report"]


async def test_empty_tavily_results_fall_back_to_serper(tmp_path: Path) -> None:
    client = _client(tmp_path)
    requested_urls: list[str] = []

    async def fake_post(url: str, **_kwargs: object) -> _FakeResponse:
        requested_urls.append(url)
        if "tavily" in url:
            return _FakeResponse({"results": []})
        return _FakeResponse(
            {
                "organic": [
                    {
                        "link": "https://example.com/fallback-report",
                        "title": "Fallback report",
                        "snippet": "Fallback evidence.",
                    }
                ]
            }
        )

    client.client.post = fake_post  # type: ignore[method-assign]
    try:
        candidates = await client._search("query", "OPPOSE")
    finally:
        await client.close()

    assert len(candidates) == 1
    assert requested_urls[-1] == "https://google.serper.dev/search"


async def test_successful_tavily_search_does_not_spend_serper_credit(tmp_path: Path) -> None:
    client = _client(tmp_path)
    requested_urls: list[str] = []

    async def fake_post(url: str, **_kwargs: object) -> _FakeResponse:
        requested_urls.append(url)
        return _FakeResponse(
            {
                "results": [
                    {
                        "url": "https://example.com/tavily-report",
                        "title": "Tavily report",
                        "content": "Primary search evidence.",
                    }
                ]
            }
        )

    client.client.post = fake_post  # type: ignore[method-assign]
    try:
        candidates = await client._search("query", "SUPPORT")
    finally:
        await client.close()

    assert len(candidates) == 1
    assert requested_urls == ["https://api.tavily.com/search"]


async def test_requested_search_provider_runs_first(tmp_path: Path) -> None:
    client = _client(tmp_path)
    client.preferred_provider = "serper"
    try:
        assert client._configured_provider_order() == ["serper", "tavily"]
    finally:
        await client.close()


async def test_discovery_fails_loudly_when_every_query_fails(tmp_path: Path) -> None:
    client = _client(tmp_path)

    async def always_fails(_query: str, _role: str) -> list[SearchCandidate]:
        raise httpx.ConnectTimeout("search provider timed out")

    client._search = always_fails  # type: ignore[method-assign]
    try:
        with pytest.raises(RuntimeError, match="Every search query failed across"):
            await client.discover(QUESTION)
    finally:
        await client.close()
