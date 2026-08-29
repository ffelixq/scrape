import httpx
import pytest

from app.config import get_settings
from app.models import SearchCandidate
from app.research.search import SearchClient

QUESTION = "Is DBS Group Holdings financially healthy enough to be a supplier?"


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


def _client() -> SearchClient:
    return SearchClient(get_settings().model_copy(update={"search_provider": "tavily"}))


def _candidate() -> SearchCandidate:
    return SearchCandidate(
        url="https://example.com/dbs-annual-report",
        title="DBS Group Holdings annual report",
        snippet="DBS Group Holdings published its annual results.",
        query_role="SUPPORT",
    )


async def test_opaque_provider_urls_are_dropped_instead_of_aborting_the_run() -> None:
    """Tavily returns Google redirect tokens in place of URLs for some results."""
    client = _client()
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


async def test_discovery_survives_individual_query_failures() -> None:
    client = _client()
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


async def test_discovery_fails_loudly_when_every_query_fails() -> None:
    client = _client()

    async def always_fails(_query: str, _role: str) -> list[SearchCandidate]:
        raise httpx.ConnectTimeout("search provider timed out")

    client._search = always_fails  # type: ignore[method-assign]
    try:
        with pytest.raises(RuntimeError, match="Every tavily query failed"):
            await client.discover(QUESTION)
    finally:
        await client.close()
