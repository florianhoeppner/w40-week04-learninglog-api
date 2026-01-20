"""
Application configuration with environment variable validation.

This module provides type-safe configuration management using Pydantic Settings.
All configuration is loaded from environment variables or .env files.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from typing import List, Optional, Union
import os


class Settings(BaseSettings):
    """Application configuration with validation."""

    # Application
    app_name: str = "CatAtlas API"
    app_version: str = "1.0.0"
    debug: bool = False

    # Database
    database_path: str = "learninglog.db"

    # Authentication
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    # Security
    allowed_origins: str = "http://localhost:5173"  # Changed to str, will parse in validator
    rate_limit_per_minute: int = 100
    auth_rate_limit_per_minute: int = 5

    # Monitoring
    sentry_dsn: Optional[str] = None
    log_level: str = "INFO"

    # Feature Flags
    enable_registration: bool = True

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=False,
        extra="ignore"
    )

    @property
    def allowed_origins_list(self) -> List[str]:
        """Parse allowed_origins as a list."""
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    def validate_production_settings(self):
        """Validate critical production settings.

        Raises:
            ValueError: If production settings are insecure
        """
        if not self.debug:
            # Production mode - enforce strict requirements
            if self.jwt_secret == "change-me-in-production":
                raise ValueError(
                    "JWT_SECRET must be changed in production! "
                    "Generate a secure secret with: python3 -c \"import secrets; print(secrets.token_hex(32))\""
                )

            if "*" in self.allowed_origins:
                raise ValueError(
                    "ALLOWED_ORIGINS cannot include '*' in production! "
                    "Set specific domains: ALLOWED_ORIGINS=https://your-domain.com"
                )

            if len(self.jwt_secret) < 32:
                raise ValueError(
                    f"JWT_SECRET must be at least 32 characters in production! "
                    f"Current length: {len(self.jwt_secret)}"
                )

        return True


# Singleton instance
settings = Settings()

# Validate on import in production
if not settings.debug:
    settings.validate_production_settings()
