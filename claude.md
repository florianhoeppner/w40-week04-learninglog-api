# Claude Code Configuration

## Project Context
**CatAtlas** is a full-stack web application for tracking and managing feral/stray cat sightings. It features AI-powered insights, duplicate detection, and community-driven cat profiles. Built as a learning project demonstrating RESTful API design, modern React development, and CI/CD practices.

**Tech Stack:**
- Backend: FastAPI (Python 3.11+), PostgreSQL (production) / SQLite (local dev), Uvicorn
- Frontend: React 19, TypeScript, Vite
- Testing: pytest, FastAPI TestClient
- Deployment: Railway.app (Docker-based)
- CI/CD: GitHub Actions, Docker
- Configuration: Pydantic Settings v2, python-dotenv

## Key Files
### Backend
- `backend/main.py` - FastAPI application entry point with database abstraction layer
- `backend/config.py` - Environment-based configuration using Pydantic Settings v2
- `backend/requirements.txt` - Python dependencies (includes psycopg2-binary for PostgreSQL)
- `backend/Dockerfile` - Docker container configuration
- `backend/tests/` - Test suite (pytest)
  - `test_health.py` - Health check tests
  - `test_api.py` - API integration tests
  - `test_insights.py` - AI insights tests
  - `test_config.py` - Configuration validation tests
  - `test_security.py` - Security & CORS tests
  - `test_validation.py` - Input validation tests
  - `test_integration.py` - End-to-end workflow tests
  - `conftest.py` - Test fixtures with environment isolation

### Frontend
- `frontend/src/App.tsx` - Main React component
- `frontend/src/main.tsx` - React entry point
- `frontend/package.json` - Node dependencies & scripts
- `frontend/vite.config.ts` - Vite configuration
- `frontend/tsconfig.json` - TypeScript configuration

### Deployment
- `railway.json` - Railway deployment configuration
- `.env.example` - Environment variables template

### CI/CD
- `.github/workflows/python-ci.yml` - Backend testing & linting
- `.github/workflows/docker-backend.yml` - Container builds
- `.github/workflows/pages.yml` - Frontend deployment

## Configuration & Environment Variables

The application uses Pydantic Settings v2 for environment-based configuration (`backend/config.py`).

### Environment Variables
- **`DEBUG`** (bool, default: `False`) - Enable debug mode, relaxes production validation
- **`JWT_SECRET`** (str, required in production) - Secret key for JWT token generation
- **`ALLOWED_ORIGINS`** (str, default: `"*"`) - Comma-separated CORS allowed origins
- **`DATABASE_URL`** (str, optional) - PostgreSQL connection string (e.g., `postgresql://user:pass@host:5432/db`)
- **`CATATLAS_DB_PATH`** (str, default: `"learninglog.db"`) - SQLite database path for local development
- **`SENTRY_DSN`** (str, optional) - Sentry DSN for error tracking

### Configuration Modes
- **Development**: Uses SQLite (`learninglog.db`), `DEBUG=True`, relaxed validation
- **Production**: Uses PostgreSQL (via `DATABASE_URL`), requires `JWT_SECRET`, strict validation
- **Testing**: Isolated temporary databases, `DEBUG=True` set automatically in `conftest.py`

### Database Abstraction Layer
The application supports **both SQLite and PostgreSQL** through an abstraction layer in `main.py`:
- `get_conn()` - Returns appropriate database connection based on `DATABASE_URL`
- `execute_query(cur, sql, params)` - Automatically converts SQLite placeholders (`?`) to PostgreSQL (`%s`)
- SQL compatibility handled at query execution time, not at query definition

## Production Deployment (Railway.app)

**Live API**: https://w40-week04-learninglog-api-production.up.railway.app

### Railway Setup
1. **Database**: PostgreSQL plugin added via Railway dashboard
2. **Environment Variables**: Set in Railway project settings
   - `DATABASE_URL` - Automatically provided by PostgreSQL plugin
   - `JWT_SECRET` - Set to secure random string (32+ characters)
   - `DEBUG` - Set to `False`
   - `ALLOWED_ORIGINS` - Set to frontend URL
3. **Deployment**: Automatic deploys from `main` branch via `railway.json`
4. **Health Check**: `/health` endpoint configured for Railway monitoring

