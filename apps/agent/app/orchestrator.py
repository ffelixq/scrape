import asyncio
import re
from uuid import NAMESPACE_URL, uuid4, uuid5

from rapidfuzz import fuzz, process

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
current dates. Every finding must contain one atomic claim and a verbatim excerpt that contains all
numbers and dates asserted by that claim. Explain missing support. Return only source URLs included
in the evidence bundle.
"""

SKEPTIC_PROMPT = """
Act as an adversarial skeptic running on independent Nosana GPU compute. Try to prove the proposed
conclusion wrong. Search the supplied evidence for counterexamples, newer disclosures, definition
changes, copied claims, weak provenance, and absent primary support. Do not invent contradictions.
Every finding must contain one atomic claim and a verbatim excerpt that contains all numbers and
dates asserted by that claim. Return only source URLs included in the evidence bundle.
"""

FALLBACK_SKEPTIC_PROMPT = """
Act as an adversarial skeptic. The independent Nosana inference endpoint is temporarily unavailable,
so this is a disclosed continuity fallback on the primary model provider. Try to prove the proposed
conclusion wrong. Search the supplied evidence for counterexamples, newer disclosures, definition
changes, copied claims, weak provenance, and absent primary support. Do not invent contradictions.
Every finding must contain one atomic claim and a verbatim excerpt that contains all numbers and
dates asserted by that claim. Return only source URLs included in the evidence bundle.
"""

AUDITOR_PROMPT = """
Act as the final evidence auditor. Reconcile the supporter and skeptic reports against the source
bundle. Authority is an indicator, never proof. Ten derivative pages count as one origin. Explain
date, currency, definition, period, and methodology differences instead of averaging conflicts.
Use UNVERIFIABLE or INCONCLUSIVE whenever the available evidence cannot support a decision. The
answer must be concise, decision-useful, and explicit about what evidence would change the verdict.
For investment questions, distinguish financial health from valuation and personal suitability. Do
not call an asset a good or bad investment solely from business health. A source URL may be attached
to a claim only when its quoted excerpt directly supports or opposes that exact claim.
Keep audited claims atomic: do not combine multiple metrics, periods, events, or sources into one
claim unless one verbatim excerpt contains every asserted number and date.
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
        return 0
    weights = [item.weight for item in evidence]
    groups = {
        sources[item.sourceId].independenceGroup for item in evidence if item.sourceId in sources
    }
    breadth = min(24, len(groups) * 8)
    quality = sum(weights) / len(weights) * 66
    return max(20, min(96, round(quality + breadth)))


def _best_excerpt(
    source: SourceRecord,
    source_by_url: dict[str, SourceRecord],
    findings: list,
    claim_text: str,
    document_text: str,
) -> tuple[str, str] | None:
    normalized_document = re.sub(r"\s+", " ", document_text).strip().lower()
    source_lines = [
        re.sub(r"\s+", " ", line).strip()
        for line in document_text.splitlines()
        if len(line.strip()) >= 8
    ]
    source_windows: list[str] = []
    for index in range(len(source_lines)):
        window = ""
        for line in source_lines[index : index + 4]:
            window = f"{window} {line}".strip()
            if len(window) > 1_600:
                break
            source_windows.append(window)
    matching_findings = [
        finding
        for finding in findings
        if (finding_source := _find_source(finding.source_url, source_by_url)) is not None
        and finding_source.id == source.id
    ]
    matching_findings.sort(
        key=lambda finding: fuzz.token_set_ratio(claim_text, finding.claim),
        reverse=True,
    )
    for finding in matching_findings:
        if fuzz.token_set_ratio(claim_text, finding.claim) < 48:
            continue
        normalized_excerpt = re.sub(r"\s+", " ", finding.excerpt).strip().lower()
        if len(normalized_excerpt) < 40:
            continue
        claim_for_numbers = re.sub(
            r"\b\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|"
            r"jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|"
            r"nov(?:ember)?|dec(?:ember)?)\b",
            "",
            claim_text,
            flags=re.IGNORECASE,
        )
        claim_numbers = {
            token
            for token in re.findall(
                r"\b\d+(?:\.\d+)?%?\b",
                claim_for_numbers.replace(",", ""),
            )
            if not (token.isdigit() and int(token) <= 4)
        }
        anchored_excerpt = finding.excerpt
        if normalized_excerpt not in normalized_document:
            numeric_windows = [
                window
                for window in source_windows
                if claim_numbers.issubset(
                    set(
                        re.findall(
                            r"\b\d+(?:\.\d+)?%?\b",
                            f"{window} {source.publishedAt or ''}".replace(",", ""),
                        )
                    )
                )
            ]
            anchor_match = process.extractOne(
                finding.excerpt,
                numeric_windows,
                scorer=fuzz.WRatio,
                score_cutoff=65,
            )
            if not anchor_match:
                continue
            anchored_excerpt = anchor_match[0]
        excerpt_numbers = set(
            re.findall(
                r"\b\d+(?:\.\d+)?%?\b",
                f"{anchored_excerpt} {source.publishedAt or ''}".replace(",", ""),
            )
        )
        if not claim_numbers.issubset(excerpt_numbers):
            continue
        return anchored_excerpt[:1_200], finding.location[:250]
    return None


