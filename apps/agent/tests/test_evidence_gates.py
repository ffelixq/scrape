from app.models import EvidenceRecord, Finding, SearchCandidate, SourceRecord
from app.orchestrator import _best_excerpt, _gated_claim_status
from app.research.search import SearchClient


def source() -> SourceRecord:
    return SourceRecord(
        id="source-1",
        title="Independent market article",
        publisher="example.com",
        url="https://example.com/report",
        publishedAt="2026-08-01T00:00:00Z",
        accessedAt="2026-08-29T00:00:00Z",
        tier="SECONDARY",
        reliabilityScore=65,
        independenceGroup="origin-1",
        isPrimary=False,
        isDuplicate=False,
        excerpt="The non-performing loan ratio remained at one percent.",
    )


def test_mismatched_finding_is_not_exported_as_evidence() -> None:
    record = source()
    finding = Finding(
        claim="The non-performing loan ratio remained stable.",
        source_url=str(record.url),
        excerpt="The non-performing loan ratio remained at one percent.",
        location="Results paragraph 4",
        reasoning="Directly stated by the source.",
    )

    result = _best_excerpt(
        record,
        {str(record.url): record},
        [finding],
        "The bank maintains a seventeen percent CET1 capital ratio.",
        "The non-performing loan ratio remained at one percent.",
    )

    assert result is None


def test_partial_numeric_quote_is_not_exported_for_a_compound_claim() -> None:
    record = source()
    finding = Finding(
        claim="Profit was 22.9 billion in 2025 and ROE reached 17.9 percent in 2026.",
        source_url=str(record.url),
        excerpt="Return on equity reached 17.9 percent in the latest quarter.",
        location="Results paragraph 2",
        reasoning="The excerpt covers only one of the two metrics.",
    )

    result = _best_excerpt(
        record,
        {str(record.url): record},
        [finding],
        "Profit was 22.9 billion in 2025 and ROE reached 17.9 percent in 2026.",
        "Return on equity reached 17.9 percent in the latest quarter.",
    )

    assert result is None


def test_pdf_line_breaks_are_anchored_to_actual_source_text() -> None:
    record = source()
    finding = Finding(
        claim="The CET-1 capital ratio was 16.6% as of 30 June 2026.",
        source_url=str(record.url),
        excerpt="The CET-1 capital ratio was 16.6% as of 30 June 2026.",
        location="Capital adequacy table",
        reasoning="Reported in the filed results.",
    )
    document_text = (
        "Capital adequacy remained strong.\n"
        "Common Equity Tier 1 ratio\n"
        "16.6% 17.0% 17.0%\n"
        "First Half 2026\n"
        "The leverage ratio remained above requirements."
    )

    result = _best_excerpt(
        record,
        {str(record.url): record},
        [finding],
        finding.claim,
        document_text,
    )

    assert result is not None
    assert "16.6%" in result[0]
    assert "2026" in result[0]


def test_well_supported_requires_breadth_and_high_quality_sources() -> None:
    record = source()
    evidence = EvidenceRecord(
        id="evidence-1",
        claimId="claim-1",
        sourceId=record.id,
        relation="SUPPORTS",
        excerpt="A directly relevant excerpt.",
        location="Paragraph 1",
        weight=0.65,
    )

    status = _gated_claim_status(
        "WELL_SUPPORTED",
        [evidence],
        {record.id: record},
        strength=51,
    )

    assert status == "SUPPORTED"


def test_ambiguous_acronym_search_result_is_rejected() -> None:
    candidate = SearchCandidate(
        url="https://www.gov.uk/government/publications/dbs-annual-report",
        title="DBS annual report and accounts",
        snippet="Disclosure and Barring Service annual report.",
        query_role="SUPPORT",
    )

    assert SearchClient._is_relevant(candidate, {"dbs", "group", "holdings"}) is False
