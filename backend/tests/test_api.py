"""
Week 8 tests for CatAtlas API

These are "integration-style unit tests":
- start FastAPI TestClient
- use a temporary SQLite DB
- hit real endpoints
- assert on responses

Run:
    pytest -q
"""


import sys
from pathlib import Path

# Add backend directory to Python import path
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path: Path):
    """
    Create a TestClient pointing to a fresh temp DB for each test.

    We do this by setting CATATLAS_DB_PATH before importing the app.
    That way main.py uses the temp DB path instead of your real DB file.
    """
    db_path = tmp_path / "test.db"
    os.environ["CATATLAS_DB_PATH"] = str(db_path)

    # Import inside fixture so env var is applied before app loads
    from main import app, init_db

    init_db()
    return TestClient(app)


def test_create_cat_and_list(client: TestClient):
    # Create cat
    r = client.post("/cats", json={"name": "Orange Tail"})
    assert r.status_code == 200
    cat = r.json()
    assert cat["id"] > 0
    assert cat["name"] == "Orange Tail"

    # List cats
    r2 = client.get("/cats")
    assert r2.status_code == 200
    cats = r2.json()
    assert len(cats) == 1
    assert cats[0]["name"] == "Orange Tail"


def test_create_entry_with_photo_and_assign_to_cat(client: TestClient):
    # Create cat
    cat = client.post("/cats", json={"name": "Park Kitty"}).json()
    cat_id = cat["id"]

    # Create sighting with photo_url
    entry_payload = {
        "text": "Orange cat, shy, sits near the benches.",
        "nickname": "Orange Tail",
        "location": "Central Park north entrance",
        "photo_url": "https://example.com/cat1.jpg",
    }
    r = client.post("/entries", json=entry_payload)
    assert r.status_code == 200
    entry = r.json()
    assert entry["photo_url"] == "https://example.com/cat1.jpg"
    assert entry["cat_id"] is None  # not assigned yet

    # Assign entry to cat
    entry_id = entry["id"]
    r2 = client.post(f"/entries/{entry_id}/assign/{cat_id}")
    assert r2.status_code == 200
    updated = r2.json()
    assert updated["cat_id"] == cat_id


def test_cat_profile_requires_assigned_sightings(client: TestClient):
    # Create cat
    cat = client.post("/cats", json={"name": "Shadow"}).json()
    cat_id = cat["id"]

    # Profile with no sightings should be a friendly message
    r = client.get(f"/cats/{cat_id}/profile")
    assert r.status_code == 200
    profile = r.json()
    assert profile["sightings_count"] == 0
    assert "No sightings assigned yet" in profile["profile_text"]


def test_cat_profile_with_assigned_sightings(client: TestClient):
    # Create cat
    cat = client.post("/cats", json={"name": "Orange Tail"}).json()
    cat_id = cat["id"]

    # Create two sightings
    e1 = client.post("/entries", json={
        "text": "Orange cat with a torn ear. Very shy.",
        "location": "5th Ave & Pine"
    }).json()

    e2 = client.post("/entries", json={
        "text": "Orange kitty hides under car, cautious but calm.",
        "location": "5th Ave & Pine"
    }).json()

    # Assign them
    client.post(f"/entries/{e1['id']}/assign/{cat_id}")
    client.post(f"/entries/{e2['id']}/assign/{cat_id}")

    # Get profile
    r = client.get(f"/cats/{cat_id}/profile")
    assert r.status_code == 200
    profile = r.json()

    assert profile["sightings_count"] == 2
    assert len(profile["top_tags"]) > 0
    assert "Orange Tail" in profile["profile_text"]


# =============================================================================
# Phase 1: Location Normalization Tests
# =============================================================================

def test_normalize_location_no_location(client: TestClient):
    """Test normalizing an entry that has no location."""
    # Create entry without location
    entry = client.post("/entries", json={
        "text": "Cat spotted somewhere",
    }).json()

    # Try to normalize
    r = client.post(f"/entries/{entry['id']}/normalize-location")
    assert r.status_code == 200
    result = r.json()
    assert result["status"] == "no_location"
    assert result["entry_id"] == entry["id"]


