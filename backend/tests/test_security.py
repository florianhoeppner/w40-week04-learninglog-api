"""
Security tests for CatAtlas API

Tests for:
- SQL injection attempts
- CORS configuration
- Input sanitization
- Error message information disclosure
"""

import sys
from pathlib import Path
import importlib

# Add backend directory to Python import path
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import os
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path: Path):
    """Create a TestClient pointing to a fresh temp DB for each test."""
    db_path = tmp_path / "test.db"
    os.environ["CATATLAS_DB_PATH"] = str(db_path)

    # Reload modules to pick up new environment variables
    import config
    import main
    importlib.reload(config)
    importlib.reload(main)
    main.init_db()
    return TestClient(main.app)


class TestSQLInjection:
    """Test protection against SQL injection attacks"""

    def test_sql_injection_in_text_field(self, client: TestClient):
        """SQL injection in text field should be treated as text"""
        malicious_text = "'; DROP TABLE entries; --"
        response = client.post("/entries", json={"text": malicious_text})
        assert response.status_code == 200

        # Verify the malicious text was stored as text, not executed
        entry = response.json()
        assert entry["text"] == malicious_text

        # Verify entries table still exists by creating another entry
        response2 = client.post("/entries", json={"text": "Normal entry"})
        assert response2.status_code == 200

    def test_sql_injection_in_nickname(self, client: TestClient):
        """SQL injection in nickname should be treated as text"""
        response = client.post("/entries", json={
            "text": "Valid text",
            "nickname": "'; DELETE FROM entries WHERE '1'='1"
        })
        assert response.status_code == 200

        # Verify data still exists
        all_entries = client.get("/entries")
        assert all_entries.status_code == 200
        assert len(all_entries.json()) > 0

    def test_sql_injection_in_location(self, client: TestClient):
        """SQL injection in location should be treated as text"""
        response = client.post("/entries", json={
            "text": "Valid text",
            "location": "' OR '1'='1'; DROP TABLE cats; --"
        })
        assert response.status_code == 200

        # Verify cats table still works
        cat_response = client.post("/cats", json={"name": "Test"})
        assert cat_response.status_code == 200

    def test_sql_injection_in_cat_name(self, client: TestClient):
        """SQL injection in cat name should be treated as text"""
        malicious_name = "'; DROP TABLE entries; SELECT '"
        response = client.post("/cats", json={"name": malicious_name})
        assert response.status_code == 200

        cat = response.json()
        assert cat["name"] == malicious_name

    def test_union_based_injection(self, client: TestClient):
        """UNION-based SQL injection should not work"""
        response = client.post("/entries", json={
            "text": "' UNION SELECT * FROM cats --"
        })
        assert response.status_code == 200

        # The malicious query should be stored as text
        entry = response.json()
        assert "UNION" in entry["text"]

    def test_boolean_based_blind_injection(self, client: TestClient):
        """Boolean-based blind SQL injection should not work"""
        response = client.post("/entries", json={
            "text": "Valid text",
            "nickname": "Test' AND '1'='1"
        })
        assert response.status_code == 200

        entry = response.json()
        assert entry["nickname"] == "Test' AND '1'='1"

    def test_time_based_blind_injection(self, client: TestClient):
        """Time-based blind SQL injection should not work"""
        import time
        start_time = time.time()

        response = client.post("/entries", json={
            "text": "'; WAITFOR DELAY '00:00:05'; --"
        })

        elapsed_time = time.time() - start_time

        # Should complete quickly (not wait 5 seconds)
        assert elapsed_time < 2.0
        assert response.status_code == 200


class TestCORSConfiguration:
    """Test CORS configuration and headers

    Note: TestClient must send Origin header for CORS middleware to respond.
    """

    def test_cors_preflight_request(self, client: TestClient):
        """OPTIONS request should include CORS headers"""
        response = client.options(
            "/entries",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST"
            }
        )
        # CORS middleware responds to preflight
        assert "access-control-allow-origin" in response.headers

    def test_cors_on_get_request(self, client: TestClient):
        """GET request should include CORS headers"""
        response = client.get("/entries", headers={"Origin": "http://localhost:5173"})
        assert response.status_code == 200
        assert "access-control-allow-origin" in response.headers

    def test_cors_on_post_request(self, client: TestClient):
        """POST request should include CORS headers"""
        response = client.post(
            "/entries",
            json={"text": "Test"},
            headers={"Origin": "http://localhost:5173"}
        )
        assert response.status_code == 200
        assert "access-control-allow-origin" in response.headers

    def test_cors_credentials_allowed(self, client: TestClient):
        """CORS should allow credentials"""
        response = client.get("/health", headers={"Origin": "http://localhost:5173"})
        assert "access-control-allow-credentials" in response.headers


class TestInputSanitization:
    """Test input sanitization and XSS protection"""

    def test_html_tags_in_text(self, client: TestClient):
        """HTML tags should be stored as-is (API responsibility to sanitize on frontend)"""
        response = client.post("/entries", json={
            "text": "<script>alert('XSS')</script>Saw a cat"
        })
        assert response.status_code == 200
        entry = response.json()
        # The API stores it as-is; frontend should escape it
        assert "<script>" in entry["text"]

    def test_javascript_in_nickname(self, client: TestClient):
        """JavaScript in nickname should be stored as text"""
        response = client.post("/entries", json={
            "text": "Valid text",
            "nickname": "javascript:alert(1)"
        })
        assert response.status_code == 200
        entry = response.json()
        assert entry["nickname"] == "javascript:alert(1)"

    def test_null_byte_injection(self, client: TestClient):
        """Null byte injection should be handled"""
        # Python 3 handles null bytes in strings safely
        response = client.post("/entries", json={
            "text": "Text with\x00null byte"
        })
        # Should either succeed or be rejected cleanly
        assert response.status_code in [200, 400, 422]


class TestErrorMessageSecurity:
    """Test that error messages don't leak sensitive information"""

    def test_database_error_message(self, client: TestClient):
        """Database errors should not leak internal details"""
        # Use an actual route that exists with path parameter validation
        response = client.get("/entries/not_an_integer/analysis")

        # Should get a validation error, not a database error message
        assert response.status_code == 422

        # Error should not contain SQL or database internals
        error_text = str(response.json()).lower()
        assert "sqlite" not in error_text
        assert "database" not in error_text or "error" in error_text

    def test_404_message_does_not_leak_info(self, client: TestClient):
        """404 errors should be generic"""
        response = client.get("/cats/999999/profile")
        assert response.status_code == 404

        error_detail = response.json()["detail"].lower()
        # Should mention resource not found, but not expose internals
        assert "not found" in error_detail


class TestRateLimiting:
    """Test rate limiting (if implemented)"""

    def test_multiple_rapid_requests(self, client: TestClient):
        """Multiple rapid requests should be handled gracefully"""
        # Create many entries rapidly
        responses = []
        for i in range(50):
            response = client.post("/entries", json={"text": f"Entry {i}"})
            responses.append(response)

        # All should succeed (or some might be rate limited if implemented)
        success_count = sum(1 for r in responses if r.status_code == 200)

        # At minimum, some requests should succeed
        assert success_count > 0

        # If rate limiting is implemented, some might be 429
        rate_limited = sum(1 for r in responses if r.status_code == 429)

        # Either all succeed or some are rate limited
        assert success_count + rate_limited == len(responses)
