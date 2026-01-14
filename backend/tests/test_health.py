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
    """
    Create a TestClient with an isolated SQLite DB per test run.
    """
    db_path = tmp_path / "test.db"
    os.environ["CATATLAS_DB_PATH"] = str(db_path)

    from main import app, init_db
    init_db()
    return TestClient(app)


def test_health(client: TestClient):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