def test_normalize_location_entry_not_found(client: TestClient):
    """Test normalizing a non-existent entry."""
    r = client.post("/entries/99999/normalize-location")
    assert r.status_code == 404


def test_geocoding_health_endpoint(client: TestClient):
    """Test the geocoding health check endpoint."""
    r = client.get("/health/geocoding")
    assert r.status_code == 200
    health = r.json()
    assert health["service"] == "nominatim"
    assert health["circuit_state"] in ["closed", "open", "half_open"]
    assert "failure_count" in health
    assert health["status"] in ["healthy", "degraded", "unavailable"]


def test_entry_has_location_fields(client: TestClient):
    """Test that entries include location normalization fields."""
    entry = client.post("/entries", json={
        "text": "Test cat",
        "location": "Test location"
    }).json()

    # Check that location fields are present (even if null)
    assert "location_normalized" in entry
    assert "location_lat" in entry
    assert "location_lon" in entry
    assert "location_osm_id" in entry


# =============================================================================
# Phase 2: Enhanced Location Matching Tests
# =============================================================================

def test_find_matches_entry_not_found(client: TestClient):
    """Test finding matches for non-existent entry."""
    r = client.get("/entries/99999/matches")
    assert r.status_code == 404


def test_find_matches_returns_candidates(client: TestClient):
    """Test that find matches returns similar entries."""
    # Create entries with similar text
    e1 = client.post("/entries", json={
        "text": "Orange tabby cat with torn ear near the park",
        "location": "Central Park"
    }).json()

    e2 = client.post("/entries", json={
        "text": "Orange tabby cat hiding under bench in park",
        "location": "Central Park"
    }).json()

    e3 = client.post("/entries", json={
        "text": "Black cat on the roof",
        "location": "Downtown"
    }).json()

    # Find matches for e1
    r = client.get(f"/entries/{e1['id']}/matches")
    assert r.status_code == 200
    matches = r.json()

    # Should return candidates (e2 should be more similar than e3)
    assert isinstance(matches, list)
    if len(matches) > 0:
        # Verify structure
        assert "candidate_id" in matches[0]
        assert "score" in matches[0]
        assert "reasons" in matches[0]


def test_nearby_sightings_no_coordinates(client: TestClient):
    """Test nearby endpoint when entry has no coordinates."""
    entry = client.post("/entries", json={
        "text": "Cat without coordinates",
        "location": "Unknown"
    }).json()

    r = client.get(f"/entries/{entry['id']}/nearby")
    assert r.status_code == 400
    assert "no coordinates" in r.json()["detail"].lower()


def test_nearby_sightings_entry_not_found(client: TestClient):
    """Test nearby endpoint for non-existent entry."""
    r = client.get("/entries/99999/nearby")
    assert r.status_code == 404


# =============================================================================
# Phase 3: Validation Workflow Tests
# =============================================================================

def test_bulk_link_sightings_to_cat(client: TestClient):
    """Test bulk linking multiple sightings to a cat."""
    # Create a cat
    cat = client.post("/cats", json={"name": "Bulk Test Cat"}).json()
    cat_id = cat["id"]

    # Create multiple entries
    e1 = client.post("/entries", json={"text": "Sighting 1"}).json()
    e2 = client.post("/entries", json={"text": "Sighting 2"}).json()
    e3 = client.post("/entries", json={"text": "Sighting 3"}).json()

    # Bulk link
    r = client.post(f"/cats/{cat_id}/link-sightings", json={
        "entry_ids": [e1["id"], e2["id"], e3["id"]]
    })
    assert r.status_code == 200
    result = r.json()

    assert result["cat_id"] == cat_id
    assert result["linked_count"] == 3
    assert len(result["newly_linked"]) == 3
    assert len(result["already_linked"]) == 0
    assert len(result["failed"]) == 0

    # Verify entries are actually linked
    entries = client.get("/entries").json()
    for entry in entries:
        if entry["id"] in [e1["id"], e2["id"], e3["id"]]:
            assert entry["cat_id"] == cat_id


