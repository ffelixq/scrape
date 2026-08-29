import httpx
import pytest

from app import providers
from app.models import AgentFindings
from app.providers import StructuredLLM, is_transient_inference_error


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
