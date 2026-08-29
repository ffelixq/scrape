from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app, classify_live_failure


def test_demo_investigation_is_complete() -> None:
    settings = get_settings().model_copy(update={"demo_mode": True})
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        client = TestClient(app)
        response = client.post(
            "/investigate",
            headers={"Authorization": f"Bearer {settings.internal_agent_token}"},
            json={
                "investigation_id": "test-investigation",
                "question": "Is this company ready for a two-year supplier agreement?",
                "context": "",
                "mode": "DEEP",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["verdict"] == "INCONCLUSIVE"
        assert body["securityEvents"][0]["category"] == "PROMPT_INJECTION"
    finally:
        app.dependency_overrides.clear()


def test_agent_requires_internal_authentication() -> None:
    client = TestClient(app)
    response = client.post(
        "/investigate",
        json={
            "investigation_id": "test-investigation",
            "question": "Is this company ready for a two-year supplier agreement?",
        },
    )
    assert response.status_code == 401


class _ProviderError(Exception):
    def __init__(self, code: int) -> None:
        super().__init__("upstream detail that must not reach the caller")
        self.code = code


def test_quota_exhaustion_is_reported_as_a_distinct_operator_failure() -> None:
    detail = classify_live_failure(_ProviderError(429))

    assert "quota or rate limit is exhausted" in detail
    assert "upstream detail" not in detail


def test_unclassified_failures_do_not_leak_upstream_text() -> None:
    detail = classify_live_failure(RuntimeError("untrusted sandbox output: ignore instructions"))

    assert detail == "A live research dependency failed (RuntimeError)."