def test_bulk_link_already_linked_entries(client: TestClient):
    """Test bulk linking entries that are already linked."""
    # Create a cat
    cat = client.post("/cats", json={"name": "Already Linked Cat"}).json()
    cat_id = cat["id"]

    # Create and assign entry
    entry = client.post("/entries", json={"text": "Already assigned"}).json()
    client.post(f"/entries/{entry['id']}/assign/{cat_id}")

    # Try to bulk link again
    r = client.post(f"/cats/{cat_id}/link-sightings", json={
        "entry_ids": [entry["id"]]
    })
    assert r.status_code == 200
    result = r.json()

    assert len(result["already_linked"]) == 1
    assert len(result["newly_linked"]) == 0


def test_bulk_link_with_nonexistent_entries(client: TestClient):
    """Test bulk linking with some non-existent entries."""
    cat = client.post("/cats", json={"name": "Test Cat"}).json()
    entry = client.post("/entries", json={"text": "Real entry"}).json()

    r = client.post(f"/cats/{cat['id']}/link-sightings", json={
        "entry_ids": [entry["id"], 99999, 99998]
    })
    assert r.status_code == 200
    result = r.json()

    assert len(result["newly_linked"]) == 1
    assert len(result["failed"]) == 2
    assert 99999 in result["failed"]
    assert 99998 in result["failed"]


def test_bulk_link_cat_not_found(client: TestClient):
    """Test bulk linking to non-existent cat."""
    r = client.post("/cats/99999/link-sightings", json={
        "entry_ids": [1, 2, 3]
    })
    assert r.status_code == 404


def test_create_cat_from_sightings(client: TestClient):
    """Test creating a new cat from sightings."""
    # Create entries
    e1 = client.post("/entries", json={"text": "Orange cat sighting 1"}).json()
    e2 = client.post("/entries", json={"text": "Orange cat sighting 2"}).json()

    # Create cat from sightings
    r = client.post("/cats/from-sightings", json={
        "entry_ids": [e1["id"], e2["id"]],
        "name": "New Orange Cat"
    })
    assert r.status_code == 200
    cat = r.json()

    assert cat["name"] == "New Orange Cat"
    assert cat["id"] > 0

    # Verify entries are linked
    entries = client.get("/entries").json()
    for entry in entries:
        if entry["id"] in [e1["id"], e2["id"]]:
            assert entry["cat_id"] == cat["id"]


def test_create_cat_from_sightings_without_name(client: TestClient):
    """Test creating a cat from sightings without providing a name."""
    entry = client.post("/entries", json={"text": "Unnamed cat"}).json()

    r = client.post("/cats/from-sightings", json={
        "entry_ids": [entry["id"]]
    })
    assert r.status_code == 200
    cat = r.json()

    assert cat["name"] is None
    assert cat["id"] > 0


def test_create_cat_from_sightings_skips_nonexistent(client: TestClient):
    """Test that non-existent entries are silently skipped."""
    entry = client.post("/entries", json={"text": "Real sighting"}).json()

    r = client.post("/cats/from-sightings", json={
        "entry_ids": [entry["id"], 99999],
        "name": "Mixed Cat"
    })
    assert r.status_code == 200
    cat = r.json()

    # Cat should be created
    assert cat["id"] > 0

    # Real entry should be linked
    updated_entry = None
    for e in client.get("/entries").json():
        if e["id"] == entry["id"]:
            updated_entry = e
            break
    assert updated_entry["cat_id"] == cat["id"]


# =============================================================================
# Phase 4: Area-Based Clustering Tests
# =============================================================================

def test_get_entries_by_area_no_entries(client: TestClient):
    """Test area query with no entries in database."""
    r = client.get("/entries/by-area", params={
        "lat": 40.7128,
        "lon": -74.0060,
        "radius": 1000
    })
    assert r.status_code == 200
    result = r.json()

    assert result["center_lat"] == 40.7128
    assert result["center_lon"] == -74.0060
    assert result["radius_meters"] == 1000
    assert result["total_count"] == 0
    assert result["sightings"] == []


