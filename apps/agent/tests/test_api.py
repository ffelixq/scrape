from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


def test_demo_investigation_is_complete() -> None:
    settings = get_settings()
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
