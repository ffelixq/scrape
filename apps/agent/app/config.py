from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ROOT_ENV, ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    demo_mode: bool = True
    internal_agent_token: str = "local-development-token"
    llm_provider: Literal["openai", "gemini", "kimi", "nosana"] = "openai"
    llm_temperature: float = Field(default=0.1, ge=0, le=1)

    openai_api_key: str = ""
    openai_model: str = "gpt-5-mini"
    google_api_key: str = ""
    gemini_model: str = "gemini-3.6-flash"
    kimi_api_key: str = ""
    kimi_base_url: str = "https://api.moonshot.ai/v1"
    kimi_model: str = "kimi-k2.5"

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

    nosana_endpoint_url: str = ""
    nosana_api_key: str = ""
    nosana_model: str = "llama3.1"

    max_sources_per_investigation: int = Field(default=20, ge=3, le=50)
    max_download_bytes: int = Field(default=25_000_000, ge=1_000_000, le=100_000_000)
    research_timeout_seconds: int = Field(default=300, ge=30, le=1_800)
    allow_private_networks: bool = False
    prompt_injection_sensitivity: Literal["low", "medium", "high"] = "medium"

    def require_live_credentials(self) -> None:
        missing: list[str] = []
        if not self.daytona_api_key:
            missing.append("DAYTONA_API_KEY")
        if self.search_provider == "tavily" and not self.tavily_api_key:
            missing.append("TAVILY_API_KEY")
        if self.search_provider == "serper" and not self.serper_api_key:
            missing.append("SERPER_API_KEY")
        provider_keys = {
            "openai": self.openai_api_key,
            "gemini": self.google_api_key,
            "kimi": self.kimi_api_key,
            "nosana": self.nosana_endpoint_url,
        }
        if not provider_keys[self.llm_provider]:
            missing.append(
                {
                    "openai": "OPENAI_API_KEY",
                    "gemini": "GOOGLE_API_KEY",
                    "kimi": "KIMI_API_KEY",
                    "nosana": "NOSANA_ENDPOINT_URL",
                }[self.llm_provider]
            )
        if not self.nosana_endpoint_url:
            missing.append("NOSANA_ENDPOINT_URL")
        if missing:
            raise RuntimeError(f"Live mode is missing: {', '.join(missing)}")


@lru_cache
def get_settings() -> Settings:
    return Settings()
