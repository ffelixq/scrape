import asyncio
import logging
import secrets
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status

from app.config import Settings, get_settings
from app.models import InvestigationRequest, InvestigationResult, utc_now
from app.orchestrator import ResearchOrchestrator
from app.providers import inference_status_code, is_transient_inference_error

logger = logging.getLogger(__name__)


def classify_live_failure(error: BaseException) -> str:
    """Describe a live failure using a closed vocabulary.

    Upstream failure text can carry untrusted page or sandbox output, so it is logged
    but never returned to the caller. Only the class of failure crosses the boundary,
    which is enough to tell an exhausted quota apart from an unreachable dependency.
    """
    if inference_status_code(error) == 429:
        return (
            "The configured inference provider refused the request because its quota or "
            "rate limit is exhausted."
        )
    if is_transient_inference_error(error):
        return "A live research dependency stayed unavailable through its bounded retries."
    return f"A live research dependency failed ({type(error).__name__})."


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
        except Exception as error:
            logger.exception("Live investigation failed")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"No conclusion was produced. {classify_live_failure(error)}",
            ) from error
