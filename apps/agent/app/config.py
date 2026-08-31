from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

CONFIG_PATH = Path(__file__).resolve()
ROOT_ENV = CONFIG_PATH.parents[3] / ".env" if len(CONFIG_PATH.parents) > 3 else Path.cwd() / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ROOT_ENV, ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    demo_mode: bool = True
    internal_agent_token: str = "local-development-token"
    llm_temperature: float = Field(default=0.1, ge=0, le=1)

    google_api_key: str = ""
    gemini_model: str = "gemini-3.7-flash"
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-v4-flash"
    deepseek_daily_token_limit: int = Field(default=500_000, ge=1)
    groq_daily_token_limit: int = Field(default=200_000, ge=1)
    groq_daily_request_limit: int = Field(default=1_000, ge=1)
    serper_total_credit_limit: int = Field(default=2_500, ge=1)
    llm_max_output_tokens: int = Field(default=4_096, ge=256, le=32_768)
    usage_db_path: Path = Path(".data/provider-usage.sqlite3")
    usage_timezone: str = "Asia/Singapore"

    search_provider: Literal["tavily", "serper"] = "tavily"
    tavily_api_key: str = ""
    serper_api_key: str = ""

    daytona_api_key: str = ""
    daytona_api_url: str = "https://app.daytona.io/api"
    daytona_target: str = "us"
    daytona_snapshot: str = ""
    daytona_sandbox_ttl_minutes: int = Field(default=15, ge=1, le=120)
    daytona_command_timeout_seconds: int = Field(default=120, ge=10, le=600)
    daytona_domain_allow_list: str = ""

    max_sources_per_investigation: int = Field(default=20, ge=3, le=50)
    max_download_bytes: int = Field(default=25_000_000, ge=1_000_000, le=100_000_000)
    research_timeout_seconds: int = Field(default=300, ge=30, le=1_800)
    allow_private_networks: bool = False
    prompt_injection_sensitivity: Literal["low", "medium", "high"] = "medium"

    def require_live_credentials(self) -> None:
        missing: list[str] = []
        if not self.daytona_api_key:
            missing.append("DAYTONA_API_KEY")
        if not self.tavily_api_key and not self.serper_api_key:
            missing.append("TAVILY_API_KEY or SERPER_API_KEY")
        if not self.google_api_key and not self.groq_api_key and not self.deepseek_api_key:
            missing.append("GOOGLE_API_KEY, GROQ_API_KEY, or DEEPSEEK_API_KEY")
        if missing:
            raise RuntimeError(f"Live mode is missing: {', '.join(missing)}")


@lru_cache
def get_settings() -> Settings:
    return Settings()
