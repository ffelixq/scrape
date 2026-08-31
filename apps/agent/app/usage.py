import asyncio
import json
import math
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx

from app.config import Settings

Provider = Literal["gemini", "groq", "deepseek", "tavily", "serper"]


class LocalQuotaExceededError(RuntimeError):
    """Raised before a paid request can exceed a locally enforced budget."""

    status_code = 429


@dataclass(frozen=True)
class UsageReservation:
    id: str
    provider: Provider
    period_key: str
    tokens: int


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _next_midnight(timezone: str, now: datetime) -> datetime:
    local = now.astimezone(ZoneInfo(timezone))
    tomorrow = local.date() + timedelta(days=1)
    return datetime.combine(tomorrow, datetime.min.time(), ZoneInfo(timezone)).astimezone(UTC)


class UsageLedger:
    """Small durable ledger for provider usage and pre-flight token reservations.

    SQLite's immediate transactions serialize reservations across async tasks and multiple
    Uvicorn worker processes sharing the same database file.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.path = Path(settings.usage_db_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 30000")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS usage_periods (
                    provider TEXT NOT NULL,
                    period_key TEXT NOT NULL,
                    requests INTEGER NOT NULL DEFAULT 0,
                    input_tokens INTEGER NOT NULL DEFAULT 0,
                    output_tokens INTEGER NOT NULL DEFAULT 0,
                    total_tokens INTEGER NOT NULL DEFAULT 0,
                    credits INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (provider, period_key)
                );
                CREATE TABLE IF NOT EXISTS token_reservations (
                    id TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    period_key TEXT NOT NULL,
                    tokens INTEGER NOT NULL,
                    expires_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS token_reservations_period
                    ON token_reservations(provider, period_key);
                CREATE TABLE IF NOT EXISTS provider_state (
                    provider TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    message TEXT NOT NULL DEFAULT '',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    checked_at TEXT NOT NULL
                );
                """
            )

    def _period_key(self, provider: Provider, now: datetime | None = None) -> str:
        instant = now or _now()
        if provider == "gemini":
            return instant.astimezone(ZoneInfo("America/Los_Angeles")).date().isoformat()
        if provider == "deepseek":
            return instant.astimezone(ZoneInfo(self.settings.usage_timezone)).date().isoformat()
        if provider == "tavily":
            return instant.strftime("%Y-%m")
        if provider == "serper":
            return "lifetime"
        return instant.date().isoformat()

    def reserve_deepseek(self, prompt: str, max_output_tokens: int) -> UsageReservation:
        # UTF-8 bytes are a deliberately conservative upper bound for ordinary BPE tokenization.
        estimate = len(prompt.encode("utf-8")) + max_output_tokens
        reservation = UsageReservation(
            id=str(uuid4()),
            provider="deepseek",
            period_key=self._period_key("deepseek"),
            tokens=estimate,
        )
        now = _now()
        expires_at = now + timedelta(minutes=30)
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("DELETE FROM token_reservations WHERE expires_at <= ?", (_iso(now),))
            used_row = connection.execute(
                "SELECT total_tokens FROM usage_periods WHERE provider = ? AND period_key = ?",
                (reservation.provider, reservation.period_key),
            ).fetchone()
            reserved_row = connection.execute(
                "SELECT COALESCE(SUM(tokens), 0) AS tokens FROM token_reservations "
                "WHERE provider = ? AND period_key = ?",
                (reservation.provider, reservation.period_key),
            ).fetchone()
            used = int(used_row["total_tokens"]) if used_row else 0
            reserved = int(reserved_row["tokens"]) if reserved_row else 0
            limit = self.settings.deepseek_daily_token_limit
            if used + reserved + estimate > limit:
                connection.rollback()
                remaining = max(0, limit - used - reserved)
                raise LocalQuotaExceededError(
                    "DeepSeek's local daily token budget is exhausted or too small for this "
                    f"request ({remaining:,} tokens remain before reservation)."
                )
            connection.execute(
                "INSERT INTO token_reservations(id, provider, period_key, tokens, expires_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    reservation.id,
                    reservation.provider,
                    reservation.period_key,
                    reservation.tokens,
                    _iso(expires_at),
                ),
            )
            connection.commit()
        return reservation

    def release(self, reservation: UsageReservation | None) -> None:
        if not reservation:
            return
        with self._connect() as connection:
            connection.execute("DELETE FROM token_reservations WHERE id = ?", (reservation.id,))

    def record_llm(
        self,
        provider: Provider,
        *,
        input_tokens: int,
        output_tokens: int,
        total_tokens: int,
        reservation: UsageReservation | None = None,
    ) -> None:
        period_key = reservation.period_key if reservation else self._period_key(provider)
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if reservation:
                connection.execute("DELETE FROM token_reservations WHERE id = ?", (reservation.id,))
            connection.execute(
                """
                INSERT INTO usage_periods(
                    provider, period_key, requests, input_tokens, output_tokens,
                    total_tokens, credits, updated_at
                ) VALUES (?, ?, 1, ?, ?, ?, 0, ?)
                ON CONFLICT(provider, period_key) DO UPDATE SET
                    requests = requests + 1,
                    input_tokens = input_tokens + excluded.input_tokens,
                    output_tokens = output_tokens + excluded.output_tokens,
                    total_tokens = total_tokens + excluded.total_tokens,
                    updated_at = excluded.updated_at
                """,
                (
                    provider,
                    period_key,
                    max(0, input_tokens),
                    max(0, output_tokens),
                    max(0, total_tokens),
                    _iso(_now()),
                ),
            )
            connection.commit()

    def record_search(self, provider: Provider, credits: int) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO usage_periods(
                    provider, period_key, requests, input_tokens, output_tokens,
                    total_tokens, credits, updated_at
                ) VALUES (?, ?, 1, 0, 0, 0, ?, ?)
                ON CONFLICT(provider, period_key) DO UPDATE SET
                    requests = requests + 1,
                    credits = credits + excluded.credits,
                    updated_at = excluded.updated_at
                """,
                (provider, self._period_key(provider), max(0, credits), _iso(_now())),
            )
        if provider == "tavily":
            state = self.state("tavily")
            metadata = dict(state.get("metadata", {})) if state else {}
            if isinstance(metadata.get("used"), int | float):
                metadata["used"] = int(metadata["used"]) + max(0, credits)
                self.set_state(
                    "tavily",
                    "available",
                    "Credential verified by search.",
                    metadata,
                )

    def totals(self, provider: Provider) -> dict[str, int]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT requests, input_tokens, output_tokens, total_tokens, credits "
                "FROM usage_periods WHERE provider = ? AND period_key = ?",
                (provider, self._period_key(provider)),
            ).fetchone()
        if not row:
            return {
                "requests": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
                "credits": 0,
            }
        keys = ("requests", "input_tokens", "output_tokens", "total_tokens", "credits")
        return {key: int(row[key]) for key in keys}

    def set_state(
        self,
        provider: Provider,
        status: str,
        message: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO provider_state(provider, status, message, metadata_json, checked_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(provider) DO UPDATE SET
                    status = excluded.status,
                    message = excluded.message,
                    metadata_json = CASE
                        WHEN excluded.metadata_json = '{}' THEN provider_state.metadata_json
                        ELSE excluded.metadata_json
                    END,
                    checked_at = excluded.checked_at
                """,
                (provider, status, message[:240], json.dumps(metadata or {}), _iso(_now())),
            )

    def state(self, provider: Provider) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT status, message, metadata_json, checked_at FROM provider_state "
                "WHERE provider = ?",
                (provider,),
            ).fetchone()
        if not row:
            return None
        try:
            metadata = json.loads(row["metadata_json"])
        except json.JSONDecodeError:
            metadata = {}
        return {
            "status": row["status"],
            "message": row["message"],
            "metadata": metadata,
            "checked_at": row["checked_at"],
        }