def test_get_entries_by_area_validates_coordinates(client: TestClient):
    """Test that area query validates coordinate ranges."""
    # Invalid latitude
    r = client.get("/entries/by-area", params={
        "lat": 100,  # Invalid: > 90
        "lon": -74.0060,
        "radius": 1000
    })
    assert r.status_code == 422  # Validation error

    # Invalid longitude
    r = client.get("/entries/by-area", params={
        "lat": 40.7128,
        "lon": -200,  # Invalid: < -180
        "radius": 1000
    })
    assert r.status_code == 422


def test_get_entries_by_area_validates_radius(client: TestClient):
    """Test that area query validates radius range."""
    # Radius too small
    r = client.get("/entries/by-area", params={
        "lat": 40.7128,
        "lon": -74.0060,
        "radius": 0
    })
    assert r.status_code == 422

    # Radius too large
    r = client.get("/entries/by-area", params={
        "lat": 40.7128,
        "lon": -74.0060,
        "radius": 20000
    })
    assert r.status_code == 422


def test_suggested_groupings_no_unassigned(client: TestClient):
    """Test suggested groupings with no unassigned entries."""
    r = client.get("/entries/by-area/suggested-groups", params={
        "lat": 40.7128,
        "lon": -74.0060,
        "radius": 1000
    })
    assert r.status_code == 200
    result = r.json()

    assert result["total_unassigned"] == 0
    assert result["groups"] == []


def test_suggested_groupings_validates_parameters(client: TestClient):
    """Test that suggested groupings validates parameters."""
    # cluster_radius too small
    r = client.get("/entries/by-area/suggested-groups", params={
        "lat": 40.7128,
        "lon": -74.0060,
        "radius": 1000,
        "cluster_radius": 5  # Min is 10
    })
    assert r.status_code == 422

    # min_sightings too small
    r = client.get("/entries/by-area/suggested-groups", params={
        "lat": 40.7128,
        "lon": -74.0060,
        "radius": 1000,
        "min_sightings": 1  # Min is 2
    })
    assert r.status_code == 422


def test_area_query_response_structure(client: TestClient):
    """Test that area query response has correct structure."""
    r = client.get("/entries/by-area", params={
        "lat": 40.7128,
        "lon": -74.0060,
        "radius": 500
    })
    assert r.status_code == 200
    result = r.json()

    # Check all required fields
    assert "center_lat" in result
    assert "center_lon" in result
    assert "radius_meters" in result
    assert "total_count" in result
    assert "unassigned_count" in result
    assert "sightings" in result


def test_suggested_groupings_response_structure(client: TestClient):
    """Test that suggested groupings response has correct structure."""
    r = client.get("/entries/by-area/suggested-groups", params={
        "lat": 40.7128,
        "lon": -74.0060,
        "radius": 500
    })
    assert r.status_code == 200
    result = r.json()

    # Check all required fields
    assert "area_center_lat" in result
    assert "area_center_lon" in result
    assert "area_radius_meters" in result
    assert "total_unassigned" in result
    assert "groups" in result


# =============================================================================
# Integration Tests: Full Workflow
# =============================================================================

