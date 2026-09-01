import asyncio
import logging
import re
from abc import ABC, abstractmethod
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from itertools import zip_longest
from typing import ClassVar, Literal
from urllib.parse import urlsplit, urlunsplit

import httpx
from pydantic import ValidationError

from app.config import Settings
from app.models import SearchCandidate, SearchCoverage
from app.usage import UsageLedger

logger = logging.getLogger(__name__)
SearchProvider = Literal["tavily", "serper"]
QueryRole = Literal["SUPPORT", "OPPOSE"]


def canonicalize_url(url: str) -> str:
    parsed = urlsplit(url)
    path = parsed.path.rstrip("/") or "/"
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), path, "", ""))


def _candidate_or_none(
    *,
    url: object,
    title: object,
    snippet: object,
    published_at: object,
    role: str,
    provider: SearchProvider,
) -> SearchCandidate | None:
    """Search providers sometimes return opaque redirect tokens instead of a usable URL.

    A single unusable row must never abort an investigation, so malformed results are
    dropped rather than raised.
    """
    if not isinstance(url, str):
        return None
    try:
        return SearchCandidate(
            url=url,
            title=str(title) if title else url,
            snippet=str(snippet) if snippet else "",
            published_at=str(published_at) if published_at else None,
            query_role=role,
            providers=[provider],
        )
    except ValidationError:
        logger.warning("Discarded search result with an unusable URL: %.80s", url)
        return None


def _to_candidates(
    results: object,
    *,
    url_key: str,
    snippet_key: str,
    published_key: str,
    role: str,
    provider: SearchProvider,
) -> list[SearchCandidate]:
    if not isinstance(results, list):
        return []
    candidates: list[SearchCandidate] = []
    for result in results:
        if not isinstance(result, dict):
            continue
        candidate = _candidate_or_none(
            url=result.get(url_key),
            title=result.get("title"),
            snippet=result.get(snippet_key),
            published_at=result.get(published_key),
            role=role,
            provider=provider,
        )
        if candidate is not None:
            candidates.append(candidate)
    return candidates


class SearchProviderClient(ABC):
    """One discovery channel.

    Providers answer "where should we look?" and nothing more: a result is a lead, never
    evidence, and never a vote towards a verdict. Each provider phrases the investigation in the
    terms it is best at, so the two channels surface different pages rather than the same page
    twice - and where they do agree, the duplicate is merged away rather than counted.
    """

    name: ClassVar[SearchProvider]

    def __init__(self, settings: Settings, client: httpx.AsyncClient, ledger: UsageLedger) -> None:
        self.settings = settings
        self.client = client
        self.ledger = ledger

    @abstractmethod
    def plan(self, subject: str, question: str, year: int) -> list[tuple[str, QueryRole]]:
        """The queries this provider contributes, each tagged with the side it looks for."""

    @abstractmethod
    async def run(self, query: str, role: str) -> list[SearchCandidate]:
        """Execute one query against the provider's API."""


class TavilyProvider(SearchProviderClient):
    """AI-oriented research discovery: broad phrasing over analysis, reporting and context."""

    name = "tavily"

    def plan(self, subject: str, question: str, year: int) -> list[tuple[str, QueryRole]]:
        return [
            (f'"{subject}" financial health revenue profitability liquidity {year}', "SUPPORT"),
            (f"{question} latest results analysis investor relations", "SUPPORT"),
            (f'"{subject}" financial risks debt problems losses', "OPPOSE"),
            (f'"{subject}" revenue decline cash flow problems regulatory action', "OPPOSE"),
        ]

    async def run(self, query: str, role: str) -> list[SearchCandidate]:
        response = await self.client.post(
            "https://api.tavily.com/search",
            json={
                "api_key": self.settings.tavily_api_key,
                "query": query,
                "search_depth": "advanced",
                "max_results": 8,
                "include_raw_content": False,
                "include_usage": True,
            },
        )
        response.raise_for_status()
        payload = response.json()
        raw_credits = payload.get("usage", {}).get("credits", 2)
        credits = int(raw_credits) if isinstance(raw_credits, int | float) else 2
        self.ledger.record_search("tavily", credits)
        self.ledger.set_state("tavily", "available", "Credential verified by search.")
        return _to_candidates(
            payload.get("results", []),
            url_key="url",
            snippet_key="content",
            published_key="published_date",
            role=role,
            provider="tavily",
        )


