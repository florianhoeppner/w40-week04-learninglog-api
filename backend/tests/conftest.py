"""
Pytest configuration for config tests.

This file sets up test fixtures and prevents .env file loading during tests.
"""

import pytest
import os


@pytest.fixture(autouse=True)
def isolate_environment(monkeypatch, tmp_path):
    """
    Automatically isolate each test's environment.

    - Creates a temporary empty .env file
    - Clears all environment variables that might affect config
    - Each test must explicitly set the variables it needs
    """
    # Create empty .env in temp dir
    temp_env = tmp_path / ".env"
    temp_env.write_text("")

    # Point config to use this empty file
    monkeypatch.setenv("PYDANTIC_ENV_FILE", str(temp_env))

    # Clear common env vars (tests will set what they need)
    env_vars_to_clear = [
        "JWT_SECRET",
        "DEBUG",
        "APP_NAME",
        "ALLOWED_ORIGINS",
        "SENTRY_DSN",
        "DATABASE_PATH",
        "RATE_LIMIT_PER_MINUTE",
        "ACCESS_TOKEN_EXPIRE_MINUTES",
    ]

    for var in env_vars_to_clear:
        monkeypatch.delenv(var, raising=False)