### Key Railway Configuration (`railway.json`)
```json
{
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "backend/Dockerfile",
    "dockerContext": "backend"
  },
  "deploy": {
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

## Development Guidelines
- Use Python 3.11+ for backend development
- Follow PEP 8 style guidelines (enforced by flake8)
- Write tests for new features using pytest
- Use TypeScript for all frontend code
- Follow React best practices (hooks, component composition)
- Run linters before committing (flake8, ESLint)
- Keep tests isolated with fixture-based temporary databases
- **ALWAYS set `DEBUG=True` in test environment** (handled automatically in `conftest.py`)
- **Reload config module** before main in test fixtures to pick up environment changes

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

### Database
- **Local development**: SQLite database stored at `backend/learninglog.db` (gitignored)
- **Production**: PostgreSQL database hosted on Railway
- **Tests**: Use temporary databases via `CATATLAS_DB_PATH` environment variable
- **Table creation order matters**: Tables must be created in dependency order to respect foreign key constraints
  - Order: `cats` → `entries` → `analyses` → `cat_insights`
- API responses are cached in database for performance

### SQL Compatibility
- Use `execute_query()` helper for all database queries (automatically handles `?` → `%s` conversion)
- **SQLite**: `INTEGER PRIMARY KEY AUTOINCREMENT`, `?` placeholders, `lastrowid` for inserts
- **PostgreSQL**: `SERIAL PRIMARY KEY`, `%s` placeholders, `RETURNING id` for inserts
- **Foreign keys**: Use `INT` type in PostgreSQL, `INTEGER` in SQLite

### Testing Best Practices
- Always update tests when changing core logic
- Tests automatically run with `DEBUG=True` (set in `conftest.py`)
- Client fixtures reload config module before main to pick up environment changes
- All 60 tests must pass with >60% coverage before merging
- CI runs tests on Python 3.8, 3.9, 3.10 for compatibility

### Frontend Integration
- Frontend proxies API requests to `http://localhost:8000` in development
- Production frontend should use `https://w40-week04-learninglog-api-production.up.railway.app`

## Lessons Learned (PostgreSQL Migration)

### 1. Docker Layer Caching Issues
**Problem**: Railway was using cached Docker layers, so adding `psycopg2-binary` to `requirements.txt` didn't trigger rebuild.

**Solution**: Modified `requirements.txt` content (added comment) to change file checksum and invalidate cache.

**Takeaway**: When dependencies aren't installing in Docker, check for layer caching. Force cache bust by modifying the file.

### 2. Table Creation Order with Foreign Keys
**Problem**: Creating `cat_insights` table (with foreign key to `cats`) before `cats` table caused PostgreSQL error.

**Root Cause**: PostgreSQL strictly enforces foreign key constraints at table creation time.

**Solution**: Reorder table creation to respect dependencies:
```python
# Correct order:
1. cats (no dependencies)
2. entries (references cats)
3. analyses (references entries)
4. cat_insights (references cats)
```

**Takeaway**: Always create referenced tables before tables with foreign keys. SQLite is more lenient, but PostgreSQL requires strict ordering.

### 3. Environment Variable Propagation in Tests
**Problem**: Tests were failing with production validation errors (`JWT_SECRET must be changed in production!`).

**Root Cause**: Tests were running with `DEBUG=False` by default, triggering production mode.

**Solution**:
- Set `DEBUG=True` in `conftest.py` using `monkeypatch.setenv()`
- Reload config module before main in test fixtures

**Takeaway**: Always isolate test environment and explicitly set debug mode to avoid production validation in tests.

### 4. Module Reload for Configuration Changes
**Problem**: CORS tests were failing because config changes weren't being picked up.

**Root Cause**: FastAPI app was initialized with old config before environment variables were set.

**Solution**:
```python
import config
import main
importlib.reload(config)  # Reload config first
importlib.reload(main)    # Then reload main
```

**Takeaway**: When modifying environment variables in tests, reload the config module before reloading the main application module.

### 5. Database Abstraction Strategy
**Approach Taken**: Create abstraction layer instead of rewriting all queries.

**Benefits**:
- Minimal code changes (30+ queries updated easily)
- Automatic placeholder conversion (`?` → `%s`)
- Single codebase supports both SQLite and PostgreSQL
- Easy to test locally with SQLite, deploy with PostgreSQL

**Implementation**:
```python
def execute_query(cur, sql: str, params: tuple = ()):
    """Auto-convert ? to %s for PostgreSQL."""
    if settings.is_postgres and '?' in sql:
        sql = sql.replace('?', '%s')
    cur.execute(sql, params)
    return cur
```

**Takeaway**: Database abstraction layers enable supporting multiple databases without significant code duplication.

### 6. Production Environment Validation
**Strategy**: Use Pydantic Settings v2 with custom validators.

**Benefits**:
- Catch configuration errors at startup (fail fast)
- Require secure JWT secrets in production
- Validate CORS origins
- Environment-specific validation (debug vs production)