def test_full_deduplication_workflow(client: TestClient):
    """
    Integration test: Full deduplication workflow from entry creation
    to cat grouping.
    """
    # Step 1: Create multiple entries that look like they could be the same cat
    entries = []
    for i in range(3):
        e = client.post("/entries", json={
            "text": f"Orange tabby cat with white paws, sighting {i+1}",
            "location": "Main Street Park"
        }).json()
        entries.append(e)

    # Step 2: Try to find matches for the first entry
    matches_r = client.get(f"/entries/{entries[0]['id']}/matches")
    assert matches_r.status_code == 200
    matches = matches_r.json()

    # Step 3: Create a new cat from these sightings
    entry_ids = [e["id"] for e in entries]
    cat_r = client.post("/cats/from-sightings", json={
        "entry_ids": entry_ids,
        "name": "Main Street Tabby"
    })
    assert cat_r.status_code == 200
    cat = cat_r.json()

    # Step 4: Verify all entries are now linked
    all_entries = client.get("/entries").json()
    for entry in all_entries:
        if entry["id"] in entry_ids:
            assert entry["cat_id"] == cat["id"], f"Entry {entry['id']} not linked"

    # Step 5: Check cat profile
    profile_r = client.get(f"/cats/{cat['id']}/profile")
    assert profile_r.status_code == 200
    profile = profile_r.json()
    assert profile["sightings_count"] == 3


def test_reassign_entries_between_cats(client: TestClient):
    """Test that entries can be reassigned from one cat to another."""
    # Create two cats
    cat1 = client.post("/cats", json={"name": "Cat 1"}).json()
    cat2 = client.post("/cats", json={"name": "Cat 2"}).json()

    # Create entry and assign to cat1
    entry = client.post("/entries", json={"text": "Test entry"}).json()
    client.post(f"/entries/{entry['id']}/assign/{cat1['id']}")

    # Bulk link to cat2 (should reassign)
    r = client.post(f"/cats/{cat2['id']}/link-sightings", json={
        "entry_ids": [entry["id"]]
    })
    assert r.status_code == 200
    result = r.json()

    # Should be in newly_linked, not already_linked
    assert entry["id"] in result["newly_linked"]

    # Verify entry is now linked to cat2
    updated = None
    for e in client.get("/entries").json():
        if e["id"] == entry["id"]:
            updated = e
            break
    assert updated["cat_id"] == cat2["id"]


# =============================================================================
# Cat Profile Page Tests: Paginated Sightings
# =============================================================================

def test_get_cat_sightings_empty(client: TestClient):
    """Test getting sightings for a cat with no sightings."""
    cat = client.post("/cats", json={"name": "Empty Cat"}).json()

    r = client.get(f"/cats/{cat['id']}/sightings")
    assert r.status_code == 200
    result = r.json()

    assert result["sightings"] == []
    assert result["total"] == 0
    assert result["page"] == 1
    assert result["totalPages"] == 1
    assert result["hasMore"] is False


def test_get_cat_sightings_with_data(client: TestClient):
    """Test getting sightings for a cat with assigned sightings."""
    cat = client.post("/cats", json={"name": "Test Cat"}).json()

    # Create and assign sightings
    for i in range(5):
        entry = client.post("/entries", json={
            "text": f"Sighting number {i+1}",
            "location": f"Location {i+1}"
        }).json()
        client.post(f"/entries/{entry['id']}/assign/{cat['id']}")

    r = client.get(f"/cats/{cat['id']}/sightings")
    assert r.status_code == 200
    result = r.json()

    assert len(result["sightings"]) == 5
    assert result["total"] == 5
    assert result["page"] == 1


def test_get_cat_sightings_pagination(client: TestClient):
    """Test pagination of cat sightings."""
    cat = client.post("/cats", json={"name": "Many Sightings Cat"}).json()

    # Create 15 sightings
    for i in range(15):
        entry = client.post("/entries", json={"text": f"Sighting {i+1}"}).json()
        client.post(f"/entries/{entry['id']}/assign/{cat['id']}")

    # Get first page with limit 5
    r = client.get(f"/cats/{cat['id']}/sightings", params={"page": 1, "limit": 5})
    assert r.status_code == 200
    result = r.json()

    assert len(result["sightings"]) == 5
    assert result["total"] == 15
    assert result["page"] == 1
    assert result["totalPages"] == 3
    assert result["hasMore"] is True

    # Get second page
    r2 = client.get(f"/cats/{cat['id']}/sightings", params={"page": 2, "limit": 5})
    result2 = r2.json()
    assert len(result2["sightings"]) == 5
    assert result2["page"] == 2
    assert result2["hasMore"] is True

    # Get third page
    r3 = client.get(f"/cats/{cat['id']}/sightings", params={"page": 3, "limit": 5})
    result3 = r3.json()
    assert len(result3["sightings"]) == 5
    assert result3["page"] == 3
    assert result3["hasMore"] is False


