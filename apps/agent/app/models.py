from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

EvidenceStatus = Literal[
    "SUPPORTED",
    "WELL_SUPPORTED",
    "INCONCLUSIVE",
    "CONTRADICTED",
    "LIKELY_FALSE",
    "UNVERIFIABLE",
]


class InvestigationRequest(BaseModel):
    investigation_id: str
    question: str = Field(min_length=12, max_length=2_000)
    context: str = Field(default="", max_length=4_000)
    mode: Literal["STANDARD", "DEEP"] = "STANDARD"


class SearchCandidate(BaseModel):
    url: HttpUrl
    title: str
    snippet: str = ""
    published_at: str | None = None
    query_role: Literal["SUPPORT", "OPPOSE", "NEUTRAL"] = "NEUTRAL"


class ScrapedDocument(BaseModel):
    url: HttpUrl
    final_url: HttpUrl
    title: str
    publisher: str
    text: str
    published_at: str | None = None
    canonical_url: str | None = None
    content_hash: str
    security_findings: list[str] = Field(default_factory=list)
    content_type: str = "text/html"
    status_code: int = 200


class SourceRecord(BaseModel):
    id: str
    title: str
    publisher: str
    url: HttpUrl
    publishedAt: str | None
    accessedAt: str
    tier: Literal["PRIMARY", "AUTHORITATIVE", "SECONDARY", "LOW"]
    reliabilityScore: int = Field(ge=0, le=100)
    independenceGroup: str
    isPrimary: bool
    isDuplicate: bool
    excerpt: str


class Finding(BaseModel):
    claim: str
    source_url: str
    excerpt: str
    location: str = "Web page"
    reasoning: str


class AgentFindings(BaseModel):
    summary: str
    findings: list[Finding]
    missing_evidence: list[str] = Field(default_factory=list)


class AuditedClaim(BaseModel):
    text: str
    status: EvidenceStatus
    rationale: str
    supporting_source_urls: list[str]
    opposing_source_urls: list[str]


class AuditedContradiction(BaseModel):
    claim_text: str
    summary: str
    resolution: str
    reason: Literal[
        "DATE", "DEFINITION", "CURRENCY", "REPORTING_PERIOD", "METHODOLOGY", "UNRESOLVED"
    ]
    source_urls: list[str]


class AuditDecision(BaseModel):
    verdict: EvidenceStatus
    answer: str
    claims: list[AuditedClaim]
    contradictions: list[AuditedContradiction]
    limitations: list[str]
    auditor_summary: str


class EvidenceRecord(BaseModel):
    id: str
    claimId: str
    sourceId: str
    relation: Literal["SUPPORTS", "OPPOSES", "CONTEXT"]
    excerpt: str
    location: str
    weight: float = Field(ge=0, le=1)


class ClaimRecord(BaseModel):
    id: str
    text: str
    status: EvidenceStatus
    evidenceStrength: int = Field(ge=0, le=100)
    rationale: str
    supportCount: int = Field(ge=0)
    opposeCount: int = Field(ge=0)


class ContradictionRecord(BaseModel):
    id: str
    claimId: str
    summary: str
    resolution: str
    reason: str
    sourceIds: list[str]


class SecurityEventRecord(BaseModel):
    id: str
    severity: Literal["INFO", "WARNING", "BLOCKED"]
    category: Literal["PROMPT_INJECTION", "MALICIOUS_FILE", "NETWORK_POLICY", "CONTENT_LIMIT"]
    message: str
    sourceId: str | None
    detectedAt: str


class InvestigationResult(BaseModel):
    id: str
    question: str
    status: Literal["QUEUED", "RESEARCHING", "AUDITING", "COMPLETED", "FAILED"]
    verdict: EvidenceStatus | None
    answer: str | None
    evidenceStrength: int = Field(ge=0, le=100)
    createdAt: str
    completedAt: str | None
    limitations: list[str]
    sources: list[SourceRecord]
    claims: list[ClaimRecord]
    evidence: list[EvidenceRecord]
    contradictions: list[ContradictionRecord]
    securityEvents: list[SecurityEventRecord]
    metrics: dict[str, int]
    audit: dict[str, str]


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
