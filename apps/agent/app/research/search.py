import asyncio
import re
from collections.abc import Iterable
from datetime import UTC, datetime
from itertools import zip_longest
from urllib.parse import urlsplit, urlunsplit

import httpx

from app.config import Settings
from app.models import SearchCandidate


def canonicalize_url(url: str) -> str:
    parsed = urlsplit(url)
    path = parsed.path.rstrip("/") or "/"
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), path, "", ""))


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
        results = await asyncio.gather(
            *(self._search(query, "SUPPORT") for query in support_queries),
            *(self._search(query, "OPPOSE") for query in oppose_queries),
        )
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
            item
            for row in zip_longest(*filtered_results)
            for item in row
            if item is not None
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
            return [
                SearchCandidate(
                    url=result["url"],
                    title=result.get("title") or result["url"],
                    snippet=result.get("content", ""),
                    published_at=result.get("published_date"),
                    query_role=role,
                )
                for result in response.json().get("results", [])
            ]

        response = await self.client.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": self.settings.serper_api_key},
            json={"q": query, "num": 10},
        )
        response.raise_for_status()
        return [
            SearchCandidate(
                url=result["link"],
                title=result.get("title") or result["link"],
                snippet=result.get("snippet", ""),
                published_at=result.get("date"),
                query_role=role,
            )
            for result in response.json().get("organic", [])
        ]

    def _deduplicate(self, candidates: Iterable[SearchCandidate]) -> list[SearchCandidate]:
        unique: dict[str, SearchCandidate] = {}
        for candidate in candidates:
            key = canonicalize_url(str(candidate.url))
            unique.setdefault(key, candidate)
        return list(unique.values())[: self.settings.max_sources_per_investigation]