**Example**:
```python
@model_validator(mode='after')
def validate_production_settings(self) -> Self:
    if not self.debug and self.jwt_secret == "your-secret-key-here":
        raise ValueError("JWT_SECRET must be changed in production!")
    return self
```

**Takeaway**: Use validation to prevent common production misconfigurations. Fail fast at startup rather than discovering issues later.

## Troubleshooting

### Tests Failing with "JWT_SECRET must be changed in production!"
**Cause**: Test environment running in production mode (`DEBUG=False`)

**Fix**: Check that `conftest.py` sets `DEBUG=True` and test fixtures reload config module:
```python
monkeypatch.setenv("DEBUG", "True")
importlib.reload(config)
importlib.reload(main)
```

### Railway Deployment: "psycopg2 not installed"
**Cause**: Docker layer caching prevented `requirements.txt` changes from being picked up

**Fix**: Modify `requirements.txt` (add/change a comment) to force cache invalidation

### Railway Deployment: Table Creation Error with Foreign Keys
**Cause**: Tables being created in wrong order (foreign key references table that doesn't exist yet)

**Fix**: Reorder table creation in `init_db()`:
1. Create tables with no dependencies first
2. Then create tables that reference them
3. Order: `cats` → `entries` → `analyses` → `cat_insights`

### CORS Tests Failing After Config Changes
**Cause**: FastAPI app initialized before environment variables were set

**Fix**: Reload config module before main in test fixtures:
```python
import config
import main
importlib.reload(config)
importlib.reload(main)
```

### Local Development: Database Connection Errors
**Cause**: Missing `DATABASE_URL` environment variable or wrong database path

**Fix**:
- For SQLite (local dev): Ensure `CATATLAS_DB_PATH` points to valid location
- For PostgreSQL: Set `DATABASE_URL=postgresql://user:pass@localhost:5432/dbname`
- Check `.env` file exists and is loaded

### Railway Deployment: Health Check Failing
**Cause**: Application not starting or `/health` endpoint not responding

**Troubleshooting**:
1. Check Railway logs for startup errors
2. Verify all required environment variables are set (`DATABASE_URL`, `JWT_SECRET`)
3. Ensure PostgreSQL plugin is connected
4. Check `railway.json` healthcheck path matches actual endpoint

## Migration Checklist (SQLite → PostgreSQL)

When migrating to PostgreSQL or adding PostgreSQL support:

- [ ] Install `psycopg2-binary` in `requirements.txt`
- [ ] Add `database_url` field to config with PostgreSQL connection string support
- [ ] Implement `is_postgres` property in config to detect database type
- [ ] Create `get_conn()` function to return appropriate connection type
- [ ] Create `execute_query()` helper to auto-convert placeholders (`?` → `%s`)
- [ ] Update all SQL queries to use `execute_query()` helper
- [ ] Change `INTEGER PRIMARY KEY AUTOINCREMENT` to use conditional `SERIAL PRIMARY KEY`
- [ ] Update INSERT queries to use `RETURNING id` for PostgreSQL
- [ ] Order table creation to respect foreign key dependencies
- [ ] Test locally with SQLite (ensure backward compatibility)
- [ ] Test with PostgreSQL (local instance or Railway)
- [ ] Update all tests to pass with both database types
- [ ] Set production environment variables (`DATABASE_URL`, `JWT_SECRET`, `DEBUG=False`)
- [ ] Deploy and monitor health checks

## Project Milestones

### ✅ Completed
- [x] Initial FastAPI backend with SQLite
- [x] React 19 frontend with TypeScript
- [x] AI-powered insights and analysis
- [x] Duplicate cat detection
- [x] Cat profile system
- [x] Comprehensive test suite (60 tests, >95% coverage)
- [x] CI/CD with GitHub Actions
- [x] Docker containerization
- [x] Pydantic Settings v2 configuration
- [x] Environment-based validation
- [x] PostgreSQL migration with database abstraction
- [x] Railway.app production deployment
- [x] Health check monitoring

### 🚧 Potential Future Enhancements
- [ ] Frontend deployment to Railway or Vercel
- [ ] User authentication and authorization
- [ ] Image upload and storage (S3/Cloudinary)
- [ ] Real-time updates with WebSockets
- [ ] Advanced search and filtering
- [ ] Map view of cat sightings
- [ ] Email notifications for new sightings
- [ ] Mobile app (React Native)
- [ ] Database migrations tool (Alembic)
- [ ] Performance monitoring (New Relic/DataDog)
- [ ] Rate limiting middleware
- [ ] API versioning
