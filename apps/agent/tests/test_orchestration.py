import pytest
from pydantic import ValidationError

from app import orchestrator
from app.config import Settings
from app.models import (
    AgentFindings,
    AuditDecision,
    InvestigationRequest,
    ScrapedDocument,
    SearchCandidate,
)


class _RecordingLLM:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls: list[tuple[str, str]] = []

    async def parse(self, system, user, schema):
        self.calls.append((system, user))
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        assert isinstance(response, schema)
        return response


def _settings() -> Settings:
    return Settings(
        demo_mode=False,
        llm_provider="gemini",
        google_api_key="test-google-key",
        daytona_api_key="test-daytona-key",
        tavily_api_key="test-tavily-key",
    )


def _agent_findings(summary: str) -> AgentFindings:
    return AgentFindings(summary=summary, findings=[], missing_evidence=[])


def _install_live_dependencies(monkeypatch, llms: list[_RecordingLLM]) -> None:
    class _SearchClient:
        def __init__(self, settings):
            self.settings = settings

        async def discover(self, question):
            return [
                SearchCandidate(
                    url="https://example.com/report",
                    title="Example report",
                    query_role="NEUTRAL",
                )
            ]

        async def close(self):
            return None

    class _ResearchComputer:
        def __init__(self, settings):
            self.settings = settings

        async def scrape(self, candidates):
            return [
                ScrapedDocument(
                    url="https://example.com/report",
                    final_url="https://example.com/report",
                    title="Example report",
                    publisher="example.com",
                    text="The report contains enough neutral evidence for an orchestration test.",
                    content_hash="test-content-hash",
                )
            ]

    remaining_llms = list(llms)

    def _get_llm(settings):
        return remaining_llms.pop(0)

    monkeypatch.setattr(orchestrator, "SearchClient", _SearchClient)
    monkeypatch.setattr(orchestrator, "DaytonaResearchComputer", _ResearchComputer)
    monkeypatch.setattr(orchestrator, "get_llm", _get_llm)


def test_live_credentials_need_only_the_selected_llm() -> None:
    _settings().require_live_credentials()


def test_removed_provider_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(llm_provider="nosana")


async def test_selected_provider_runs_all_three_analysis_roles(monkeypatch) -> None:
    supporter = _agent_findings("Supporting analysis completed.")
    skeptic = _agent_findings("Skeptical analysis completed.")
    audit = AuditDecision(
        verdict="INCONCLUSIVE",
        answer="The available evidence is insufficient.",
        claims=[],
        contradictions=[],
        limitations=[],
        auditor_summary="No conclusion was justified.",
    )
    primary_llm = _RecordingLLM([supporter, audit])
    skeptic_llm = _RecordingLLM([skeptic])
    _install_live_dependencies(monkeypatch, [primary_llm, skeptic_llm])

    result = await orchestrator.ResearchOrchestrator(_settings()).investigate(
        InvestigationRequest(
            investigation_id="provider-flow-test",
            question="Is the available evidence sufficient for this decision?",
        )
    )

    assert result.status == "COMPLETED"
    assert result.limitations == []
    assert [call[0] for call in primary_llm.calls] == [
        orchestrator.SUPPORT_PROMPT,
        orchestrator.AUDITOR_PROMPT,
    ]
    assert [call[0] for call in skeptic_llm.calls] == [orchestrator.SKEPTIC_PROMPT]
    assert "SKEPTIC REPORT (GEMINI)" in primary_llm.calls[1][1]


async def test_skeptic_failure_fails_the_investigation(monkeypatch) -> None:
    primary_llm = _RecordingLLM([_agent_findings("Supporting analysis completed.")])
    skeptic_llm = _RecordingLLM([RuntimeError("skeptic failed")])
    _install_live_dependencies(monkeypatch, [primary_llm, skeptic_llm])

    with pytest.raises(RuntimeError, match="skeptic failed"):
        await orchestrator.ResearchOrchestrator(_settings()).investigate(
            InvestigationRequest(
                investigation_id="provider-failure-test",
                question="Does a failed skeptic stop this live investigation?",
            )
        )
