from pathlib import Path

import httpx
import pytest

from app.config import get_settings
from app.research.search import SearchClient, SerperProvider, TavilyProvider

QUESTION = "Is DBS Group Holdings financially healthy enough to be a supplier?"
TAVILY_URL = "https://api.tavily.com/search"
SERPER_URL = "https://google.serper.dev/search"


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


def _client(tmp_path: Path, **overrides: object) -> SearchClient:
    update: dict[str, object] = {
        "search_provider": "tavily",
        "tavily_api_key": "test-tavily-key",
        "serper_api_key": "test-serper-key",
        "usage_db_path": tmp_path / "search-usage.sqlite3",
    }
    update.update(overrides)
    return SearchClient(get_settings().model_copy(update=update))


def _tavily_payload(url: str, title: str = "DBS Group Holdings annual report") -> dict:
    return {"results": [{"url": url, "title": title, "content": "DBS Group Holdings results."}]}


def _serper_payload(url: str, title: str = "DBS Group Holdings filing") -> dict:
    return {"organic": [{"link": url, "title": title, "snippet": "DBS Group Holdings filing."}]}


async def test_both_providers_run_for_every_investigation(tmp_path: Path) -> None:
    """Tavily and Serper are two discovery channels, not a primary and a spare.

    Before this, `_search` returned on the first provider that produced results, so a healthy
    Tavily meant Serper was never called and half the configured discovery went unused.
    """
    client = _client(tmp_path)
    requested: list[str] = []

    async def fake_post(url: str, **_kwargs: object) -> _FakeResponse:
        requested.append(url)
        if url == TAVILY_URL:
            return _FakeResponse(_tavily_payload(f"https://example.com/tavily-{len(requested)}"))
        return _FakeResponse(_serper_payload(f"https://example.com/serper-{len(requested)}"))

    client.client.post = fake_post  # type: ignore[method-assign]
    try:
        discovery = await client.discover(QUESTION)
    finally:
        await client.close()

    assert requested.count(TAVILY_URL) == 4
    assert requested.count(SERPER_URL) == 4
    assert discovery.coverage.queriesIssued == 8
    assert set(discovery.coverage.resultsByProvider) == {"tavily", "serper"}
    assert discovery.coverage.resultsByProvider["serper"] > 0


async def test_the_providers_do_not_ask_the_same_questions(tmp_path: Path) -> None:
    """Serper repeating Tavily's query would spend a second credit to rediscover the same page."""
    client = _client(tmp_path)
    try:
        tavily = TavilyProvider(client.settings, client.client, client.ledger)
        serper = SerperProvider(client.settings, client.client, client.ledger)
        tavily_queries = {
            query for query, _role in tavily.plan("DBS Group Holdings", QUESTION, 2026)
        }
        serper_queries = {
            query for query, _role in serper.plan("DBS Group Holdings", QUESTION, 2026)
        }
    finally:
        await client.close()

    assert not tavily_queries & serper_queries
    # Both channels must look for disconfirming evidence, not just the supporting case.
    for provider in (tavily, serper):
        roles = {role for _query, role in provider.plan("DBS Group Holdings", QUESTION, 2026)}
        assert roles == {"SUPPORT", "OPPOSE"}


async def test_the_same_page_found_by_both_providers_counts_once(tmp_path: Path) -> None:
    """Tavily finding Reuters and Serper finding Reuters is one source, never two."""
    client = _client(tmp_path)
    shared = "https://example.com/dbs-annual-report"

    async def fake_post(url: str, **_kwargs: object) -> _FakeResponse:
        if url == TAVILY_URL:
            return _FakeResponse(_tavily_payload(shared))
        return _FakeResponse(_serper_payload(shared))

    client.client.post = fake_post  # type: ignore[method-assign]
    try:
        discovery = await client.discover(QUESTION)
    finally:
        await client.close()

    assert len(discovery.candidates) == 1
    assert discovery.coverage.resultsDiscovered == 8
    assert discovery.coverage.uniqueSources == 1
    assert discovery.coverage.overlappingSources == 1
    # The providers that surfaced it are recorded, but the candidate is still one candidate.
    assert sorted(discovery.candidates[0].providers) == ["serper", "tavily"]


