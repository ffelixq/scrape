import asyncio
from uuid import NAMESPACE_URL, uuid4, uuid5

from rapidfuzz import process

from app.config import Settings
from app.models import (
    AgentFindings,
    AuditDecision,
    ClaimRecord,
    ContradictionRecord,
    EvidenceRecord,
    InvestigationRequest,
    InvestigationResult,
    ScrapedDocument,
    SecurityEventRecord,
    SourceRecord,
    utc_now,
)
from app.providers import get_llm, get_nosana_llm
from app.research.daytona import DaytonaResearchComputer
from app.research.provenance import build_provenance, independent_source_count
from app.research.search import SearchClient
from app.research.security import quote_untrusted

SUPPORT_PROMPT = """
Act as the supporting research agent. Find the strongest evidence that would support the user's
proposition, but do not advocate beyond the evidence. Prefer primary sources, exact excerpts, and
current dates. Explain missing support. Return only source URLs included in the evidence bundle.
"""

SKEPTIC_PROMPT = """
Act as an adversarial skeptic running on independent Nosana GPU compute. Try to prove the proposed
conclusion wrong. Search the supplied evidence for counterexamples, newer disclosures, definition
changes, copied claims, weak provenance, and absent primary support. Do not invent contradictions.
Return only source URLs included in the evidence bundle.
"""

AUDITOR_PROMPT = """
Act as the final evidence auditor. Reconcile the supporter and skeptic reports against the source
bundle. Authority is an indicator, never proof. Ten derivative pages count as one origin. Explain
date, currency, definition, period, and methodology differences instead of averaging conflicts.
Use UNVERIFIABLE or INCONCLUSIVE whenever the available evidence cannot support a decision. The
answer must be concise, decision-useful, and explicit about what evidence would change the verdict.
"""


def _evidence_bundle(question: str, documents: list[ScrapedDocument]) -> str:
    parts = [f"QUESTION:\n{question}\n\nEVIDENCE SOURCES:"]
    for index, document in enumerate(documents, 1):
        parts.append(
            "\n".join(
                [
                    f"SOURCE {index}",
                    f"URL: {document.final_url}",
                    f"TITLE: {document.title}",
                    f"PUBLISHER: {document.publisher}",
                    f"PUBLISHED: {document.published_at or 'unknown'}",
                    f"SECURITY FLAGS: {len(document.security_findings)}",
                    quote_untrusted(document.text, 12_000),
                ]
            )
        )
    return "\n\n".join(parts)[:140_000]


def _find_source(url: str, source_by_url: dict[str, SourceRecord]) -> SourceRecord | None:
    if url in source_by_url:
        return source_by_url[url]
    normalized = url.rstrip("/")
    for candidate, source in source_by_url.items():
        if candidate.rstrip("/") == normalized:
            return source
    return None


def _strength(evidence: list[EvidenceRecord], sources: dict[str, SourceRecord]) -> int:
    if not evidence:
        return 18
    weights = [item.weight for item in evidence]
    groups = {
        sources[item.sourceId].independenceGroup for item in evidence if item.sourceId in sources
    }
    breadth = min(24, len(groups) * 8)
    quality = sum(weights) / len(weights) * 66
    return max(20, min(96, round(quality + breadth)))


def _best_excerpt(
    url: str,
    findings: list,
    source: SourceRecord,
) -> tuple[str, str]:
    for finding in findings:
        if finding.source_url.rstrip("/") == url.rstrip("/"):
            return finding.excerpt[:1_200], finding.location[:250]
    return source.excerpt, "Source excerpt"


