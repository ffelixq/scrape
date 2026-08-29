import asyncio
import secrets
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status

from app.config import Settings, get_settings
from app.models import InvestigationRequest, InvestigationResult, utc_now
from app.orchestrator import ResearchOrchestrator

app = FastAPI(
    title="Proofline Research Agent",
    description="Adversarial evidence research inside isolated Daytona computers.",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
)
research_slots = asyncio.Semaphore(8)
SettingsDependency = Annotated[Settings, Depends(get_settings)]


def require_internal_token(
    settings: SettingsDependency,
    authorization: str = Header(default=""),
) -> None:
    expected = f"Bearer {settings.internal_agent_token}"
    if not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


@app.get("/health")
async def health(settings: SettingsDependency) -> dict:
    return {
        "status": "ok",
        "service": "proofline-agent",
        "mode": "demo" if settings.demo_mode else "live",
        "daytona": "configured" if settings.daytona_api_key else "awaiting_key",
        "nosana": "configured" if settings.nosana_endpoint_url else "awaiting_endpoint",
        "at": utc_now(),
    }


@app.post(
    "/investigate",
    response_model=InvestigationResult,
    dependencies=[Depends(require_internal_token)],
)
async def investigate(
    request: InvestigationRequest,
    settings: SettingsDependency,
) -> InvestigationResult:
    async with research_slots:
        try:
            return await asyncio.wait_for(
                ResearchOrchestrator(settings).investigate(request),
                timeout=settings.research_timeout_seconds,
            )
        except TimeoutError as error:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Research exceeded the configured safety timeout.",
            ) from error