class SerperProvider(SearchProviderClient):
    """Google-based discovery: the channel that finds specific filings, PDFs and primary docs."""

    name = "serper"

    def plan(self, subject: str, question: str, year: int) -> list[tuple[str, QueryRole]]:
        return [
            (f'"{subject}" annual report {year - 1} financial statements filetype:pdf', "SUPPORT"),
            (f'"{subject}" regulatory filing operating cash flow liabilities', "SUPPORT"),
            (f'"{subject}" financial distress liquidity concerns', "OPPOSE"),
            (f'"{subject}" enforcement action warning bankruptcy risk debt', "OPPOSE"),
        ]

    async def run(self, query: str, role: str) -> list[SearchCandidate]:
        response = await self.client.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": self.settings.serper_api_key},
            json={"q": query, "num": 10},
        )
        response.raise_for_status()
        payload = response.json()
        self.ledger.record_search("serper", 1)
        self.ledger.set_state("serper", "available", "Credential verified by search.")
        return _to_candidates(
            payload.get("organic", []),
            url_key="link",
            snippet_key="snippet",
            published_key="date",
            role=role,
            provider="serper",
        )


PROVIDER_CLASSES: dict[SearchProvider, type[SearchProviderClient]] = {
    "tavily": TavilyProvider,
    "serper": SerperProvider,
}


@dataclass(frozen=True)
class Discovery:
    """What discovery produced, and the arithmetic behind it.

    `coverage` exists so the interface can show that raw result rows are not sources. The funnel
    from rows returned, through unique URLs, to the independent origins the provenance layer
    establishes later is the whole reason for reporting it.
    """

    candidates: list[SearchCandidate]
    coverage: SearchCoverage


class SearchClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        # Deployment-level ordering only. There is no per-investigation choice of provider,
        # because there is no choice to make: both channels run on every investigation.
        self.preferred_provider: SearchProvider = settings.search_provider
        self.ledger = UsageLedger(settings)
        self.client = httpx.AsyncClient(timeout=25, follow_redirects=False)
        self.providers = [
            PROVIDER_CLASSES[name](settings, self.client, self.ledger)
            for name in self._configured_provider_order()
        ]

    async def close(self) -> None:
        await self.client.aclose()

    def _configured_provider_order(self) -> list[SearchProvider]:
        """Configured providers, `SEARCH_PROVIDER` first.

        Order does not decide which provider runs - both do - only which leads the merged list,
        and so which results survive the `max_sources_per_investigation` cut.
        """
        fallback: SearchProvider = "serper" if self.preferred_provider == "tavily" else "tavily"
        credentials: dict[SearchProvider, str] = {
            "tavily": self.settings.tavily_api_key,
            "serper": self.settings.serper_api_key,
        }
        return [
            provider for provider in (self.preferred_provider, fallback) if credentials[provider]
        ]

    @staticmethod
    def _subject(question: str) -> str:
        entity_match = re.match(
            r"(?i)^(?:is|are|should|can|does)\s+(.{3,100}?)"
            r"(?:\s+(?:financially|healthy|safe|reliable|suitable|able|worth|currently)\b|[,?])",
            question.strip(),
        )
        return entity_match.group(1).strip() if entity_match else question[:160]

    def _plan(self, question: str) -> list[tuple[SearchProviderClient, str, str]]:
        """Every (provider, query, role) pair this investigation will issue.

        Each provider contributes its own phrasing of the same investigation, so the two channels
        look in different places instead of asking the same question twice. A deployment with only
        one credential also picks up the absent provider's queries, so it loses coverage breadth
        but not query breadth.
        """
        subject = self._subject(question)
        year = datetime.now(UTC).year
        planned: list[tuple[SearchProviderClient, str, str]] = []
        for provider in self.providers:
            queries = list(provider.plan(subject, question, year))
            if len(self.providers) == 1:
                absent = PROVIDER_CLASSES["serper" if provider.name == "tavily" else "tavily"]
                # Only the absent provider's phrasing is borrowed; its API is never called.
                queries += absent(self.settings, self.client, self.ledger).plan(
                    subject, question, year
                )
            planned.extend((provider, query, role) for query, role in queries)
        return planned

    async def discover(self, question: str) -> Discovery:
        planned = self._plan(question)
        if not planned:
            raise RuntimeError("No search provider credential is configured")

        settled = await asyncio.gather(
            *(self._run_query(provider, query, role) for provider, query, role in planned),
            return_exceptions=True,
        )

        groups: list[list[SearchCandidate]] = []
        rows_by_provider: dict[str, int] = {provider.name: 0 for provider in self.providers}
        failures: list[BaseException] = []
        for (provider, _query, _role), group in zip(planned, settled, strict=True):
            if isinstance(group, BaseException):
                if isinstance(group, asyncio.CancelledError | KeyboardInterrupt | SystemExit):
                    raise group
                logger.warning("%s search query failed: %s", provider.name, type(group).__name__)
                failures.append(group)
                continue
            rows_by_provider[provider.name] += len(group)
            groups.append(group)

        # One provider being down is survivable precisely because the other already ran; the
        # investigation only stops when no query anywhere produced a lead.
        if not groups:
            raise RuntimeError(
                "Every search query failed across the configured providers; "
                "no evidence could be sought"
            ) from (failures[0] if failures else None)

        subject_tokens = self._subject_tokens(self._subject(question))
        relevant = [
            [candidate for candidate in group if self._is_relevant(candidate, subject_tokens)]
            for group in groups
        ]
        # Interleave the query groups so no single query - or provider - fills the whole budget.
        balanced = (item for row in zip_longest(*relevant) for item in row if item is not None)
        merged = self._merge(balanced)

        coverage = SearchCoverage(
            resultsDiscovered=sum(rows_by_provider.values()),
            uniqueSources=len(merged),
            resultsByProvider=rows_by_provider,
            overlappingSources=sum(1 for candidate in merged if len(candidate.providers) > 1),
            queriesIssued=len(planned),
            queriesFailed=len(failures),
        )
        return Discovery(
            candidates=merged[: self.settings.max_sources_per_investigation],
            coverage=coverage,
        )

    async def _run_query(
        self, provider: SearchProviderClient, query: str, role: str
    ) -> list[SearchCandidate]:
        try:
            return await provider.run(query, role)
        except Exception as error:
            status = getattr(getattr(error, "response", None), "status_code", None)
            provider_status = "needs_attention" if status in {401, 403} else "unavailable"
            self.ledger.set_state(
                provider.name,
                provider_status,
                f"Search failed ({type(error).__name__}).",
            )
            raise

    @staticmethod
    def _subject_tokens(subject: str) -> set[str]:
        return {
            token
            for token in re.findall(r"[a-z0-9]+", subject.lower())
            if token not in {"ltd", "limited", "inc", "plc", "pte", "company", "co"}
        }

    @staticmethod
    def _is_relevant(candidate: SearchCandidate, subject_tokens: set[str]) -> bool:
        if not subject_tokens:
            return True
        hostname = (urlsplit(str(candidate.url)).hostname or "").lower()
        if any(token in hostname for token in subject_tokens):
            return True
        haystack = f"{candidate.title} {candidate.snippet}".lower()
        overlap = sum(token in haystack for token in subject_tokens)
        required = 2 if len(subject_tokens) >= 2 else 1
        return overlap >= required

    @staticmethod
    def _merge(candidates: Iterable[SearchCandidate]) -> list[SearchCandidate]:
        """Collapse the two channels onto one list of unique URLs.

        Both providers returning the same page is the ordinary case and must never read as two
        findings. The providers that surfaced a URL are recorded on the candidate instead, which
        is discovery metadata and says nothing about independence - a question only
        `build_provenance` answers, and only from the documents actually retrieved.
        """
        unique: dict[str, SearchCandidate] = {}
        for candidate in candidates:
            key = canonicalize_url(str(candidate.url))
            existing = unique.get(key)
            if existing is None:
                unique[key] = candidate
                continue
            for provider in candidate.providers:
                if provider not in existing.providers:
                    existing.providers.append(provider)
        return list(unique.values())
