"""
Tests for configuration management (config.py).

These tests verify that settings load correctly, validate properly,
and handle various edge cases.
"""

import pytest
import os
from pydantic import ValidationError


def test_settings_load_with_defaults(monkeypatch, tmp_path):
    """Test that settings load with default values when only JWT_SECRET is set."""
    # Create minimal env file with debug mode to avoid production validation
    fake_env = tmp_path / ".env"
    fake_env.write_text("JWT_SECRET=test-secret-key-at-least-32-characters-long-for-security\nDEBUG=True\n")

    # Import Settings with isolated env file
    from config import Settings
    settings = Settings(_env_file=str(fake_env))

    # Verify defaults
    assert settings.app_name == "CatAtlas API"
    assert settings.jwt_algorithm == "HS256"
    assert settings.rate_limit_per_minute == 100
    assert settings.access_token_expire_minutes == 30
    assert settings.debug is True


def test_settings_require_jwt_secret(monkeypatch, tmp_path):
    """Test that JWT_SECRET has an insecure default for dev that fails in production."""
    # Create env file with DEBUG=True to avoid production validation on import
    fake_env = tmp_path / ".env"
    fake_env.write_text("DEBUG=True\n")

    # Clear JWT_SECRET from environment
    monkeypatch.delenv("JWT_SECRET", raising=False)

    # Import Settings - should work with default value in dev mode
    from config import Settings
    settings = Settings(_env_file=str(fake_env))

    # Verify it uses the insecure default
    assert settings.jwt_secret == "insecure-dev-key-change-in-production-min-32-chars"

    # Verify production mode rejects the insecure default
    settings.debug = False
    with pytest.raises(ValueError) as exc_info:
        settings.validate_production_settings()

    assert "JWT_SECRET must be changed" in str(exc_info.value)


def test_settings_validate_production_mode(monkeypatch):
    """Test production validation catches insecure defaults."""
    # Set insecure JWT_SECRET but DEBUG=True to allow Settings creation
    monkeypatch.setenv("JWT_SECRET", "change-me-in-production")
    monkeypatch.setenv("DEBUG", "True")

    from config import Settings
    settings = Settings()

    # Manually set to production mode and test validation
    settings.debug = False
    # Production validation should catch weak secret
    with pytest.raises(ValueError, match="JWT_SECRET must be changed"):
        settings.validate_production_settings()


def test_allowed_origins_parsing_multiple(monkeypatch):
    """Test parsing comma-separated allowed origins."""
    monkeypatch.setenv("JWT_SECRET", "test-secret-32-characters-long-enough-for-validation")
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost:3000,https://example.com")
    monkeypatch.setenv("DEBUG", "True")

    from config import Settings
    settings = Settings()

    assert len(settings.allowed_origins_list) == 2
    assert "http://localhost:3000" in settings.allowed_origins_list


def test_optional_sentry_dsn(monkeypatch, tmp_path):
    """Test that sentry_dsn is optional."""
    fake_env = tmp_path / ".env"
    fake_env.write_text("JWT_SECRET=test-secret-32-characters-long-enough\nDEBUG=True\n")

    from config import Settings
    settings = Settings(_env_file=str(fake_env))

    # Empty string or None both acceptable
    assert settings.sentry_dsn is None or settings.sentry_dsn == ""
