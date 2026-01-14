import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Ensure backend/ is importable
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture()
def client(tmp_path: Path):
    db_path = tmp_path / "test.db"
    os.environ["CATATLAS_DB_PATH"] = str(db_path)

    from main import app, init_db
    init_db()
    return TestClient(app)


def test_insights_requires_sightings(client: TestClient):
    cat = client.post("/cats", json={"name": "TestCat"}).json()
    r = client.post(f"/cats/{cat['id']}/insights", json={"mode": "profile"})
    assert r.status_code == 400
    assert "No sightings assigned" in r.json()["detail"]


def test_insights_generates_and_caches(client: TestClient):
    # Create cat
    cat = client.post("/cats", json={"name": "Orange Tail"}).json()
    cat_id = cat["id"]

    # Create entry
    e = client.post("/entries", json={
        "text": "Orange cat, shy, torn ear. Seen near benches.",
        "location": "Central Park north entrance"
    }).json()

    # Assign entry to cat
    client.post(f"/entries/{e['id']}/assign/{cat_id}")

    # First call => generates
    r1 = client.post(f"/cats/{cat_id}/insights", json={"mode": "profile"})
    assert r1.status_code == 200
    out1 = r1.json()
    assert out1["cat_id"] == cat_id
    assert out1["mode"] == "profile"
    assert "summary" in out1
    assert len(out1["citations"]) >= 1

    # Second call => should hit cache (same output shape; may be identical)
    r2 = client.post(f"/cats/{cat_id}/insights", json={"mode": "profile"})
    assert r2.status_code == 200
    out2 = r2.json()

    # Contract remains stable
    assert out2["prompt_version"] == out1["prompt_version"]
    assert out2["headline"] == out1["headline"]
    assert out2["mode"] == out1["mode"]