class ResearchOrchestrator:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def investigate(self, request: InvestigationRequest) -> InvestigationResult:
        if self.settings.demo_mode:
            return self._demo_result(request)

        self.settings.require_live_credentials()
        search = SearchClient(self.settings)
        try:
            candidates = await search.discover(request.question)
        finally:
            await search.close()
        if not candidates:
            return self._cannot_verify(
                request, "No candidate sources were returned by the search provider."
            )

        documents = await DaytonaResearchComputer(self.settings).scrape(candidates)
        if not documents:
            return self._cannot_verify(
                request, "No source could be retrieved inside the secure sandbox."
            )

        provenance = build_provenance(documents, request.investigation_id)
        bundle = _evidence_bundle(request.question, documents)
        primary_llm = get_llm(self.settings)
        nosana_skeptic = get_nosana_llm(self.settings)

        supporter, skeptic = await asyncio.gather(
            primary_llm.parse(SUPPORT_PROMPT, bundle, AgentFindings),
            nosana_skeptic.parse(SKEPTIC_PROMPT, bundle, AgentFindings),
        )
        audit_input = (
            f"{bundle}\n\nSUPPORTER REPORT:\n{supporter.model_dump_json()}"
            f"\n\nSKEPTIC REPORT (NOSANA):\n{skeptic.model_dump_json()}"
        )
        audit = await primary_llm.parse(AUDITOR_PROMPT, audit_input, AuditDecision)
        return self._assemble(request, provenance, documents, supporter, skeptic, audit)

    def _assemble(self, request, provenance, documents, supporter, skeptic, audit):
        source_by_id = {source.id: source for source in provenance.sources}
        all_findings = [*supporter.findings, *skeptic.findings]
        claims: list[ClaimRecord] = []
        evidence: list[EvidenceRecord] = []
        claim_id_by_text: dict[str, str] = {}

        for audited_claim in audit.claims:
            claim_id = str(uuid5(NAMESPACE_URL, f"{request.investigation_id}:{audited_claim.text}"))
            claim_id_by_text[audited_claim.text] = claim_id
            seen: set[tuple[str, str]] = set()
            for relation, urls in (
                ("SUPPORTS", audited_claim.supporting_source_urls),
                ("OPPOSES", audited_claim.opposing_source_urls),
            ):
                for url in urls:
                    source = _find_source(url, provenance.source_by_url)
                    if not source or (source.id, relation) in seen:
                        continue
                    seen.add((source.id, relation))
                    excerpt, location = _best_excerpt(url, all_findings, source)
                    evidence.append(
                        EvidenceRecord(
                            id=str(uuid4()),
                            claimId=claim_id,
                            sourceId=source.id,
                            relation=relation,
                            excerpt=excerpt,
                            location=location,
                            weight=round(
                                (source.reliabilityScore / 100)
                                * (0.64 if source.isDuplicate else 1),
                                3,
                            ),
                        )
                    )
            claim_evidence = [item for item in evidence if item.claimId == claim_id]
            claims.append(
                ClaimRecord(
                    id=claim_id,
                    text=audited_claim.text,
                    status=audited_claim.status,
                    evidenceStrength=_strength(claim_evidence, source_by_id),
                    rationale=audited_claim.rationale,
                    supportCount=sum(item.relation == "SUPPORTS" for item in claim_evidence),
                    opposeCount=sum(item.relation == "OPPOSES" for item in claim_evidence),
                )
            )

        contradictions: list[ContradictionRecord] = []
        for item in audit.contradictions:
            match = process.extractOne(item.claim_text, claim_id_by_text.keys())
            if not match:
                continue
            claim_id = claim_id_by_text[match[0]]
            source_ids = [
                source.id
                for url in item.source_urls
                if (source := _find_source(url, provenance.source_by_url)) is not None
            ]
            contradictions.append(
                ContradictionRecord(
                    id=str(uuid4()),
                    claimId=claim_id,
                    summary=item.summary,
                    resolution=item.resolution,
                    reason=item.reason,
                    sourceIds=list(dict.fromkeys(source_ids)),
                )
            )

        security_events: list[SecurityEventRecord] = []
        for document in documents:
            if not document.security_findings:
                continue
            source = _find_source(str(document.final_url), provenance.source_by_url)
            security_events.append(
                SecurityEventRecord(
                    id=str(uuid4()),
                    severity="BLOCKED",
                    category="PROMPT_INJECTION",
                    message=(
                        "Potential prompt injection detected — content isolated — "
                        "research continued safely."
                    ),
                    sourceId=source.id if source else None,
                    detectedAt=utc_now(),
                )
            )

        score = round(sum(claim.evidenceStrength for claim in claims) / max(1, len(claims)))
        score = max(10, score - min(20, len(audit.limitations) * 3))
        return InvestigationResult(
            id=request.investigation_id,
            question=request.question,
            status="COMPLETED",
            verdict=audit.verdict,
            answer=audit.answer,
            evidenceStrength=score,
            createdAt=utc_now(),
            completedAt=utc_now(),
            limitations=[
                *audit.limitations,
                *supporter.missing_evidence,
                *skeptic.missing_evidence,
            ],
            sources=provenance.sources,
            claims=claims,
            evidence=evidence,
            contradictions=contradictions,
            securityEvents=security_events,
            metrics={
                "sourcesChecked": len(documents),
                "independentSources": independent_source_count(provenance.sources),
                "primarySources": sum(source.isPrimary for source in provenance.sources),
                "contradictions": len(contradictions),
                "falseConsensusClusters": provenance.false_consensus_clusters,
            },
            audit={
                "supportingAgentSummary": supporter.summary,
                "opposingAgentSummary": skeptic.summary,
                "auditorSummary": audit.auditor_summary,
            },
        )

    def _cannot_verify(self, request: InvestigationRequest, reason: str) -> InvestigationResult:
        return InvestigationResult(
            id=request.investigation_id,
            question=request.question,
            status="COMPLETED",
            verdict="UNVERIFIABLE",
            answer="Insufficient independent evidence was found to verify this claim.",
            evidenceStrength=12,
            createdAt=utc_now(),
            completedAt=utc_now(),
            limitations=[reason],
            sources=[],
            claims=[],
            evidence=[],
            contradictions=[],
            securityEvents=[],
            metrics={
                "sourcesChecked": 0,
                "independentSources": 0,
                "primarySources": 0,
                "contradictions": 0,
                "falseConsensusClusters": 0,
            },
            audit={
                "supportingAgentSummary": "No adequate support found.",
                "opposingAgentSummary": "No adequate opposing evidence found.",
                "auditorSummary": reason,
            },
        )

    def _demo_result(self, request: InvestigationRequest) -> InvestigationResult:
        now = utc_now()
        source_a = SourceRecord(
            id=f"{request.investigation_id}-filing",
            title="Illustrative audited filing",
            publisher="Corporate Registry",
            url="https://example.com/demo/filing",
            publishedAt="2026-04-12T00:00:00Z",
            accessedAt=now,
            tier="PRIMARY",
            reliabilityScore=94,
            independenceGroup="demo-filing",
            isPrimary=True,
            isDuplicate=False,
            excerpt="Audited revenue increased by 22.4% year over year.",
        )
        source_b = SourceRecord(
            id=f"{request.investigation_id}-notice",
            title="Illustrative lender notice",
            publisher="Lender Disclosure Portal",
            url="https://example.com/demo/lender-notice",
            publishedAt="2026-07-18T00:00:00Z",
            accessedAt=now,
            tier="PRIMARY",
            reliabilityScore=91,
            independenceGroup="demo-lender",
            isPrimary=True,
            isDuplicate=False,
            excerpt="The borrower fell below the minimum liquidity covenant.",
        )
        claim_id = f"{request.investigation_id}-claim"
        return InvestigationResult(
            id=request.investigation_id,
            question=request.question,
            status="COMPLETED",
            verdict="INCONCLUSIVE",
            answer=(
                "Historic growth is supported, but current decision readiness cannot be verified. "
                "A later primary disclosure contradicts the year-end liquidity position."
            ),
            evidenceStrength=61,
            createdAt=now,
            completedAt=now,
            limitations=["Illustrative run: add credentials to research live sources."],
            sources=[source_a, source_b],
            claims=[
                ClaimRecord(
                    id=claim_id,
                    text="The company has adequate current liquidity.",
                    status="CONTRADICTED",
                    evidenceStrength=84,
                    rationale="A newer primary source contradicts the older filing.",
                    supportCount=1,
                    opposeCount=1,
                )
            ],
            evidence=[
                EvidenceRecord(
                    id=f"{claim_id}-a",
                    claimId=claim_id,
                    sourceId=source_a.id,
                    relation="SUPPORTS",
                    excerpt=source_a.excerpt,
                    location="Filing",
                    weight=0.94,
                ),
                EvidenceRecord(
                    id=f"{claim_id}-b",
                    claimId=claim_id,
                    sourceId=source_b.id,
                    relation="OPPOSES",
                    excerpt=source_b.excerpt,
                    location="Notice",
                    weight=0.91,
                ),
            ],
            contradictions=[
                ContradictionRecord(
                    id=f"{claim_id}-c",
                    claimId=claim_id,
                    summary="Year-end liquidity conflicts with a later covenant notice.",
                    resolution="The difference is date-driven; the newer source is more relevant.",
                    reason="DATE",
                    sourceIds=[source_a.id, source_b.id],
                )
            ],
            securityEvents=[
                SecurityEventRecord(
                    id=f"{request.investigation_id}-security",
                    severity="BLOCKED",
                    category="PROMPT_INJECTION",
                    message=(
                        "Potential prompt injection detected — content isolated — "
                        "research continued safely."
                    ),
                    sourceId=source_b.id,
                    detectedAt=now,
                )
            ],
            metrics={
                "sourcesChecked": 14,
                "independentSources": 6,
                "primarySources": 3,
                "contradictions": 2,
                "falseConsensusClusters": 1,
            },
            audit={
                "supportingAgentSummary": "Historic growth supports the case.",
                "opposingAgentSummary": "Nosana skeptic found a newer liquidity conflict.",
                "auditorSummary": "The available evidence does not verify current readiness.",
            },
        )
