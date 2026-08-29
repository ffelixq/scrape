import hashlib
import re
from dataclasses import dataclass
from uuid import NAMESPACE_URL, uuid5

from rapidfuzz.fuzz import token_set_ratio

from app.models import ScrapedDocument, SourceRecord, utc_now
from app.research.security import detect_prompt_injection

PRIMARY_HINTS = (
    ".gov",
    "sec.gov",
    "regulator",
    "registry",
    "filing",
    "annual-report",
    "statistics",
    "centralbank",
    "court",
)
AUTHORITATIVE_HINTS = (".edu", "reuters.com", "apnews.com", "ft.com", "bloomberg.com")
LOW_HINTS = ("reddit.com", "medium.com", "blogspot.", "facebook.com", "x.com", "tiktok.com")


@dataclass(frozen=True)
class ProvenanceBundle:
    sources: list[SourceRecord]
    false_consensus_clusters: int
    source_by_url: dict[str, SourceRecord]


def _source_quality(document: ScrapedDocument) -> tuple[str, int, bool]:
    value = f"{document.final_url} {document.title}".lower()
    if any(hint in value for hint in PRIMARY_HINTS):
        return "PRIMARY", 92, True
    if any(hint in value for hint in AUTHORITATIVE_HINTS):
        return "AUTHORITATIVE", 82, False
    if any(hint in value for hint in LOW_HINTS):
        return "LOW", 34, False
    return "SECONDARY", 65, False


def _excerpt(text: str) -> str:
    paragraphs = [
        re.sub(r"\s+", " ", item).strip() for item in text.splitlines() if len(item.strip()) >= 60
    ]
    return (paragraphs[0] if paragraphs else re.sub(r"\s+", " ", text).strip())[:650]


def _initial_group(document: ScrapedDocument) -> str:
    origin = document.canonical_url or str(document.final_url)
    return hashlib.sha1(origin.encode(), usedforsecurity=False).hexdigest()[:12]


def build_provenance(documents: list[ScrapedDocument], investigation_id: str) -> ProvenanceBundle:
    groups: dict[str, list[ScrapedDocument]] = {}
    for document in documents:
        group = _initial_group(document)
        matched_group: str | None = None
        sample = re.sub(r"\s+", " ", document.text[:10_000]).lower()
        for existing_group, members in groups.items():
            other = re.sub(r"\s+", " ", members[0].text[:10_000]).lower()
            if token_set_ratio(sample, other) >= 88:
                matched_group = existing_group
                break
        groups.setdefault(matched_group or group, []).append(document)

    sources: list[SourceRecord] = []
    source_by_url: dict[str, SourceRecord] = {}
    for group, members in groups.items():
        for index, document in enumerate(members):
            tier, base_score, primary = _source_quality(document)
            security_findings = [
                *document.security_findings,
                *detect_prompt_injection(document.text),
            ]
            score = base_score
            if document.published_at:
                score += 2
            if security_findings:
                score -= 10
            if index > 0:
                score -= 16
            source = SourceRecord(
                id=str(uuid5(NAMESPACE_URL, f"{investigation_id}:{document.final_url}")),
                title=document.title[:500],
                publisher=document.publisher,
                url=document.final_url,
                publishedAt=document.published_at,
                accessedAt=utc_now(),
                tier=tier,
                reliabilityScore=max(0, min(100, score)),
                independenceGroup=group,
                isPrimary=primary,
                isDuplicate=index > 0,
                excerpt=_excerpt(document.text),
            )
            sources.append(source)
            source_by_url[str(document.url)] = source
            source_by_url[str(document.final_url)] = source

    false_consensus_clusters = sum(1 for members in groups.values() if len(members) > 1)
    return ProvenanceBundle(sources, false_consensus_clusters, source_by_url)


def independent_source_count(sources: list[SourceRecord]) -> int:
    return len({source.independenceGroup for source in sources})
