# w40-week04-learninglog-api

> Next week, we’ll make the backend URL stable via actual hosting and pipeline-driven deployment.

---

## Step 8 — Verify the full pipeline (your launch runbook)

### 8.1 Local verification (before pushing)
Backend:
```bash
cd backend
source .venv/bin/activate
pytest -q
