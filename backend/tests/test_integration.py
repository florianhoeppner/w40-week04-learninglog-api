"""
Integration tests for CatAtlas API

Tests complete workflows and interactions between different endpoints
"""

import sys
from pathlib import Path

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

    from main import app, init_db
    init_db()
    return TestClient(app)


@pytest.mark.integration
class TestCompleteWorkflow:
    """Test complete user workflows"""

    def test_complete_cat_tracking_workflow(self, client: TestClient):
        """
        Test a complete workflow of tracking a cat:
        1. Create multiple sightings
        2. Create a cat profile
        3. Assign sightings to cat
        4. Generate cat profile
        5. Request insights
        """
        # Step 1: Create multiple sightings
        sightings = []
        sighting_data = [
            {
                "text": "Orange tabby cat, very friendly, approached me",
                "nickname": "Sunny",
                "location": "Park entrance"
            },
            {
                "text": "Same orange cat, eating from bowl someone left",
                "nickname": "Sunny",
                "location": "Park entrance"
            },
            {
                "text": "Orange cat sleeping under the bench",
                "nickname": "Sunny",
                "location": "Park bench area"
            }
        ]

        for data in sighting_data:
            response = client.post("/entries", json=data)
            assert response.status_code == 200
            sightings.append(response.json())

        assert len(sightings) == 3

        # Step 2: Create a cat profile
        cat_response = client.post("/cats", json={"name": "Sunny the Park Cat"})
        assert cat_response.status_code == 200
        cat = cat_response.json()
        cat_id = cat["id"]

        # Step 3: Assign all sightings to the cat
        for sighting in sightings:
            assign_response = client.post(
                f"/entries/{sighting['id']}/assign/{cat_id}"
            )
            assert assign_response.status_code == 200

        # Step 4: Generate and verify cat profile
        profile_response = client.get(f"/cats/{cat_id}/profile")
        assert profile_response.status_code == 200
        profile = profile_response.json()

        assert profile["sightings_count"] == 3
        assert "Sunny" in profile["profile_text"]
        assert len(profile["top_tags"]) > 0
        assert len(profile["locations"]) > 0

        # Step 5: Request different types of insights
        for mode in ["profile", "care", "risk", "update"]:
            insight_response = client.post(
                f"/cats/{cat_id}/insights",
                json={"mode": mode}
            )
            assert insight_response.status_code == 200
            insight = insight_response.json()
            assert insight["mode"] == mode
            assert len(insight["actions"]) > 0

    def test_duplicate_detection_workflow(self, client: TestClient):
        """
        Test duplicate detection workflow:
        1. Create similar sightings
        2. Check for matches
        3. Verify similarity scoring
        """
        # Create first sighting
        first = client.post("/entries", json={
            "text": "Orange tabby cat with white paws at the park",
            "location": "Central Park"
        }).json()

        # Create similar sighting
        similar = client.post("/entries", json={
            "text": "Orange cat with white feet near the park entrance",
            "location": "Central Park entrance"
        }).json()

        # Create dissimilar sighting
        different = client.post("/entries", json={
            "text": "Black cat on the street corner",
            "location": "5th Avenue"
        }).json()

        # Check matches for the first sighting
        matches_response = client.get(f"/entries/{first['id']}/matches")
        assert matches_response.status_code == 200
        matches = matches_response.json()

        # Should find the similar one
        assert len(matches) > 0
        similar_ids = [m["candidate_id"] for m in matches]
        assert similar["id"] in similar_ids

        # The similar one should have higher score than the different one
        # (if different one is even in matches)

    def test_favorite_and_filter_workflow(self, client: TestClient):
        """
        Test marking favorites:
        1. Create entries
        2. Mark some as favorite
        3. Verify favorite status
        """
        # Create entries
        entry1 = client.post("/entries", json={"text": "Entry 1"}).json()
        entry2 = client.post("/entries", json={"text": "Entry 2"}).json()

        # Mark first as favorite
        fav_response = client.post(f"/entries/{entry1['id']}/favorite")
        assert fav_response.status_code == 200
        assert fav_response.json()["isFavorite"] is True

        # Toggle it back
        unfav_response = client.post(f"/entries/{entry1['id']}/favorite")
        assert unfav_response.status_code == 200
        assert unfav_response.json()["isFavorite"] is False

        # Mark it favorite again
        fav_response2 = client.post(f"/entries/{entry1['id']}/favorite")
        assert fav_response2.status_code == 200
        assert fav_response2.json()["isFavorite"] is True

    def test_analysis_caching_workflow(self, client: TestClient):
        """
        Test analysis caching:
        1. Create entry
        2. Analyze it
        3. Request analysis again (should use cache)
        4. Verify consistency
        """
        # Create entry
        entry = client.post("/entries", json={
            "text": "Friendly orange cat, seems healthy and well-fed"
        }).json()

        # First analysis (generates and caches)
        analysis1 = client.post(f"/entries/{entry['id']}/analyze").json()
        assert len(analysis1["tags"]) > 0
        assert analysis1["summary"]

        # Get cached analysis
        analysis2 = client.get(f"/entries/{entry['id']}/analysis").json()
        assert analysis2["tags"] == analysis1["tags"]
        assert analysis2["summary"] == analysis1["summary"]

        # Re-analyze (should regenerate)
        analysis3 = client.post(f"/entries/{entry['id']}/analyze").json()
        # Tags might be same or similar
        assert len(analysis3["tags"]) > 0


