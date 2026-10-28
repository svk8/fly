"""
Configuration module using Pydantic Settings.
Loads environment variables from .env file or system environment.
"""

from typing import List
from pydantic import Field, AliasChoices
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    BOT_TOKEN: str = Field(..., description="Telegram Bot API Token from @BotFather")
    DATABASE_URL: str = Field(
        default="sqlite+aiosqlite:///./data/crowdship.db",
        description="Async SQLAlchemy database URL (PostgreSQL or SQLite)"
    )
    ADMIN_IDS_RAW: str = Field(default="", alias="ADMIN_IDS")
    WEBAPP_URL: str = Field(default="", validation_alias=AliasChoices("APP_URL", "WEBAPP_URL"))
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    BOT_POLLING: bool = True
    DEBUG: bool = Field(default=False)
    TIMEZONE: str = Field(default="Europe/Moscow")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def admin_ids(self) -> List[int]:
        if not self.ADMIN_IDS_RAW.strip():
            return []
        try:
            return [int(x.strip()) for x in self.ADMIN_IDS_RAW.split(",") if x.strip()]
        except ValueError:
            return []


# Singleton configuration instance
settings = Settings()