async def test_urls_differing_only_by_trailing_slash_are_one_source(tmp_path: Path) -> None:
    client = _client(tmp_path)

    async def fake_post(url: str, **_kwargs: object) -> _FakeResponse:
        if url == TAVILY_URL:
            return _FakeResponse(_tavily_payload("https://example.com/dbs-report/"))
        return _FakeResponse(_serper_payload("https://example.com/dbs-report"))

    client.client.post = fake_post  # type: ignore[method-assign]
    try:
        discovery = await client.discover(QUESTION)
    finally:
        await client.close()

    assert discovery.coverage.uniqueSources == 1
    assert discovery.coverage.overlappingSources == 1


async def test_one_provider_failing_does_not_stop_the_investigation(tmp_path: Path) -> None:
    """A quota-exhausted Tavily used to end the run; the other channel now carries it."""
    client = _client(tmp_path)

    async def fake_post(url: str, **_kwargs: object) -> _FakeResponse:
        if url == TAVILY_URL:
            return _FakeResponse({}, status_code=429)
        return _FakeResponse(_serper_payload("https://example.com/serper-report"))

    client.client.post = fake_post  # type: ignore[method-assign]
    try:
        discovery = await client.discover(QUESTION)
    finally:
        await client.close()

    assert [str(candidate.url) for candidate in discovery.candidates] == [
        "https://example.com/serper-report"
    ]
    assert discovery.coverage.queriesFailed == 4
    assert discovery.coverage.resultsByProvider["tavily"] == 0


async def test_a_single_configured_provider_still_gets_the_full_query_plan(
    tmp_path: Path,
) -> None:
    """One credential loses coverage breadth, but must not halve the questions asked."""
    client = _client(tmp_path, serper_api_key="")
    requested: list[str] = []

    async def fake_post(url: str, **_kwargs: object) -> _FakeResponse:
        requested.append(url)
        return _FakeResponse(_tavily_payload(f"https://example.com/report-{len(requested)}"))

    client.client.post = fake_post  # type: ignore[method-assign]
    try:
        discovery = await client.discover(QUESTION)
    finally:
        await client.close()

    assert requested == [TAVILY_URL] * 8
    assert discovery.coverage.queriesIssued == 8
    assert set(discovery.coverage.resultsByProvider) == {"tavily"}


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
        tavily = TavilyProvider(client.settings, client.client, client.ledger)
        candidates = await tavily.run("query", "SUPPORT")
    finally:
        await client.close()

    assert [str(candidate.url) for candidate in candidates] == ["https://example.com/report"]
    assert candidates[0].providers == ["tavily"]


async def test_discovery_survives_individual_query_failures(tmp_path: Path) -> None:
    client = _client(tmp_path)
    attempts = {"count": 0}

    async def fake_post(url: str, **_kwargs: object) -> _FakeResponse:
        attempts["count"] += 1
        if attempts["count"] % 2 == 0:
            raise httpx.ConnectTimeout("search provider timed out")
        return _FakeResponse(
            _tavily_payload("https://example.com/dbs-annual-report")
            if url == TAVILY_URL
            else _serper_payload("https://example.com/dbs-annual-report")
        )

    client.client.post = fake_post  # type: ignore[method-assign]
    try:
        discovery = await client.discover(QUESTION)
    finally:
        await client.close()

    assert [str(candidate.url) for candidate in discovery.candidates] == [
        "https://example.com/dbs-annual-report"
    ]
    assert discovery.coverage.queriesFailed == 4


async def test_discovery_fails_loudly_when_every_query_fails(tmp_path: Path) -> None:
    client = _client(tmp_path)

    async def always_fails(*_args: object, **_kwargs: object) -> _FakeResponse:
        raise httpx.ConnectTimeout("search provider timed out")

    client.client.post = always_fails  # type: ignore[method-assign]
    try:
        with pytest.raises(RuntimeError, match="Every search query failed across"):
            await client.discover(QUESTION)
    finally:
        await client.close()


async def test_search_provider_setting_only_decides_which_channel_leads(tmp_path: Path) -> None:
    """SEARCH_PROVIDER orders the merged list; it never decides which provider runs."""
    client = _client(tmp_path, search_provider="serper")
    try:
        assert client._configured_provider_order() == ["serper", "tavily"]
        assert [provider.name for provider in client.providers] == ["serper", "tavily"]
    finally:
        await client.close()