def test_get_cat_sightings_not_found(client: TestClient):
    """Test getting sightings for non-existent cat."""
    r = client.get("/cats/99999/sightings")
    assert r.status_code == 404


# =============================================================================
# Cat Profile Page Tests: Cat Update
# =============================================================================

def test_update_cat_name(client: TestClient):
    """Test updating a cat's name."""
    cat = client.post("/cats", json={"name": "Old Name"}).json()

    r = client.patch(f"/cats/{cat['id']}", json={"name": "New Name"})
    assert r.status_code == 200
    result = r.json()

    assert result["id"] == cat["id"]
    assert result["name"] == "New Name"
    assert "updatedAt" in result


def test_update_cat_name_to_null(client: TestClient):
    """Test removing a cat's name."""
    cat = client.post("/cats", json={"name": "Named Cat"}).json()

    r = client.patch(f"/cats/{cat['id']}", json={"name": None})
    assert r.status_code == 200
    result = r.json()

    assert result["name"] is None


def test_update_cat_empty_string_becomes_null(client: TestClient):
    """Test that empty string name becomes null."""
    cat = client.post("/cats", json={"name": "Test"}).json()

    r = client.patch(f"/cats/{cat['id']}", json={"name": "   "})
    assert r.status_code == 200
    result = r.json()

    assert result["name"] is None


def test_update_cat_not_found(client: TestClient):
    """Test updating non-existent cat."""
    r = client.patch("/cats/99999", json={"name": "New Name"})
    assert r.status_code == 404


# =============================================================================
# Cat Profile Page Tests: Comments CRUD
# =============================================================================

def test_create_comment(client: TestClient):
    """Test creating a comment on a cat profile."""
    cat = client.post("/cats", json={"name": "Commented Cat"}).json()

    r = client.post(f"/cats/{cat['id']}/comments", json={
        "author_name": "John Doe",
        "content": "This is a great cat!"
    })
    assert r.status_code == 201
    comment = r.json()

    assert comment["id"] > 0
    assert comment["cat_id"] == cat["id"]
    assert comment["author_name"] == "John Doe"
    assert comment["content"] == "This is a great cat!"
    assert "createdAt" in comment


def test_create_comment_cat_not_found(client: TestClient):
    """Test creating comment on non-existent cat."""
    r = client.post("/cats/99999/comments", json={
        "author_name": "Test",
        "content": "Test comment"
    })
    assert r.status_code == 404


def test_create_comment_validation(client: TestClient):
    """Test comment validation."""
    cat = client.post("/cats", json={"name": "Test"}).json()

    # Missing author_name
    r = client.post(f"/cats/{cat['id']}/comments", json={
        "content": "Test"
    })
    assert r.status_code == 422

    # Missing content
    r = client.post(f"/cats/{cat['id']}/comments", json={
        "author_name": "Test"
    })
    assert r.status_code == 422

    # Empty author_name
    r = client.post(f"/cats/{cat['id']}/comments", json={
        "author_name": "",
        "content": "Test"
    })
    assert r.status_code == 422


def test_get_cat_comments(client: TestClient):
    """Test getting comments for a cat."""
    cat = client.post("/cats", json={"name": "Test"}).json()

    # Create comments
    for i in range(3):
        client.post(f"/cats/{cat['id']}/comments", json={
            "author_name": f"Author {i+1}",
            "content": f"Comment {i+1}"
        })

    r = client.get(f"/cats/{cat['id']}/comments")
    assert r.status_code == 200
    result = r.json()

    assert len(result["comments"]) == 3
    assert result["total"] == 3
    assert result["page"] == 1