def _gated_claim_status(
    requested_status: str,
    claim_evidence: list[EvidenceRecord],
    sources: dict[str, SourceRecord],
    strength: int,
) -> str:
    supporting = [item for item in claim_evidence if item.relation == "SUPPORTS"]
    opposing = [item for item in claim_evidence if item.relation == "OPPOSES"]
    if requested_status in {"SUPPORTED", "WELL_SUPPORTED"} and not supporting:
        return "UNVERIFIABLE"
    if requested_status in {"CONTRADICTED", "LIKELY_FALSE"} and not opposing:
        return "UNVERIFIABLE"
    if requested_status == "WELL_SUPPORTED":
        groups = {
            sources[item.sourceId].independenceGroup
            for item in supporting
            if item.sourceId in sources
        }
        has_high_quality = any(
            sources[item.sourceId].tier in {"PRIMARY", "AUTHORITATIVE"}
            for item in supporting
            if item.sourceId in sources
        )
        if strength < 70 or len(groups) < 2 or not has_high_quality:
            return "SUPPORTED" if strength >= 50 else "INCONCLUSIVE"
    if requested_status == "SUPPORTED" and strength < 45:
        return "INCONCLUSIVE"
    return requested_status


def _final_answer(verdict: str, question: str, claims: list[ClaimRecord]) -> str:
    supported = [claim.text for claim in claims if claim.status in {"SUPPORTED", "WELL_SUPPORTED"}]
    challenged = [
        claim.text for claim in claims if claim.status in {"CONTRADICTED", "LIKELY_FALSE"}
    ]
    unverified = [
        claim.text for claim in claims if claim.status in {"UNVERIFIABLE", "INCONCLUSIVE"}
    ]

    if verdict in {"UNVERIFIABLE", "INCONCLUSIVE"}:
        parts = [
            "The available validated evidence is insufficient to answer the investigation "
            "question conclusively."
        ]
    else:
        parts = [f"The validated evidence status is {verdict.replace('_', ' ').lower()}."]
    if supported:
        findings = "; ".join(item.rstrip(". ") for item in supported[:3])
        parts.append(f"Validated citations support: {findings}.")
    if challenged:
        findings = "; ".join(item.rstrip(". ") for item in challenged[:2])
        parts.append(f"Validated opposing evidence challenges: {findings}.")
    if unverified:
        findings = "; ".join(item.rstrip(". ") for item in unverified[:2])
        parts.append(f"The investigation could not verify: {findings}.")
    if "invest" in question.lower():
        parts.append(
            "Financial health alone does not establish investment attractiveness, valuation, or "
            "personal suitability."
        )
    return " ".join(parts)


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
        runtime_limitations: list[str] = []

        try:
            nosana_skeptic = get_nosana_llm(self.settings)
            skeptic_task = asyncio.wait_for(
                nosana_skeptic.parse(SKEPTIC_PROMPT, bundle, AgentFindings),
                timeout=25,
            )
        except Exception:
            skeptic_task = None

        results = await asyncio.gather(
            primary_llm.parse(SUPPORT_PROMPT, bundle, AgentFindings),
            skeptic_task if skeptic_task is not None else asyncio.sleep(0, result=None),
            return_exceptions=True,
        )
        supporter_result, skeptic_result = results
        if isinstance(supporter_result, BaseException):
            raise supporter_result
        supporter = supporter_result

        used_nosana_fallback = skeptic_task is None or isinstance(skeptic_result, BaseException)
        if used_nosana_fallback:
            skeptic = await primary_llm.parse(
                FALLBACK_SKEPTIC_PROMPT,
                bundle,
                AgentFindings,
            )
            runtime_limitations.append(
                "The independent Nosana skeptic endpoint was unavailable during this run; the "
                f"adversarial review used the {self.settings.llm_provider} provider as a "
                "disclosed continuity fallback, so it was not independent of the supporter."
            )
        else:
            skeptic = skeptic_result

        skeptic_label = (
            "NOSANA"
            if not used_nosana_fallback
            else f"{self.settings.llm_provider.upper()} FALLBACK; NOSANA UNAVAILABLE"
        )
        audit_input = (
            f"{bundle}\n\nSUPPORTER REPORT:\n{supporter.model_dump_json()}"
            f"\n\nSKEPTIC REPORT ({skeptic_label}):\n{skeptic.model_dump_json()}"
        )
        audit = await primary_llm.parse(AUDITOR_PROMPT, audit_input, AuditDecision)
        return self._assemble(
            request,
            provenance,
            documents,
            supporter,
            skeptic,
            audit,
            runtime_limitations,
        )

    def _assemble(
        self,
        request,
        provenance,
        documents,
        supporter,
        skeptic,
        audit,
        runtime_limitations,
    ):
        source_by_id = {source.id: source for source in provenance.sources}
        document_by_source_id: dict[str, ScrapedDocument] = {}
        for document in documents:
            source = _find_source(str(document.final_url), provenance.source_by_url)
            if source:
                document_by_source_id[source.id] = document
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
                    document = document_by_source_id.get(source.id)
                    if not document:
                        continue
                    validated_excerpt = _best_excerpt(
                        source,
                        provenance.source_by_url,
                        all_findings,
                        audited_claim.text,
                        document.text,
                    )
                    if not validated_excerpt:
                        continue
                    excerpt, location = validated_excerpt
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
            claim_strength = _strength(claim_evidence, source_by_id)
            gated_status = _gated_claim_status(
                audited_claim.status,
                claim_evidence,
                source_by_id,
                claim_strength,
            )
            claims.append(
                ClaimRecord(
                    id=claim_id,
                    text=audited_claim.text,
                    status=gated_status,
                    evidenceStrength=claim_strength,
                    rationale=(
                        audited_claim.rationale
                        if gated_status == audited_claim.status
                        else "The model proposed this claim, but no sufficiently complete exact "
                        "citation passed Proofline's deterministic evidence gate."
                    ),
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
        score = max(
            0 if not evidence else 10,
            score - min(20, (len(audit.limitations) + len(runtime_limitations)) * 3),
        )
        limitations = list(
            dict.fromkeys(
                [
                    *runtime_limitations,
                    *audit.limitations,
                    *supporter.missing_evidence,
                    *skeptic.missing_evidence,
                ]
            )
        )
        verdict = audit.verdict
        primary_count = sum(source.isPrimary for source in provenance.sources)
        independent_count = independent_source_count(provenance.sources)
        if verdict == "WELL_SUPPORTED" and (
            score < 70 or primary_count == 0 or independent_count < 2
        ):
            verdict = "SUPPORTED" if score >= 55 else "INCONCLUSIVE"
        elif verdict == "SUPPORTED" and score < 45:
            verdict = "INCONCLUSIVE"
        if verdict != audit.verdict:
            limitations.insert(
                0,
                "Proofline's deterministic evidence gate downgraded the model's initial verdict "
                "because the validated citations, source quality, or independence were "
                "insufficient.",
            )
        answer = _final_answer(verdict, request.question, claims)
        supported_claims = [
            claim.text for claim in claims if claim.status in {"SUPPORTED", "WELL_SUPPORTED"}
        ]
        challenged_claims = [
            claim.text for claim in claims if claim.status in {"CONTRADICTED", "LIKELY_FALSE"}
        ]
        return InvestigationResult(
            id=request.investigation_id,
            question=request.question,
            status="COMPLETED",
            verdict=verdict,
            answer=answer,
            evidenceStrength=score,
            createdAt=utc_now(),
            completedAt=utc_now(),
            limitations=limitations,
            sources=provenance.sources,
            claims=claims,
            evidence=evidence,
            contradictions=contradictions,
            securityEvents=security_events,
            metrics={
                "sourcesChecked": len(documents),
                "independentSources": independent_count,
                "primarySources": primary_count,
                "contradictions": len(contradictions),
                "falseConsensusClusters": provenance.false_consensus_clusters,
            },
            audit={
                "supportingAgentSummary": (
                    "; ".join(supported_claims)
                    if supported_claims
                    else "No supporting claim passed citation validation."
                ),
                "opposingAgentSummary": (
                    "; ".join(challenged_claims)
                    if challenged_claims
                    else "No opposing claim passed citation validation."
                ),
                "auditorSummary": answer,
            },
        )

    def _cannot_verify(self, request: InvestigationRequest, reason: str) -> InvestigationResult:
        return InvestigationResult(
            id=request.investigation_id,
            question=request.question,
            status="COMPLETED",
            verdict="UNVERIFIABLE",
            answer="Insufficient independent evidence was found to verify this claim.",
            evidenceStrength=0,
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
