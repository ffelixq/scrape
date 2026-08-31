import httpx
import pytest

from app import providers
from app.config import Settings
from app.models import AgentFindings
from app.providers import FailoverLLM, StructuredLLM, is_transient_inference_error


class _ProviderError(Exception):
    """Stands in for the differently named status errors each provider SDK raises."""

    def __init__(self, code: int) -> None:
        super().__init__(f"provider returned {code}")
        self.code = code


class _ScriptedLLM(StructuredLLM):
    def __init__(self, errors: list[Exception]) -> None:
        self.errors = list(errors)
        self.attempts = 0

    async def _parse_once(
        self, system: str, user: str, schema: type[AgentFindings]
    ) -> AgentFindings:
        self.attempts += 1
        if self.errors:
            raise self.errors.pop(0)
        return schema(summary="ok", findings=[])


@pytest.fixture(autouse=True)
def _no_backoff_delay(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(providers, "INITIAL_RETRY_DELAY_SECONDS", 0)


async def test_a_transient_provider_overload_is_retried() -> None:
    llm = _ScriptedLLM([_ProviderError(503)])

    result = await llm.parse("system", "user", AgentFindings)

    assert result.summary == "ok"
    assert llm.attempts == 2


async def test_a_permanent_provider_error_is_not_retried() -> None:
    llm = _ScriptedLLM([_ProviderError(400), _ProviderError(400)])

    with pytest.raises(_ProviderError):
        await llm.parse("system", "user", AgentFindings)

    assert llm.attempts == 1


async def test_retries_are_bounded() -> None:
    llm = _ScriptedLLM([_ProviderError(503) for _ in range(10)])

    with pytest.raises(_ProviderError):
        await llm.parse("system", "user", AgentFindings)

    assert llm.attempts == providers.MAX_INFERENCE_ATTEMPTS


async def test_inference_falls_back_from_gemini_to_groq() -> None:
    gemini = _ScriptedLLM([_ProviderError(400)])
    groq = _ScriptedLLM([])
    deepseek = _ScriptedLLM([])
    llm = FailoverLLM(
        [
            ("gemini", gemini),
            ("groq", groq),
            ("deepseek", deepseek),
        ]
    )

    result = await llm.parse("system", "user", AgentFindings)

    assert result.summary == "ok"
    assert llm.last_provider == "groq"
    assert gemini.attempts == 1
    assert groq.attempts == 1
    assert deepseek.attempts == 0


async def test_exhausted_gemini_quota_falls_back_to_groq() -> None:
    gemini = _ScriptedLLM([_ProviderError(429) for _ in range(10)])
    groq = _ScriptedLLM([])
    llm = FailoverLLM([("gemini", gemini), ("groq", groq)])

    result = await llm.parse("system", "user", AgentFindings)

    assert result.summary == "ok"
    assert llm.last_provider == "groq"
    assert gemini.attempts == providers.MAX_INFERENCE_ATTEMPTS
    assert groq.attempts == 1


def test_configured_provider_order_is_gemini_groq_deepseek(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    compatible_routes: list[dict] = []

    def fake_compatible(**kwargs):
        compatible_routes.append(kwargs)
        return _ScriptedLLM([])

    monkeypatch.setattr(providers, "GeminiLLM", lambda _settings, _ledger: _ScriptedLLM([]))
    monkeypatch.setattr(providers, "OpenAICompatibleLLM", fake_compatible)

    llm = providers.get_llm(
        Settings(
            google_api_key="test-google-key",
            groq_api_key="test-groq-key",
            deepseek_api_key="test-deepseek-key",
        )
    )

    assert llm.provider_names == ["gemini", "groq", "deepseek"]
    assert [route["model"] for route in compatible_routes] == [
        "openai/gpt-oss-120b",
        "deepseek-v4-flash",
    ]
    assert compatible_routes[0]["supports_json_schema"] is True


def test_requested_provider_runs_first(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        providers,
        "GeminiLLM",
        lambda _settings, _ledger: _ScriptedLLM([]),
    )
    monkeypatch.setattr(providers, "OpenAICompatibleLLM", lambda **_kwargs: _ScriptedLLM([]))

    llm = providers.get_llm(
        Settings(
            google_api_key="test-google-key",
            groq_api_key="test-groq-key",
            deepseek_api_key="test-deepseek-key",
        ),
        "deepseek",
    )

    assert llm.provider_names == ["deepseek", "gemini", "groq"]


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (_ProviderError(429), True),
        (_ProviderError(503), True),
        (_ProviderError(401), False),
        (_ProviderError(422), False),
        (httpx.ConnectTimeout("connect timed out"), True),
        (RuntimeError("Gemini returned no structured output"), False),
    ],
)
def test_transient_classification(error: Exception, expected: bool) -> None:
    assert is_transient_inference_error(error) is expected
