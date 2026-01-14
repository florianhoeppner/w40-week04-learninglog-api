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