def _status_for_response(response: httpx.Response) -> tuple[str, str]:
    if response.status_code < 400:
        return "available", "Credential verified without consuming generation tokens."
    if response.status_code in {401, 403}:
        return "needs_attention", "The provider rejected this credential."
    return "unavailable", f"Provider availability check returned HTTP {response.status_code}."


async def refresh_provider_states(settings: Settings, ledger: UsageLedger) -> None:
    now = _now()
    configured: dict[Provider, bool] = {
        "gemini": bool(settings.google_api_key),
        "groq": bool(settings.groq_api_key),
        "deepseek": bool(settings.deepseek_api_key),
        "tavily": bool(settings.tavily_api_key),
        "serper": bool(settings.serper_api_key),
    }
    for provider, is_configured in configured.items():
        if not is_configured:
            ledger.set_state(provider, "not_configured", "No API key is configured.")

    checks: list[tuple[Provider, str, dict[str, str]]] = []
    for provider, url, headers in (
        (
            "gemini",
            f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}",
            {"x-goog-api-key": settings.google_api_key},
        ),
        (
            "groq",
            "https://api.groq.com/openai/v1/models",
            {"Authorization": f"Bearer {settings.groq_api_key}"},
        ),
        (
            "deepseek",
            "https://api.deepseek.com/user/balance",
            {"Authorization": f"Bearer {settings.deepseek_api_key}"},
        ),
        (
            "tavily",
            "https://api.tavily.com/usage",
            {"Authorization": f"Bearer {settings.tavily_api_key}"},
        ),
    ):
        if not configured[provider]:
            continue
        state = ledger.state(provider)
        if state:
            checked_at = datetime.fromisoformat(state["checked_at"].replace("Z", "+00:00"))
            if now - checked_at < timedelta(minutes=5):
                continue
        checks.append((provider, url, headers))

    async with httpx.AsyncClient(
        timeout=12,
        follow_redirects=False,
        headers={"User-Agent": "Proofline/0.1 quota-monitor"},
    ) as client:

        async def check_provider(provider: Provider, url: str, headers: dict[str, str]) -> None:
            try:
                response = await client.get(url, headers=headers)
                status, message = _status_for_response(response)
                metadata: dict[str, Any] = {}
                if response.status_code < 400 and provider == "tavily":
                    payload = response.json()
                    account = payload.get("account", {})
                    metadata = {
                        "plan": account.get("current_plan"),
                        "used": account.get("plan_usage"),
                        "limit": account.get("plan_limit"),
                    }
                elif response.status_code < 400 and provider == "deepseek":
                    metadata = {"balance_available": bool(response.json().get("is_available"))}
                ledger.set_state(provider, status, message, metadata)
            except (httpx.HTTPError, ValueError) as error:
                ledger.set_state(
                    provider,
                    "unavailable",
                    f"Availability check failed ({type(error).__name__}).",
                )

        await asyncio.gather(
            *(check_provider(provider, url, headers) for provider, url, headers in checks)
        )


