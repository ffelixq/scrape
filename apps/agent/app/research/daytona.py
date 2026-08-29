import asyncio
import base64
import json
from urllib.parse import urlparse

from app.config import Settings
from app.models import ScrapedDocument, SearchCandidate
from app.research.security import validate_public_url

SANDBOX_WORKER = r"""
import asyncio
import hashlib
import json
import re
import sys
from urllib.parse import urlparse

import fitz
import httpx
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions", re.I),
    re.compile(r"(system|developer)\s+(message|prompt|instructions?)", re.I),
    re.compile(r"reveal\s+(your\s+)?(prompt|secrets?|api\s*keys?)", re.I),
    re.compile(r"execute\s+(this|the following)\s+(command|code)", re.I),
]

def metadata(html, final_url):
    soup = BeautifulSoup(html, "lxml")
    title = (soup.title.string if soup.title and soup.title.string else final_url).strip()
    canonical = soup.find("link", rel=lambda value: value and "canonical" in value)
    canonical_url = canonical.get("href") if canonical else None
    published = None
    for key in ("article:published_time", "datePublished", "date", "publish-date"):
        tag = soup.find("meta", attrs={"property": key}) or soup.find("meta", attrs={"name": key})
        if tag and tag.get("content"):
            published = tag["content"]
            break
    for tag in soup(["script", "style", "noscript", "svg", "nav", "footer", "form"]):
        tag.decompose()
    text = "\n".join(line.strip() for line in soup.get_text("\n").splitlines() if line.strip())
    return title, canonical_url, published, text[:250000]

async def scrape_one(browser, item, maximum):
    page = await browser.new_page(java_script_enabled=True)
    try:
        response = await page.goto(item["url"], wait_until="domcontentloaded", timeout=35000)
        if not response:
            raise RuntimeError("Navigation returned no response")
        content_type = (response.headers.get("content-type") or "text/html").lower()
        final_url = page.url
        status_code = response.status
        if "application/pdf" in content_type or final_url.lower().endswith(".pdf"):
            async with httpx.AsyncClient(timeout=35, follow_redirects=False) as client:
                downloaded = await client.get(final_url)
                downloaded.raise_for_status()
                if len(downloaded.content) > maximum:
                    raise RuntimeError("Document exceeds configured byte limit")
                document = fitz.open(stream=downloaded.content, filetype="pdf")
                text = "\n".join(page.get_text() for page in document)[:250000]
                title = item.get("title") or final_url.rsplit("/", 1)[-1]
                canonical = final_url
                published = item.get("published_at")
        else:
            html = await page.content()
            if len(html.encode("utf-8")) > maximum:
                raise RuntimeError("Page exceeds configured byte limit")
            title, canonical, published, text = metadata(html, final_url)
        findings = [pattern.pattern for pattern in PATTERNS if pattern.search(text)]
        publisher = urlparse(final_url).hostname or "Unknown publisher"
        fingerprint = hashlib.sha256(re.sub(r"\s+", " ", text).lower().encode()).hexdigest()
        return {
            "url": item["url"], "final_url": final_url, "title": title,
            "publisher": publisher, "text": text, "published_at": published,
            "canonical_url": canonical, "content_hash": fingerprint,
            "security_findings": findings, "content_type": content_type,
            "status_code": status_code,
        }
    except Exception as error:
        return {"url": item["url"], "error": str(error)[:500]}
    finally:
        await page.close()

async def main():
    payload = json.loads(__import__("base64").b64decode(sys.argv[1]).decode())
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
        semaphore = asyncio.Semaphore(4)
        async def bounded(item):
            async with semaphore:
                return await scrape_one(browser, item, payload["max_bytes"])
        results = await asyncio.gather(*(bounded(item) for item in payload["items"]))
        await browser.close()
    print("__PROOFLINE_RESULT__" + json.dumps(results, separators=(",", ":")))

asyncio.run(main())
"""


class DaytonaResearchComputer:
    """Runs every untrusted retrieval in a short-lived Daytona sandbox."""

    def __init__(self, settings: Settings):
        self.settings = settings

    async def scrape(self, candidates: list[SearchCandidate]) -> list[ScrapedDocument]:
        safe_candidates: list[SearchCandidate] = []
        for candidate in candidates:
            safety = await asyncio.to_thread(
                validate_public_url,
                str(candidate.url),
                self.settings.allow_private_networks,
            )
            if safety.safe:
                safe_candidates.append(candidate)
        if not safe_candidates:
            return []
        return await asyncio.to_thread(self._run_sync, safe_candidates)

    def _run_sync(self, candidates: list[SearchCandidate]) -> list[ScrapedDocument]:
        from daytona import CreateSandboxFromSnapshotParams, Daytona, DaytonaConfig

        domains = sorted({urlparse(str(item.url)).hostname or "" for item in candidates})
        dependency_domains = [
            "pypi.org",
            "files.pythonhosted.org",
            "cdn.playwright.dev",
            "playwright.download.prss.microsoft.com",
        ]
        allow_list = self.settings.daytona_domain_allow_list or ",".join(
            [*domains, *dependency_domains]
        )
        config = DaytonaConfig(
            api_key=self.settings.daytona_api_key,
            api_url=self.settings.daytona_api_url,
            target=self.settings.daytona_target or None,
        )
        daytona = Daytona(config)
        sandbox = None
        try:
            sandbox = daytona.create(
                CreateSandboxFromSnapshotParams(
                    snapshot=self.settings.daytona_snapshot or None,
                    ephemeral=True,
                    ttl_minutes=self.settings.daytona_sandbox_ttl_minutes,
                    domain_allow_list=allow_list,
                    labels={"app": "proofline", "purpose": "untrusted-research"},
                ),
                timeout=60,
            )
            install = (
                "python -m pip install --quiet playwright beautifulsoup4 lxml pymupdf httpx "
                "&& python -m playwright install chromium --with-deps"
            )
            sandbox.process.exec(
                install,
                timeout=self.settings.daytona_command_timeout_seconds,
            )
            encoded_script = base64.b64encode(SANDBOX_WORKER.encode()).decode()
            payload = base64.b64encode(
                json.dumps(
                    {
                        "max_bytes": self.settings.max_download_bytes,
                        "items": [
                            {
                                "url": str(item.url),
                                "title": item.title,
                                "published_at": item.published_at,
                            }
                            for item in candidates
                        ],
                    }
                ).encode()
            ).decode()
            command = (
                f"echo {encoded_script} | base64 -d > /tmp/proofline_worker.py "
                f"&& python /tmp/proofline_worker.py {payload}"
            )
            response = sandbox.process.exec(
                command,
                timeout=self.settings.daytona_command_timeout_seconds,
            )
            marker = "__PROOFLINE_RESULT__"
            if marker not in response.result:
                raise RuntimeError("Daytona worker returned no validated result")
            raw_results = json.loads(response.result.rsplit(marker, 1)[1].strip())
            documents: list[ScrapedDocument] = []
            for item in raw_results:
                if "error" not in item:
                    documents.append(ScrapedDocument.model_validate(item))
            return documents
        finally:
            if sandbox is not None:
                daytona.delete(sandbox, wait=True, timeout=60)
