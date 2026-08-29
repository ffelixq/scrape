import asyncio
import base64
import json
import re
import time
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

async def scrape_one(client, item, maximum):
    try:
        response = await client.get(item["url"])
        response.raise_for_status()
        content_type = (response.headers.get("content-type") or "text/html").lower()
        final_url = str(response.url)
        status_code = response.status_code
        if "application/pdf" in content_type or final_url.lower().endswith(".pdf"):
            if len(response.content) > maximum:
                raise RuntimeError("Document exceeds configured byte limit")
            document = fitz.open(stream=response.content, filetype="pdf")
            text = "\n".join(pdf_page.get_text() for pdf_page in document)[:250000]
            title = item.get("title") or final_url.rsplit("/", 1)[-1]
            canonical = final_url
            published = item.get("published_at")
        else:
            if len(response.content) > maximum:
                raise RuntimeError("Page exceeds configured byte limit")
            html = response.text
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

async def main():
    payload = json.loads(__import__("base64").b64decode(sys.argv[1]).decode())
    limits = httpx.Limits(max_connections=4, max_keepalive_connections=4)
    headers = {"User-Agent": "Proofline-Evidence-Investigator/1.0"}
    async with httpx.AsyncClient(
        timeout=35,
        follow_redirects=True,
        limits=limits,
        headers=headers,
    ) as client:
        semaphore = asyncio.Semaphore(4)
        async def bounded(item):
            async with semaphore:
                return await scrape_one(client, item, payload["max_bytes"])
        results = await asyncio.gather(*(bounded(item) for item in payload["items"]))
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

        dependency_domains = [
            "pypi.org",
            "files.pythonhosted.org",
        ]
        permitted_domains: list[str] = []
        permitted_candidates: list[SearchCandidate] = []
        for candidate in candidates:
            domain = urlparse(str(candidate.url)).hostname or ""
            if domain not in permitted_domains and len(permitted_domains) >= 18:
                continue
            if domain not in permitted_domains:
                permitted_domains.append(domain)
            permitted_candidates.append(candidate)
        candidates = permitted_candidates

        if self.settings.daytona_domain_allow_list:
            configured_domains = [
                domain.strip()
                for domain in self.settings.daytona_domain_allow_list.split(",")
                if domain.strip()
            ]
            if len(configured_domains) > 20:
                raise RuntimeError("DAYTONA_DOMAIN_ALLOW_LIST cannot contain more than 20 domains")
            allow_list = ",".join(configured_domains)
        else:
            allow_list = ",".join([*permitted_domains, *dependency_domains])
        config = DaytonaConfig(
            api_key=self.settings.daytona_api_key,
            api_url=self.settings.daytona_api_url,
            target=self.settings.daytona_target or None,
        )
        daytona = Daytona(config)
        sandbox = None
        try:
            create_params = CreateSandboxFromSnapshotParams(
                snapshot=self.settings.daytona_snapshot or None,
                ephemeral=True,
                ttl_minutes=self.settings.daytona_sandbox_ttl_minutes,
                domain_allow_list=allow_list,
                labels={"app": "proofline", "purpose": "untrusted-research"},
            )
            for attempt in range(2):
                try:
                    sandbox = daytona.create(create_params, timeout=75)
                    break
                except BaseException as error:
                    if isinstance(error, (KeyboardInterrupt, SystemExit)):
                        raise
                    if attempt == 1:
                        raise RuntimeError(
                            "Daytona sandbox creation failed after two bounded attempts: "
                            f"{type(error).__name__}"
                        ) from error
                    time.sleep(1)
            if sandbox is None:
                raise RuntimeError("Daytona returned no sandbox after creation")
            install = "python -m pip install --quiet beautifulsoup4 lxml pymupdf httpx"
            install_response = sandbox.process.exec(
                install,
                timeout=self.settings.daytona_command_timeout_seconds,
            )
            if install_response.exit_code != 0:
                detail = install_response.result.strip()[-2_000:]
                raise RuntimeError(
                    f"Daytona dependency setup failed (exit {install_response.exit_code}): {detail}"
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
                detail = response.result.strip()[-2_000:]
                raise RuntimeError(
                    f"Daytona worker failed (exit {response.exit_code}): {detail or 'no output'}"
                )
            raw_results = json.loads(response.result.rsplit(marker, 1)[1].strip())
            documents: list[ScrapedDocument] = []
            retrieval_failures: list[str] = []
            for item in raw_results:
                meaningful_text = re.sub(r"\s+", " ", item.get("text", "")).strip()
                if "error" not in item and len(meaningful_text) >= 200:
                    documents.append(ScrapedDocument.model_validate(item))
                elif "error" in item:
                    retrieval_failures.append(f"{item.get('url', 'unknown URL')}: {item['error']}")
                else:
                    retrieval_failures.append(
                        f"{item.get('url', 'unknown URL')}: only "
                        f"{len(meaningful_text)} text characters"
                    )
            if not documents:
                detail = "; ".join(retrieval_failures[:5])
                raise RuntimeError(
                    "Daytona retrieved no evidence-bearing documents. "
                    f"First retrieval results: {detail or 'no worker results'}"
                )
            return documents
        finally:
            if sandbox is not None:
                daytona.delete(sandbox, wait=True, timeout=60)
