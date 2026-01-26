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
    app_version: str = "1.0.2"  # Fix PostgreSQL column name casing
    debug: bool = False

    # Database
    database_url: Optional[str] = None  # PostgreSQL connection string
    database_path: str = "learninglog.db"  # SQLite fallback for local dev

    # Authentication
    jwt_secret: str = "insecure-dev-key-change-in-production-min-32-chars"
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

    # Image Upload (Bunny.net)
    bunny_storage_zone: Optional[str] = None  # e.g., "catatlas"
    bunny_api_key: Optional[str] = None  # Storage API key
    bunny_storage_region: str = "de"  # Default: Germany (de, ny, la, sg, syd)
    bunny_cdn_hostname: Optional[str] = None  # e.g., "catatlas.b-cdn.net"
    max_upload_size_mb: int = 10  # Maximum file size in MB
    allowed_image_types: str = "image/jpeg,image/png,image/webp,image/gif"

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=False,
        extra="ignore"
    )

    @property
    def allowed_origins_list(self) -> List[str]:
        """Parse allowed_origins as a list."""
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def is_postgres(self) -> bool:
        """Check if using PostgreSQL (vs SQLite)."""
        return self.database_url is not None and self.database_url.startswith("postgres")

    @property
    def allowed_image_types_list(self) -> List[str]:
        """Parse allowed image types as a list."""
        return [t.strip() for t in self.allowed_image_types.split(",") if t.strip()]

    @property
    def max_upload_size_bytes(self) -> int:
        """Convert max upload size to bytes."""
        return self.max_upload_size_mb * 1024 * 1024

    @property
    def bunny_storage_url(self) -> Optional[str]:
        """Generate Bunny.net storage API URL."""
        if not self.bunny_storage_zone:
            return None
        return f"https://{self.bunny_storage_region}.storage.bunnycdn.com/{self.bunny_storage_zone}"

    @property
    def bunny_cdn_url(self) -> Optional[str]:
        """Generate Bunny.net CDN URL for serving images."""
        if not self.bunny_cdn_hostname:
            return None
        return f"https://{self.bunny_cdn_hostname}"

    def validate_production_settings(self):
        """Validate critical production settings.

        Raises:
            ValueError: If production settings are insecure
        """
        if not self.debug:
            # Production mode - enforce strict requirements
            if self.jwt_secret in ["change-me-in-production", "insecure-dev-key-change-in-production-min-32-chars"]:
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
