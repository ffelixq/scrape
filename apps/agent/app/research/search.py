import asyncio
from collections.abc import Iterable
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
        support_queries = [
            f"{question} official filing primary source",
            f"{question} government regulator data",
        ]
        oppose_queries = [
            f"{question} false contradiction investigation",
            f"{question} enforcement warning dispute risk",
        ]
        results = await asyncio.gather(
            *(self._search(query, "SUPPORT") for query in support_queries),
            *(self._search(query, "OPPOSE") for query in oppose_queries),
        )
        return self._deduplicate(item for group in results for item in group)

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