def test_get_cat_comments_pagination(client: TestClient):
    """Test pagination of cat comments."""
    cat = client.post("/cats", json={"name": "Test"}).json()

    # Create 10 comments
    for i in range(10):
        client.post(f"/cats/{cat['id']}/comments", json={
            "author_name": f"Author {i+1}",
            "content": f"Comment {i+1}"
        })

    # Get first page with limit 3
    r = client.get(f"/cats/{cat['id']}/comments", params={"page": 1, "limit": 3})
    assert r.status_code == 200
    result = r.json()

    assert len(result["comments"]) == 3
    assert result["total"] == 10
    assert result["totalPages"] == 4
    assert result["hasMore"] is True


def test_get_cat_comments_empty(client: TestClient):
    """Test getting comments for cat with no comments."""
    cat = client.post("/cats", json={"name": "Quiet Cat"}).json()

    r = client.get(f"/cats/{cat['id']}/comments")
    assert r.status_code == 200
    result = r.json()

    assert result["comments"] == []
    assert result["total"] == 0


def test_get_cat_comments_not_found(client: TestClient):
    """Test getting comments for non-existent cat."""
    r = client.get("/cats/99999/comments")
    assert r.status_code == 404


def test_delete_comment(client: TestClient):
    """Test deleting a comment."""
    cat = client.post("/cats", json={"name": "Test"}).json()

    # Create comment
    comment = client.post(f"/cats/{cat['id']}/comments", json={
        "author_name": "Test",
        "content": "To be deleted"
    }).json()

    # Delete it
    r = client.delete(f"/cats/{cat['id']}/comments/{comment['id']}")
    assert r.status_code == 204

    # Verify it's gone
    comments = client.get(f"/cats/{cat['id']}/comments").json()
    assert comments["total"] == 0


def test_delete_comment_not_found(client: TestClient):
    """Test deleting non-existent comment."""
    cat = client.post("/cats", json={"name": "Test"}).json()

    r = client.delete(f"/cats/{cat['id']}/comments/99999")
    assert r.status_code == 404


def test_delete_comment_wrong_cat(client: TestClient):
    """Test deleting comment with wrong cat ID."""
    cat1 = client.post("/cats", json={"name": "Cat 1"}).json()
    cat2 = client.post("/cats", json={"name": "Cat 2"}).json()

    # Create comment on cat1
    comment = client.post(f"/cats/{cat1['id']}/comments", json={
        "author_name": "Test",
        "content": "Test"
    }).json()

    # Try to delete with cat2 ID
    r = client.delete(f"/cats/{cat2['id']}/comments/{comment['id']}")
    assert r.status_code == 404


# =============================================================================
# Cat Profile Page Tests: Enhanced Profile Endpoint
# =============================================================================

def test_enhanced_cat_profile(client: TestClient):
    """Test the enhanced cat profile endpoint."""
    cat = client.post("/cats", json={"name": "Profile Cat"}).json()

    # Add sightings
    for i in range(3):
        entry = client.post("/entries", json={
            "text": f"Cat sighting {i+1} - orange tabby",
            "location": "Central Park",
            "photo_url": f"https://example.com/cat{i+1}.jpg" if i == 0 else None
        }).json()
        client.post(f"/entries/{entry['id']}/assign/{cat['id']}")

    r = client.get(f"/cats/{cat['id']}/profile/enhanced")
    assert r.status_code == 200
    profile = r.json()

    # Check structure
    assert "cat" in profile
    assert "stats" in profile
    assert "recentSightings" in profile
    assert "locationSummary" in profile
    assert "insightStatus" in profile

    # Check cat info
    assert profile["cat"]["id"] == cat["id"]
    assert profile["cat"]["name"] == "Profile Cat"
    assert profile["cat"]["primaryPhoto"] == "https://example.com/cat1.jpg"

    # Check stats
    assert profile["stats"]["totalSightings"] == 3
    assert profile["stats"]["photoCount"] == 1


def test_enhanced_cat_profile_not_found(client: TestClient):
    """Test enhanced profile for non-existent cat."""
    r = client.get("/cats/99999/profile/enhanced")
    assert r.status_code == 404
