"""
Test input validation, edge cases, and error handling

Tests for:
- Empty/invalid inputs
- Field length limits
- Invalid data types
- Boundary conditions
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


class TestEntryValidation:
    """Test entry creation validation"""

    def test_empty_text_rejected(self, client: TestClient):
        """Empty text should be rejected by Pydantic min_length validation"""
        response = client.post("/entries", json={"text": ""})
        assert response.status_code == 422  # Pydantic validation error

    def test_whitespace_only_text_rejected(self, client: TestClient):
        """Whitespace-only text should be rejected"""
        response = client.post("/entries", json={"text": "   \n\t  "})
        assert response.status_code == 400

    def test_text_max_length(self, client: TestClient):
        """Text exceeding max length should be rejected"""
        long_text = "x" * 5001  # Max is 5000
        response = client.post("/entries", json={"text": long_text})
        assert response.status_code == 422
        errors = response.json()["detail"]
        assert any("text" in str(e).lower() for e in errors)

    def test_nickname_max_length(self, client: TestClient):
        """Nickname exceeding max length should be rejected"""
        response = client.post("/entries", json={
            "text": "Valid text",
            "nickname": "x" * 101  # Max is 100
        })
        assert response.status_code == 422

    def test_location_max_length(self, client: TestClient):
        """Location exceeding max length should be rejected"""
        response = client.post("/entries", json={
            "text": "Valid text",
            "location": "x" * 201  # Max is 200
        })
        assert response.status_code == 422

    def test_photo_url_max_length(self, client: TestClient):
        """Photo URL exceeding max length should be rejected"""
        response = client.post("/entries", json={
            "text": "Valid text",
            "photo_url": "https://example.com/" + "x" * 1000  # Max is 1000
        })
        assert response.status_code == 422

    def test_valid_entry_at_boundary(self, client: TestClient):
        """Valid entry at boundary conditions should succeed"""
        response = client.post("/entries", json={
            "text": "x" * 5000,  # Max allowed
            "nickname": "x" * 100,  # Max allowed
            "location": "x" * 200,  # Max allowed
            "photo_url": "https://example.com/" + "x" * 970  # Max allowed (1000 total)
        })
        assert response.status_code == 200

    def test_optional_fields_can_be_null(self, client: TestClient):
        """Optional fields should accept None/null"""
        response = client.post("/entries", json={
            "text": "Just some text",
            "nickname": None,
            "location": None,
            "photo_url": None
        })
        assert response.status_code == 200
        entry = response.json()
        assert entry["nickname"] is None
        assert entry["location"] is None
        assert entry["photo_url"] is None


class TestCatValidation:
    """Test cat creation validation"""

    def test_cat_name_max_length(self, client: TestClient):
        """Cat name exceeding max length should be rejected"""
        response = client.post("/cats", json={"name": "x" * 101})  # Max is 100
        assert response.status_code == 422

    def test_cat_without_name(self, client: TestClient):
        """Cat can be created without a name"""
        response = client.post("/cats", json={})
        assert response.status_code == 200
        cat = response.json()
        assert cat["name"] is None

    def test_cat_with_valid_name(self, client: TestClient):
        """Cat with valid name should succeed"""
        response = client.post("/cats", json={"name": "Fluffy"})
        assert response.status_code == 200
        cat = response.json()
        assert cat["name"] == "Fluffy"


class TestInsightValidation:
    """Test cat insight request validation"""

    def test_invalid_insight_mode_rejected(self, client: TestClient):
        """Invalid insight mode should be rejected"""
        # Create a cat first
        cat_response = client.post("/cats", json={"name": "Test Cat"})
        cat_id = cat_response.json()["id"]

        # Try invalid mode
        response = client.post(f"/cats/{cat_id}/insights", json={
            "mode": "invalid_mode"
        })
        assert response.status_code == 422

    def test_valid_insight_modes(self, client: TestClient):
        """All valid insight modes should be accepted"""
        # Create a cat with sightings
        cat_response = client.post("/cats", json={"name": "Test Cat"})
        cat_id = cat_response.json()["id"]

        entry_response = client.post("/entries", json={"text": "Saw an orange cat"})
        entry_id = entry_response.json()["id"]
        client.post(f"/entries/{entry_id}/assign/{cat_id}")

        valid_modes = ["profile", "care", "update", "risk"]
        for mode in valid_modes:
            response = client.post(f"/cats/{cat_id}/insights", json={"mode": mode})
            assert response.status_code == 200, f"Mode {mode} should be valid"

    def test_insight_question_max_length(self, client: TestClient):
        """Insight question exceeding max length should be rejected"""
        cat_response = client.post("/cats", json={"name": "Test Cat"})
        cat_id = cat_response.json()["id"]

        response = client.post(f"/cats/{cat_id}/insights", json={
            "mode": "profile",
            "question": "x" * 501  # Max is 500
        })
        assert response.status_code == 422


class TestErrorHandling:
    """Test error handling for various scenarios"""

    def test_nonexistent_entry_returns_404(self, client: TestClient):
        """Accessing non-existent entry should return 404"""
        response = client.post("/entries/999999/favorite")
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_nonexistent_cat_returns_404(self, client: TestClient):
        """Accessing non-existent cat should return 404"""
        response = client.get("/cats/999999/profile")
        assert response.status_code == 404

    def test_assign_to_nonexistent_cat(self, client: TestClient):
        """Assigning entry to non-existent cat should return 404"""
        entry_response = client.post("/entries", json={"text": "Test entry"})
        entry_id = entry_response.json()["id"]

        response = client.post(f"/entries/{entry_id}/assign/999999")
        assert response.status_code == 404

    def test_analyze_nonexistent_entry(self, client: TestClient):
        """Analyzing non-existent entry should return 404"""
        response = client.post("/entries/999999/analyze")
        assert response.status_code == 404


class TestEdgeCases:
    """Test edge cases and boundary conditions"""

    def test_unicode_text_handling(self, client: TestClient):
        """Unicode characters should be handled correctly"""
        response = client.post("/entries", json={
            "text": "Cat with emoji 😺 and unicode: 日本語",
            "nickname": "Émilie",
            "location": "Café Münchën"
        })
        assert response.status_code == 200
        entry = response.json()
        assert "😺" in entry["text"]
        assert "Émilie" == entry["nickname"]

    def test_special_characters_in_location(self, client: TestClient):
        """Special characters in location should be handled"""
        response = client.post("/entries", json={
            "text": "Saw a cat",
            "location": "5th & Main St., Apt #3-B (2nd floor)"
        })
        assert response.status_code == 200

    def test_very_long_url(self, client: TestClient):
        """Very long but valid URL should be handled"""
        long_url = "https://example.com/" + "path/" * 100 + "image.jpg"
        if len(long_url) <= 1000:
            response = client.post("/entries", json={
                "text": "Cat photo",
                "photo_url": long_url
            })
            assert response.status_code == 200