def _entry(
    *,
    provider: Provider,
    label: str,
    kind: str,
    model: str | None,
    configured: bool,
    state: dict[str, Any] | None,
    used: int,
    limit: int | None,
    unit: str,
    reset_at: datetime | None,
    reset_label: str,
    source: str,
    note: str,
) -> dict[str, Any]:
    return {
        "provider": provider,
        "label": label,
        "kind": kind,
        "model": model,
        "configured": configured,
        "status": state["status"] if state else ("configured" if configured else "not_configured"),
        "used": used,
        "limit": limit,
        "remaining": max(0, limit - used) if limit is not None else None,
        "unit": unit,
        "resetAt": _iso(reset_at) if reset_at else None,
        "resetLabel": reset_label,
        "source": source,
        "note": note,
    }


async def provider_usage_dashboard(settings: Settings) -> dict[str, Any]:
    ledger = UsageLedger(settings)
    await refresh_provider_states(settings, ledger)
    now = _now()
    gemini = ledger.totals("gemini")
    groq = ledger.totals("groq")
    deepseek = ledger.totals("deepseek")
    tavily = ledger.totals("tavily")
    serper = ledger.totals("serper")
    tavily_state = ledger.state("tavily")
    groq_state = ledger.state("groq")
    groq_metadata = groq_state.get("metadata", {}) if groq_state else {}
    groq_remote_limit = groq_metadata.get("request_limit")
    groq_remote_remaining = groq_metadata.get("requests_remaining")
    if isinstance(groq_remote_limit, int) and isinstance(groq_remote_remaining, int):
        groq_limit = groq_remote_limit
        groq_used = max(0, groq_remote_limit - groq_remote_remaining)
        groq_source = "provider"
    else:
        groq_limit = settings.groq_daily_request_limit
        groq_used = groq["requests"]
        groq_source = "local"
    groq_reset_at: datetime | None = None
    if isinstance(groq_metadata.get("requests_reset_at"), str):
        try:
            groq_reset_at = datetime.fromisoformat(
                groq_metadata["requests_reset_at"].replace("Z", "+00:00")
            )
        except ValueError:
            groq_reset_at = None
    tavily_metadata = tavily_state.get("metadata", {}) if tavily_state else {}
    tavily_remote_used = tavily_metadata.get("used")
    tavily_remote_limit = tavily_metadata.get("limit")
    tavily_used = (
        int(tavily_remote_used)
        if isinstance(tavily_remote_used, int | float)
        else tavily["credits"]
    )
    tavily_limit = (
        int(tavily_remote_limit) if isinstance(tavily_remote_limit, int | float) else 1_000
    )

    providers = [
        _entry(
            provider="gemini",
            label="Gemini",
            kind="llm",
            model=settings.gemini_model,
            configured=bool(settings.google_api_key),
            state=ledger.state("gemini"),
            used=gemini["requests"],
            limit=None,
            unit="requests",
            reset_at=_next_midnight("America/Los_Angeles", now),
            reset_label="Daily requests reset at midnight Pacific time.",
            source="local",
            note=(
                f"{gemini['total_tokens']:,} tokens recorded by this app. Google exposes the "
                "project's exact free-tier limit only in AI Studio."
            ),
        ),
        _entry(
            provider="groq",
            label="Groq",
            kind="llm",
            model=settings.groq_model,
            configured=bool(settings.groq_api_key),
            state=groq_state,
            used=groq_used,
            limit=groq_limit,
            unit="requests",
            reset_at=groq_reset_at,
            reset_label="Daily provider quota; the exact reset countdown is returned after a call.",
            source=groq_source,
            note=(
                f"{groq['total_tokens']:,} app tokens against the published "
                f"{settings.groq_daily_token_limit:,}-token free daily allowance for this model."
            ),
        ),
        _entry(
            provider="deepseek",
            label="DeepSeek",
            kind="llm",
            model=settings.deepseek_model,
            configured=bool(settings.deepseek_api_key),
            state=ledger.state("deepseek"),
            used=deepseek["total_tokens"],
            limit=settings.deepseek_daily_token_limit,
            unit="tokens",
            reset_at=_next_midnight(settings.usage_timezone, now),
            reset_label=f"Hard local limit resets at midnight {settings.usage_timezone}.",
            source="local_hard_limit",
            note=(
                "A transactional pre-flight reservation prevents new calls from crossing this cap."
            ),
        ),
        _entry(
            provider="tavily",
            label="Tavily",
            kind="search",
            model=None,
            configured=bool(settings.tavily_api_key),
            state=tavily_state,
            used=tavily_used,
            limit=tavily_limit,
            unit="credits",
            reset_at=None,
            reset_label=(
                "Credits reset on the first day of each month; Tavily does not publish the "
                "reset timezone."
            ),
            source="provider" if tavily_remote_used is not None else "local",
            note=(
                f"{tavily_metadata.get('plan', 'Researcher')} plan. Advanced searches cost "
                "2 credits each."
            ),
        ),
        _entry(
            provider="serper",
            label="Serper",
            kind="search",
            model=None,
            configured=bool(settings.serper_api_key),
            state=ledger.state("serper"),
            used=serper["credits"],
            limit=settings.serper_total_credit_limit,
            unit="credits",
            reset_at=None,
            reset_label="The free sign-up credits do not automatically renew.",
            source="local",
            note=(
                "App-recorded use only; Serper does not document a balance API, so usage outside "
                "Proofline is not visible here."
            ),
        ),
    ]
    return {
        "updatedAt": _iso(now),
        "timezone": settings.usage_timezone,
        "providers": providers,
    }


def parse_reset_duration(value: str | None) -> datetime | None:
    """Convert Groq's compact reset header (for example 2m59.56s) to an instant."""
    if not value:
        return None
    remaining = value.strip().lower()
    total = 0.0
    for suffix, multiplier in (("h", 3600), ("m", 60), ("s", 1)):
        if suffix not in remaining:
            continue
        before, remaining = remaining.split(suffix, 1)
        number = before.rsplit(" ", 1)[-1]
        try:
            total += float(number) * multiplier
        except ValueError:
            return None
    if not math.isfinite(total) or total < 0:
        return None
    return _now() + timedelta(seconds=total)
