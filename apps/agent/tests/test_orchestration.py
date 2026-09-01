import pytest

from app import orchestrator
from app.config import Settings
from app.models import (
    AgentFindings,
    AuditDecision,
    InvestigationRequest,
    ScrapedDocument,
    SearchCandidate,
    SearchCoverage,
)
from app.research.search import Discovery


class _RecordingLLM:
    def __init__(self, responses, provider_name: str = "gemini"):
        self.responses = list(responses)
        self.calls: list[tuple[str, str]] = []
        self.provider_name = provider_name
        self.last_provider: str | None = None

    async def parse(self, system, user, schema):
        self.calls.append((system, user))
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        assert isinstance(response, schema)
        self.last_provider = self.provider_name
        return response


def _settings() -> Settings:
    return Settings(
        demo_mode=False,
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
            candidates = [
                SearchCandidate(
                    url="https://example.com/report",
                    title="Example report",
                    query_role="NEUTRAL",
                    providers=["tavily", "serper"],
                )
            ]
            return Discovery(
                candidates=candidates,
                coverage=SearchCoverage(
                    resultsDiscovered=2,
                    uniqueSources=1,
                    resultsByProvider={"tavily": 1, "serper": 1},
                    overlappingSources=1,
                    queriesIssued=8,
                ),
            )

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

    def _get_llm(settings, preferred_provider):
        assert preferred_provider in {"gemini", "groq", "deepseek"}
        return remaining_llms.pop(0)

    monkeypatch.setattr(orchestrator, "SearchClient", _SearchClient)
    monkeypatch.setattr(orchestrator, "DaytonaResearchComputer", _ResearchComputer)
    monkeypatch.setattr(orchestrator, "get_llm", _get_llm)


def test_live_credentials_accept_gemini_as_the_only_llm() -> None:
    _settings().require_live_credentials()


def test_live_credentials_accept_serper_as_the_only_search_provider() -> None:
    settings = _settings().model_copy(
        update={"tavily_api_key": "", "serper_api_key": "test-serper-key"}
    )

    settings.require_live_credentials()


def test_live_credentials_require_at_least_one_search_provider() -> None:
    settings = _settings().model_copy(update={"tavily_api_key": "", "serper_api_key": ""})

    with pytest.raises(RuntimeError, match="TAVILY_API_KEY or SERPER_API_KEY"):
        settings.require_live_credentials()


def test_live_credentials_accept_deepseek_as_the_only_llm() -> None:
    settings = _settings().model_copy(
        update={"google_api_key": "", "deepseek_api_key": "test-deepseek-key"}
    )

    settings.require_live_credentials()


def test_live_credentials_require_at_least_one_llm_provider() -> None:
    settings = _settings().model_copy(
        update={"google_api_key": "", "groq_api_key": "", "deepseek_api_key": ""}
    )

    with pytest.raises(RuntimeError, match="GOOGLE_API_KEY, GROQ_API_KEY, or DEEPSEEK_API_KEY"):
        settings.require_live_credentials()


async def test_failover_chain_runs_all_three_analysis_roles(monkeypatch) -> None:
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