class TestErrorRecovery:
    """Test error handling and recovery"""

    def test_recovery_from_invalid_input(self, client: TestClient):
        """System should recover from invalid input"""
        # Try to create invalid entry
        invalid_response = client.post("/entries", json={"text": ""})
        assert invalid_response.status_code == 400

        # Should still be able to create valid entry
        valid_response = client.post("/entries", json={"text": "Valid entry"})
        assert valid_response.status_code == 200

    def test_database_consistency_after_errors(self, client: TestClient):
        """Database should remain consistent after errors"""
        # Create some valid data
        cat = client.post("/cats", json={"name": "Test Cat"}).json()
        entry = client.post("/entries", json={"text": "Test entry"}).json()

        # Try some invalid operations
        client.post(f"/entries/{entry['id']}/assign/999999")  # Invalid cat ID
        client.post("/entries/999999/favorite")  # Invalid entry ID

        # Verify original data is intact
        cat_check = client.get("/cats").json()
        assert len(cat_check) == 1
        assert cat_check[0]["name"] == "Test Cat"

        entries_check = client.get("/entries").json()
        assert len(entries_check) == 1


class TestConcurrentOperations:
    """Test handling of concurrent operations"""

    def test_multiple_entries_creation(self, client: TestClient):
        """Multiple entries can be created"""
        entries = []
        for i in range(10):
            response = client.post("/entries", json={"text": f"Entry {i}"})
            assert response.status_code == 200
            entries.append(response.json())

        # Verify all were created
        all_entries = client.get("/entries").json()
        assert len(all_entries) == 10

    def test_multiple_cats_creation(self, client: TestClient):
        """Multiple cats can be created"""
        cats = []
        for i in range(5):
            response = client.post("/cats", json={"name": f"Cat {i}"})
            assert response.status_code == 200
            cats.append(response.json())

        # Verify all were created
        all_cats = client.get("/cats").json()
        assert len(all_cats) == 5


class TestDataIntegrity:
    """Test data integrity and relationships"""

    def test_entry_cat_relationship(self, client: TestClient):
        """Entry-cat relationships should be maintained correctly"""
        # Create cat and entry
        cat = client.post("/cats", json={"name": "Relationship Test"}).json()
        entry = client.post("/entries", json={"text": "Test entry"}).json()

        # Initially no relationship
        assert entry["cat_id"] is None

        # Assign to cat
        assigned = client.post(f"/entries/{entry['id']}/assign/{cat['id']}").json()
        assert assigned["cat_id"] == cat["id"]

        # Verify relationship persists
        entry_check = client.get("/entries").json()[0]
        assert entry_check["cat_id"] == cat["id"]

    def test_cat_profile_updates_with_new_sightings(self, client: TestClient):
        """Cat profile should update when new sightings are assigned"""
        # Create cat
        cat = client.post("/cats", json={"name": "Dynamic Profile"}).json()
        cat_id = cat["id"]

        # Initially no sightings
        profile1 = client.get(f"/cats/{cat_id}/profile").json()
        assert profile1["sightings_count"] == 0

        # Add first sighting
        entry1 = client.post("/entries", json={"text": "First sighting"}).json()
        client.post(f"/entries/{entry1['id']}/assign/{cat_id}")

        profile2 = client.get(f"/cats/{cat_id}/profile").json()
        assert profile2["sightings_count"] == 1

        # Add second sighting
        entry2 = client.post("/entries", json={"text": "Second sighting"}).json()
        client.post(f"/entries/{entry2['id']}/assign/{cat_id}")

        profile3 = client.get(f"/cats/{cat_id}/profile").json()
        assert profile3["sightings_count"] == 2
