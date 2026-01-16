# Claude Code Configuration

## Project Context
**CatAtlas** is a full-stack web application for tracking and managing feral/stray cat sightings. It features AI-powered insights, duplicate detection, and community-driven cat profiles. Built as a learning project demonstrating RESTful API design, modern React development, and CI/CD practices.

**Tech Stack:**
- Backend: FastAPI (Python 3.11+), SQLite, Uvicorn
- Frontend: React 19, TypeScript, Vite
- Testing: pytest, FastAPI TestClient
- CI/CD: GitHub Actions, Docker

## Key Files
### Backend
- `backend/main.py` - FastAPI application entry point
- `backend/requirements.txt` - Python dependencies
- `backend/Dockerfile` - Docker container configuration
- `backend/tests/` - Test suite (pytest)
  - `test_health.py` - Health check tests
  - `test_api.py` - API integration tests
  - `test_insights.py` - AI insights tests

### Frontend
- `frontend/src/App.tsx` - Main React component
- `frontend/src/main.tsx` - React entry point
- `frontend/package.json` - Node dependencies & scripts
- `frontend/vite.config.ts` - Vite configuration
- `frontend/tsconfig.json` - TypeScript configuration

### CI/CD
- `.github/workflows/python-ci.yml` - Backend testing & linting
- `.github/workflows/docker-backend.yml` - Container builds
- `.github/workflows/pages.yml` - Frontend deployment

## Development Guidelines
- Use Python 3.11+ for backend development
- Follow PEP 8 style guidelines (enforced by flake8)
- Write tests for new features using pytest
- Use TypeScript for all frontend code
- Follow React best practices (hooks, component composition)
- Run linters before committing (flake8, ESLint)
- Keep tests isolated with fixture-based temporary databases

## Common Tasks
### Backend
```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000  # Start dev server
pytest -v                                              # Run all tests
flake8 .                                              # Lint Python code
```

### Frontend
```bash
cd frontend
npm install          # Install dependencies
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # Production build
npm run lint         # ESLint check
```

### Docker
```bash
cd backend
docker build -t catatlas-backend .
docker run -p 8000:8000 catatlas-backend
```

## API Reference
- Docs: `http://localhost:8000/docs` (Swagger UI)
- Health check: `GET /health`
- Sightings: `GET/POST /entries`
- AI analysis: `POST /entries/{id}/analyze`
- Cat profiles: `GET/POST /cats`

## Important Notes
- SQLite database stored at `backend/catatlas.db` (gitignored)
- Tests use temporary databases via `CATATLAS_DB_PATH` environment variable
- Always update tests when changing core logic
- API responses are cached in database for performance
- Frontend proxies API requests to `http://localhost:8000`
- CI runs tests on Python 3.8, 3.9, 3.10 for compatibility
