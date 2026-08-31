from pathlib import Path

import pytest

from app.config import Settings
from app.usage import LocalQuotaExceededError, UsageLedger


def _settings(path: Path, limit: int = 100) -> Settings:
    return Settings(
        usage_db_path=path,
        deepseek_daily_token_limit=limit,
        llm_max_output_tokens=256,
    )


def test_deepseek_reservations_block_calls_before_daily_cap(tmp_path: Path) -> None:
    ledger = UsageLedger(_settings(tmp_path / "usage.sqlite3"))
    first = ledger.reserve_deepseek("a" * 40, 10)

    with pytest.raises(LocalQuotaExceededError):
        ledger.reserve_deepseek("b" * 50, 10)

    ledger.release(first)
    second = ledger.reserve_deepseek("b" * 50, 10)
    ledger.release(second)


def test_settlement_releases_reservation_and_records_actual_tokens(tmp_path: Path) -> None:
    ledger = UsageLedger(_settings(tmp_path / "usage.sqlite3"))
    reservation = ledger.reserve_deepseek("a" * 40, 10)

    ledger.record_llm(
        "deepseek",
        input_tokens=14,
        output_tokens=6,
        total_tokens=20,
        reservation=reservation,
    )

    assert ledger.totals("deepseek") == {
        "requests": 1,
        "input_tokens": 14,
        "output_tokens": 6,
        "total_tokens": 20,
        "credits": 0,
    }
    next_reservation = ledger.reserve_deepseek("b" * 60, 10)
    ledger.release(next_reservation)


def test_search_credits_are_persisted(tmp_path: Path) -> None:
    ledger = UsageLedger(_settings(tmp_path / "usage.sqlite3"))

    ledger.record_search("tavily", 2)
    ledger.record_search("tavily", 2)

    totals = ledger.totals("tavily")
    assert totals["requests"] == 2
    assert totals["credits"] == 4
