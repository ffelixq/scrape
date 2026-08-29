import asyncio
import logging
import re
from collections.abc import Iterable
from datetime import UTC, datetime
from itertools import zip_longest
from urllib.parse import urlsplit, urlunsplit

import httpx
from pydantic import ValidationError

from app.config import Settings
from app.models import SearchCandidate

logger = logging.getLogger(__name__)


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
        )
    except ValidationError:
        logger.warning("Discarded search result with an unusable URL: %.80s", url)
        return None


class SearchClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = httpx.AsyncClient(timeout=25, follow_redirects=False)

    async def close(self) -> None:
        await self.client.aclose()

    async def discover(self, question: str) -> list[SearchCandidate]:
        entity_match = re.match(
            r"(?i)^(?:is|are|should|can|does)\s+(.{3,100}?)"
            r"(?:\s+(?:financially|healthy|safe|reliable|suitable|able|worth|currently)\b|[,?])",
            question.strip(),
        )
        subject = entity_match.group(1).strip() if entity_match else question[:160]
        current_year = datetime.now(UTC).year
        support_queries = [
            f'"{subject}" latest annual report financial results investor relations',
            f'"{subject}" {current_year - 1} annual report PDF',
            f'"{subject}" {current_year} financial results CET1 PDF',
            f'"{subject}" stock exchange filing regulator official',
            f"{question} primary source",
        ]
        oppose_queries = [
            f'"{subject}" enforcement warning credit risk regulatory action',
            f'"{subject}" financial risks contradiction investigation',
            f"{question} opposing evidence material risk",
        ]
        settled = await asyncio.gather(
            *(self._search(query, "SUPPORT") for query in support_queries),
            *(self._search(query, "OPPOSE") for query in oppose_queries),
            return_exceptions=True,
        )
        results: list[list[SearchCandidate]] = []
        failures: list[BaseException] = []
        for group in settled:
            if isinstance(group, BaseException):
                if isinstance(group, asyncio.CancelledError | KeyboardInterrupt | SystemExit):
                    raise group
                logger.warning("Search query failed: %s", type(group).__name__)
                failures.append(group)
                continue
            results.append(group)
        if not results:
            raise RuntimeError(
                f"Every {self.settings.search_provider} query failed; no evidence could be sought"
            ) from (failures[0] if failures else None)
        subject_tokens = {
            token
            for token in re.findall(r"[a-z0-9]+", subject.lower())
            if token not in {"ltd", "limited", "inc", "plc", "pte", "company", "co"}
        }
        filtered_results = [
            [candidate for candidate in group if self._is_relevant(candidate, subject_tokens)]
            for group in results
        ]
        balanced = (
            item for row in zip_longest(*filtered_results) for item in row if item is not None
        )
        return self._deduplicate(balanced)

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

    async def _search(self, query: str, role: str) -> list[SearchCandidate]:
        if self.settings.search_provider == "tavily":
            response = await self.client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": self.settings.tavily_api_key,
                    "query": query,
                    "search_depth": "advanced",
                    "max_results": 8,
                    "include_raw_content": False,
                },
            )
            response.raise_for_status()
            return self._to_candidates(
                response.json().get("results", []),
                url_key="url",
                snippet_key="content",
                published_key="published_date",
                role=role,
            )

        response = await self.client.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": self.settings.serper_api_key},
            json={"q": query, "num": 10},
        )
        response.raise_for_status()
        return self._to_candidates(
            response.json().get("organic", []),
            url_key="link",
            snippet_key="snippet",
            published_key="date",
            role=role,
        )

    @staticmethod
    def _to_candidates(
        results: object,
        *,
        url_key: str,
        snippet_key: str,
        published_key: str,
        role: str,
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
            )
            if candidate is not None:
                candidates.append(candidate)
        return candidates

    def _deduplicate(self, candidates: Iterable[SearchCandidate]) -> list[SearchCandidate]:
        unique: dict[str, SearchCandidate] = {}
        for candidate in candidates:
            key = canonicalize_url(str(candidate.url))
            unique.setdefault(key, candidate)
        return list(unique.values())[: self.settings.max_sources_per_investigation]
