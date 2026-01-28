# Claude Code Configuration

## Current Version

**Backend**: v1.1.0 - Cat Deduplication System (2026-01-28)
- ✅ Location normalization with OpenStreetMap Nominatim
- ✅ Nearby sighting discovery with configurable radius
- ✅ Validation workflow for linking sightings to cats
- ✅ Area-based clustering and suggested groupings
- ✅ Structured address fields (street, number, zip, city, country)
- ✅ Circuit breaker and retry logic for geocoding

**Frontend**: v1.1.0 - Deduplication UI with Dark Mode
- ✅ Similar/Nearby panel for sighting discovery
- ✅ Create Cat and Link to Cat modals
- ✅ Interactive map view with Leaflet
- ✅ Dark mode support with theme colors
- ✅ Structured address form fields

**Previous**: v1.0.2 - Bunny.net CDN Integration (2026-01-26)
- ✅ Image upload with Bunny.net CDN storage
- ✅ Retry logic with exponential backoff
- ✅ Circuit breaker pattern for resilience

**Recent Changes**:
- Added 4-phase cat deduplication system (backend + frontend)
- Replaced free-text location with structured address fields
- Added OpenStreetMap Nominatim integration for geocoding
- Created interactive map view with Leaflet and clustering
- Added dark mode support with useDarkMode hook
- Fixed Unicode display issues in UI components

## Project Context
**CatAtlas** is a full-stack web application for tracking and managing feral/stray cat sightings. It features AI-powered insights, duplicate detection, and community-driven cat profiles. Built as a learning project demonstrating RESTful API design, modern React development, and CI/CD practices.

**Tech Stack:**
- Backend: FastAPI (Python 3.11+), PostgreSQL (production) / SQLite (local dev), Uvicorn
- Frontend: React 19, TypeScript, Vite
- Image Storage: Bunny.net CDN (EU-based, GDPR-compliant)
- Testing: pytest, FastAPI TestClient
- Deployment: Railway.app (Docker-based), Vercel (frontend)
- CI/CD: GitHub Actions, Docker
- Configuration: Pydantic Settings v2, python-dotenv

## Key Files
### Backend
- `backend/main.py` - FastAPI application entry point with database abstraction layer
- `backend/config.py` - Environment-based configuration using Pydantic Settings v2
- `backend/image_upload.py` - Bunny.net CDN integration with retry logic and circuit breaker
- `backend/debug_bunny.py` - Diagnostic tool for testing Bunny.net connectivity
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
- `frontend/src/App.tsx` - Main React component with view mode tabs (List/Map)
- `frontend/src/main.tsx` - React entry point
- `frontend/src/api/endpoints.ts` - API type definitions and endpoint functions
- `frontend/src/api/upload.ts` - Image upload with structured address support
- `frontend/src/hooks/useDarkMode.ts` - Dark mode detection and theme colors
- `frontend/src/components/SimilarNearbyPanel.tsx` - Panel for finding similar/nearby sightings
- `frontend/src/components/CreateCatModal.tsx` - Modal to create cats from sightings
- `frontend/src/components/LinkToCatModal.tsx` - Modal to link sightings to existing cats
- `frontend/src/components/SightingsMap.tsx` - Interactive Leaflet map with clustering
- `frontend/src/components/LocationStatus.tsx` - Location normalization status display
- `frontend/src/components/Toast.tsx` - Toast notification system
- `frontend/package.json` - Node dependencies (includes leaflet, react-leaflet)
- `frontend/vite.config.ts` - Vite configuration
- `frontend/tsconfig.json` - TypeScript configuration

### Deployment
- `railway.json` - Railway deployment configuration
- `.env.example` - Environment variables template
- `BUNNY_NET_SETUP.md` - Guide for setting up Bunny.net CDN storage
- `BUNNY_NET_TROUBLESHOOTING.md` - Troubleshooting guide for Bunny.net issues
- `RAILWAY_SETUP.md` - Railway deployment guide
- `PRODUCTION_DEPLOYMENT_PLAN.md` - Production deployment checklist

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
- **`BUNNY_STORAGE_ZONE`** (str, optional) - Bunny.net storage zone name (e.g., `catatlas`)
- **`BUNNY_API_KEY`** (str, optional) - Bunny.net Storage API key (password from FTP & API Access)
- **`BUNNY_STORAGE_REGION`** (str, default: `""`) - Storage region prefix (empty for default/Falkenstein, or `ny`/`uk`/`la`/`sg`/`syd`)
- **`BUNNY_CDN_HOSTNAME`** (str, optional) - Bunny.net CDN hostname (e.g., `catatlas.b-cdn.net`)

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

## Image Upload & CDN (Bunny.net)

**Version**: 1.0.2+ includes full image upload support via Bunny.net CDN

### Architecture
- **Storage**: Bunny.net Edge Storage (EU-based, GDPR-compliant, ~€0.30/month for 10GB + 20GB bandwidth)
- **CDN**: Bunny.net Pull Zone for global content delivery
- **Resiliency**: Retry logic with exponential backoff (3 attempts), circuit breaker pattern, 30s timeout
- **Security**: API key authentication, file type validation, size limits (10MB default)

### Key Components
- `backend/image_upload.py` - Upload handler with retry logic, circuit breaker, validation
- `frontend/src/components/ImageUpload.tsx` - React component for file selection and preview
- `frontend/src/api/upload.ts` - API client for multipart/form-data uploads

### API Endpoints
- `POST /entries/with-image` - Create entry with image upload (multipart/form-data)
- `PATCH /entries/{id}/image` - Add or replace entry image
- `DELETE /entries/{id}/image` - Delete entry image from CDN

### Setup Requirements
1. **Create Bunny.net Account** at https://bunny.net
2. **Create Storage Zone** in dashboard (e.g., `catatlas`)
3. **Create Pull Zone** connected to the storage zone
4. **Get Storage API Key** from Storage Zone → FTP & API Access → Password (NOT Account API Key)
5. **Configure Environment Variables** in Railway:
   ```
   BUNNY_STORAGE_ZONE=catatlas
   BUNNY_API_KEY=your-storage-password-here
   BUNNY_STORAGE_REGION=         # Empty for default (Falkenstein/Germany)
   BUNNY_CDN_HOSTNAME=catatlas.b-cdn.net
   ```

### Region Configuration
**CRITICAL**: The default region (Falkenstein, Germany) uses `storage.bunnycdn.com` without a region prefix:
- ❌ Wrong: `BUNNY_STORAGE_REGION=de` → `de.storage.bunnycdn.com` (doesn't exist!)
- ✅ Correct: `BUNNY_STORAGE_REGION=` (empty) → `storage.bunnycdn.com`

Other regions use prefixes:
- `ny` → `ny.storage.bunnycdn.com` (New York)
- `uk` → `uk.storage.bunnycdn.com` (London)
- `la` → `la.storage.bunnycdn.com` (Los Angeles)
- `sg` → `sg.storage.bunnycdn.com` (Singapore)
- `syd` → `syd.storage.bunnycdn.com` (Sydney)

### Troubleshooting
See `BUNNY_NET_TROUBLESHOOTING.md` for detailed debugging guide.

**Common Issues**:
1. **503 errors / Connection timeout**: Wrong region endpoint (use empty string for default region)
2. **401 Unauthorized**: Wrong API key or using Account API Key instead of Storage API Key
3. **403 Forbidden on CDN**: Pull Zone not connected to Storage Zone or hotlink protection enabled
4. **Images upload but don't display**: Check Pull Zone configuration and CORS settings

**Diagnostic Tool**:
```bash
cd backend
python debug_bunny.py  # Tests connectivity, credentials, and permissions
```

## Cat Deduplication System (v1.1.0)

### Overview
The deduplication system helps identify when multiple sightings might be of the same cat, using location normalization and similarity matching.

### Backend Phases

**Phase 1: Location Normalization**
- OpenStreetMap Nominatim integration for geocoding
- Structured address fields: `location_street`, `location_number`, `location_zip`, `location_city`, `location_country`
- Combined location string built from components for better geocoding accuracy
- Circuit breaker pattern for resilience (5 failures → 60s cooldown)
- Retry logic with exponential backoff (2 attempts, 1s base delay)

**Phase 2: Enhanced Location Matching**
- `GET /entries/{id}/nearby` - Find sightings within configurable radius
- Text similarity scoring using word overlap
- Distance calculation using Haversine formula
- Returns match scores and distance in meters

**Phase 3: Validation Workflow**
- `POST /cats/{id}/link-sightings` - Bulk link sightings to existing cat
- `POST /cats/from-sightings` - Create new cat from sighting group
- Suggested name generation based on common location

**Phase 4: Area-based Clustering**
- `GET /entries/by-area` - Query sightings by geographic center + radius
- `GET /entries/suggested-groups` - AI-generated sighting clusters
- Confidence scoring based on proximity and text similarity

### Frontend Components

**SimilarNearbyPanel** (`frontend/src/components/SimilarNearbyPanel.tsx`)
- Slide-in panel with tabs for "Similar Text" and "Nearby"
- Radius slider for adjusting search distance (100m - 2km)
- Selection state with bulk actions
- Dark mode support via `useThemeColors` hook

**CreateCatModal** (`frontend/src/components/CreateCatModal.tsx`)
- Modal for creating cats from selected sightings
- Suggested name based on common location
- Preview of selected sightings

**LinkToCatModal** (`frontend/src/components/LinkToCatModal.tsx`)
- Modal for linking sightings to existing cats
- Cat search and selection
- Result summary with success/failure counts

**SightingsMap** (`frontend/src/components/SightingsMap.tsx`)
- Interactive Leaflet map
- Custom markers for assigned/unassigned sightings
- Area-based queries on map move
- Cluster visualization with confidence colors

### Dark Mode Support
- `useDarkMode` hook detects system preference
- `useThemeColors` returns appropriate color palette
- All deduplication components support light/dark themes

### Structured Address Form
The entry form uses 5 separate fields instead of free-text:
```
┌─────────────────────┬────────────┐
│ Street              │ Number     │
├──────────┬──────────┴────────────┤
│ ZIP      │ City                  │
├──────────┴───────────────────────┤
│ Country                          │
└──────────────────────────────────┘
```

Combined into: "Street Number, ZIP City, Country" for geocoding.

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

## Security Best Practices

### ✅ What We Do Right
1. **SQL Injection Protection**: All queries use parameterized statements via `execute_query()` helper
2. **Production Validation**: Config validation prevents weak secrets and insecure settings in production
3. **CORS Configuration**: Explicitly configured allowed origins, no wildcards in production
4. **Image Validation**: File type and size validation for uploads
5. **Environment-based Secrets**: All secrets loaded from environment variables, not hard-coded

### ⚠️ Security Checklist (CRITICAL - Always Follow)

**1. NEVER Commit Secrets to Repository**
- ❌ **NEVER** create `.env` files with real secrets in the working directory
- ❌ **NEVER** hard-code API keys, passwords, or tokens in source code
- ✅ **ALWAYS** use `.env.example` with placeholder values
- ✅ **ALWAYS** set secrets via deployment platform (Railway, Vercel, GitHub Secrets)
- ✅ **ALWAYS** verify `.env` is in `.gitignore` before creating it

**2. ALWAYS Validate User Input**
- ❌ **NEVER** accept unlimited string lengths in Form() or Query() parameters
- ❌ **NEVER** trust user input without bounds checking
- ✅ **ALWAYS** use Pydantic Field() constraints: `min_length`, `max_length`, `ge`, `le`
- ✅ **ALWAYS** validate both JSON endpoints AND multipart/form-data endpoints
- ✅ **ALWAYS** set reasonable limits (e.g., text max 5000 chars, top_k max 20)

**3. ALWAYS Use Parameterized SQL Queries**
- ❌ **NEVER** concatenate user input into SQL strings: `f"SELECT * FROM users WHERE name = '{name}'"`
- ✅ **ALWAYS** use placeholders: `execute_query(cur, "SELECT * FROM users WHERE name = ?", (name,))`
- ✅ **ALWAYS** use the `execute_query()` helper function (handles SQLite/PostgreSQL differences)

**4. ALWAYS Audit Dependencies**
- ❌ **NEVER** install packages you don't actually use
- ❌ **NEVER** leave authentication libraries (jose, passlib) in requirements if unused
- ✅ **ALWAYS** verify each dependency is imported and used before adding to requirements.txt
- ✅ **ALWAYS** remove unused dependencies to reduce attack surface
- ✅ **ALWAYS** keep dependencies up to date with security patches

### 🔒 Security Audit History

**2026-01-27**: Comprehensive security audit identified and fixed 4 issues:
1. ✅ **Hard-coded JWT secret in `.env`** - Removed file, rely on Railway environment variables
2. ✅ **Missing Form() validation** - Added max_length to `POST /entries/with-image` parameters
3. ✅ **Missing Query() validation** - Added ge/le constraints to `GET /entries/{id}/matches` parameters
4. ✅ **Unused dependencies** - Removed `python-jose` and `passlib` from requirements.txt

**Lessons Learned**:
- Even with `.gitignore`, having real secrets in `.env` files is risky (backups, Docker layers, logs)
- Form-based endpoints need explicit validation - FastAPI doesn't auto-validate like Pydantic models
- Query parameters without limits can cause DoS attacks via memory exhaustion
- Unused dependencies increase Docker image size and create unnecessary security vulnerabilities

### 🛡️ Pre-Commit Security Checklist

Before committing code, verify:
- [ ] No secrets in source code or `.env` files
- [ ] All user input has validation (strings have max_length, numbers have ge/le)
- [ ] All SQL queries use parameterized statements
- [ ] All dependencies in requirements.txt are actually imported and used
- [ ] No wildcard CORS origins in production
- [ ] Production validation tests pass with `DEBUG=False`

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
- Sightings: `GET/POST /entries`, `POST /entries/with-image`
- Images: `PATCH /entries/{id}/image`, `DELETE /entries/{id}/image`
- AI analysis: `GET /entries/{id}/analysis`, `POST /entries/{id}/analyze`
- Cat profiles: `GET/POST /cats`
- Cat insights: `POST /cats/{id}/insights`

### Deduplication Endpoints (v1.1.0)
- Location: `POST /entries/{id}/normalize-location` - Geocode entry location
- Location: `GET /geocoding/health` - Check geocoding service status
- Matching: `GET /entries/{id}/matches` - Find similar sightings by text
- Matching: `GET /entries/{id}/nearby` - Find nearby sightings by location
- Workflow: `POST /cats/{id}/link-sightings` - Bulk link sightings to cat
- Workflow: `POST /cats/from-sightings` - Create cat from sighting group
- Area: `GET /entries/by-area` - Query sightings in geographic area
- Area: `GET /entries/suggested-groups` - Get suggested sighting clusters

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

### 7. PostgreSQL Column Name Casing (Critical!)
**Problem**: After deploying with all fixes (psycopg2, get_cursor(), etc.), still getting `KeyError: 'createdAt'` in production.

**Root Cause**: PostgreSQL **lowercases unquoted column names** in table definitions. When creating tables with:
```sql
CREATE TABLE cats (
    id SERIAL PRIMARY KEY,
    name TEXT,
    createdAt TEXT  -- Stored as "createdat" in PostgreSQL!
)
```

PostgreSQL converts `createdAt` → `createdat` because it's not quoted. But the code tries to access `r["createdAt"]`, causing a KeyError.

**Why It Was Hard to Debug**:
- ✅ SQLite preserves case (works locally)
- ✅ `get_cursor()` returns correct dict cursor
- ✅ Fresh code deployment confirmed
- ❌ But column keys were lowercase: `r["createdat"]` not `r["createdAt"]`

**Solution**: Created `row_get()` helper function that tries both casings:
```python
def row_get(row, key: str):
    """
    Get value from row dict, trying both original case and lowercase.
    PostgreSQL lowercases unquoted column names, SQLite preserves them.
    """
    try:
        return row[key]
    except KeyError:
        return row[key.lower()]
```

Then updated all column accesses:
```python
# Before:
return Cat(id=r["id"], name=r["name"], createdAt=r["createdAt"])

# After:
return Cat(
    id=row_get(r, "id"),
    name=row_get(r, "name"),
    createdAt=row_get(r, "createdAt")
)
```

**Alternative Solution** (Better for new projects):
Use quoted identifiers in CREATE TABLE statements:
```sql
CREATE TABLE cats (
    id SERIAL PRIMARY KEY,
    name TEXT,
    "createdAt" TEXT  -- Quotes preserve case!
)
```

**Takeaway**: PostgreSQL and SQLite handle column name casing differently. Always quote column names with mixed case, OR use a helper function to handle both casings. This is one of the most subtle PostgreSQL migration gotchas!

### 8. Bunny.net Default Region Endpoint (Critical CDN Issue!)
**Problem**: Image uploads failing with connection timeouts and 503 errors after all retry attempts exhausted.

**Root Cause**: The default Bunny.net region (Falkenstein, Germany) uses `storage.bunnycdn.com` without a region prefix, but we were configuring `BUNNY_STORAGE_REGION=de`, which created an invalid endpoint:
```
❌ Wrong: https://de.storage.bunnycdn.com/catatlas (DNS doesn't exist!)
✅ Correct: https://storage.bunnycdn.com/catatlas
```

**Why It Was Hard to Debug**:
- Configuration showed as "configured (de region)" in logs
- All other settings were correct (API key, storage zone name, CDN hostname)
- No explicit error from Bunny.net - just connection timeout
- Retry logic was executing but couldn't connect

**Symptoms**:
```
🔄 Retry attempt 1/3 after 1.0s...
🔄 Retry attempt 2/3 after 2.0s...
INFO: "POST /entries/with-image HTTP/1.1" 503 Service Unavailable
```

**Solution**: Changed default `BUNNY_STORAGE_REGION` from `"de"` to `""` (empty string) and updated the URL builder:
```python
@property
def bunny_storage_url(self) -> Optional[str]:
    if not self.bunny_storage_zone:
        return None

    # Default region (empty string) uses storage.bunnycdn.com (no prefix)
    if self.bunny_storage_region:
        return f"https://{self.bunny_storage_region}.storage.bunnycdn.com/{self.bunny_storage_zone}"
    else:
        return f"https://storage.bunnycdn.com/{self.bunny_storage_zone}"
```

**Region Mapping**:
- Empty string → `storage.bunnycdn.com` (Falkenstein, Germany - default)
- `ny` → `ny.storage.bunnycdn.com`
- `uk` → `uk.storage.bunnycdn.com`
- `la` → `la.storage.bunnycdn.com`
- `sg` → `sg.storage.bunnycdn.com`
- `syd` → `syd.storage.bunnycdn.com`

**Takeaway**: CDN providers may use different endpoint patterns for their default vs regional data centers. Always check the actual API documentation for endpoint formats. The retry logic correctly identified it as a connection issue, not an authentication problem.

### 9. Security Audit - Input Validation and Dependency Management (2026-01-27)
**Problem**: Security audit revealed 4 categories of vulnerabilities in production code.

**Findings**:

1. **Hard-coded Secrets** (Medium severity):
   - Real JWT secret stored in `backend/.env` file (even though gitignored)
   - Risk: File could be exposed via backups, Docker layers, CI logs, or filesystem access

2. **Missing Input Validation** (High severity):
   - `POST /entries/with-image` accepted unlimited text lengths via Form() parameters
   - `GET /entries/{id}/matches` allowed unlimited `top_k` parameter
   - Risk: Memory exhaustion DoS attacks, database failures
   - Example attack: `POST /entries/with-image` with 1GB text field

3. **Unused Dependencies** (Low severity):
   - `python-jose[cryptography]==3.3.0` - Not imported anywhere (auth planned but never implemented)
   - `passlib[bcrypt]==1.7.4` - Not imported anywhere (password hashing planned but never implemented)
   - Risk: Unnecessary attack surface, larger Docker images, potential vulnerabilities in unused code

4. **SQL Injection** - ✅ No issues found (all queries properly parameterized)

**Solution**:
```python
# Before (vulnerable):
async def create_entry_with_image(
    text: str = Form(...),              # ❌ Unlimited length
    nickname: Optional[str] = Form(None),  # ❌ Unlimited length
    location: Optional[str] = Form(None),  # ❌ Unlimited length
    image: Optional[UploadFile] = File(None)
):

def find_matches(entry_id: int, top_k: int = 5, min_score: float = 0.15):  # ❌ No limits

# After (secure):
async def create_entry_with_image(
    text: str = Form(..., min_length=1, max_length=5000),  # ✅ Limited
    nickname: Optional[str] = Form(None, max_length=100),   # ✅ Limited
    location: Optional[str] = Form(None, max_length=200),   # ✅ Limited
    image: Optional[UploadFile] = File(None)
):

def find_matches(
    entry_id: int,
    top_k: int = Query(5, ge=1, le=20),         # ✅ Bounded
    min_score: float = Query(0.15, ge=0.0, le=1.0)  # ✅ Bounded
):
```

**Actions Taken**:
1. ✅ Removed `backend/.env` file completely (Railway provides secrets)
2. ✅ Added validation to Form() parameters matching JSON endpoint constraints
3. ✅ Added Query() parameter validation with ge/le bounds
4. ✅ Removed unused dependencies: `python-jose`, `passlib`
5. ✅ Added Security Best Practices section to claude.md
6. ✅ Created pre-commit security checklist

**Why This Happened**:
- Form-based endpoints don't inherit Pydantic model validation automatically
- Query parameters default to Python's unlimited int/float ranges
- Dependencies were added for planned features (auth) but never removed when those features were cut
- `.env` file was created for local testing and not cleaned up

**Takeaway**:
- **Always validate user input explicitly** - Form() and Query() parameters need validation even if JSON endpoints are protected
- **Never create `.env` files with real secrets** - Use `.env.example` with placeholders only
- **Audit dependencies regularly** - Remove unused packages to reduce attack surface
- **Security is not automatic** - Even with good practices (parameterized SQL), subtle issues can creep in
- **Security audits should be routine** - Schedule regular reviews, especially before major releases

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

### PostgreSQL: KeyError on Column Names (Even After All Fixes)
**Cause**: PostgreSQL lowercases unquoted column names, but code expects camelCase

**Symptoms**:
- `KeyError: 'createdAt'` or `KeyError: 'isFavorite'` in production
- Works fine locally with SQLite
- `get_cursor()` is being used correctly
- Fresh deployment confirmed

**Fix**:
1. **Quick fix**: Use `row_get()` helper function (see Lesson #7)
2. **Proper fix**: Rebuild tables with quoted identifiers:
   ```sql
   CREATE TABLE cats (
       id SERIAL PRIMARY KEY,
       name TEXT,
       "createdAt" TEXT  -- Quotes preserve case
   )
   ```

**Verification**:
```sql
-- Check actual column names in PostgreSQL:
SELECT column_name FROM information_schema.columns
WHERE table_name = 'cats';
```

If you see `createdat` instead of `createdAt`, that's the issue!

### Bunny.net: Image Uploads Timeout with 503 Errors
**Cause**: Wrong storage region endpoint (using `de` for default region)

**Symptoms**:
- Retry attempts shown in logs: `🔄 Retry attempt 1/3 after 1.0s...`
- All retries fail with connection timeout
- Final 503 Service Unavailable response
- Configuration shows "Bunny.net: configured" on startup

**Fix**:
1. Set `BUNNY_STORAGE_REGION=` (empty string) in Railway for default region
2. OR use appropriate region code: `ny`, `uk`, `la`, `sg`, `syd`
3. Redeploy and verify startup logs show correct endpoint:
   ```
   ☁️  Bunny.net: configured (default (Falkenstein) region)
       Storage endpoint: https://storage.bunnycdn.com/catatlas
   ```

### Bunny.net: 401 Unauthorized on Upload
**Cause**: Using Account API Key instead of Storage API Key

**Fix**:
1. Go to Bunny.net → Storage → Storage Zones → Click your zone
2. Go to "FTP & API Access" tab
3. Copy the **Password** field (this is the Storage API Key)
4. Update `BUNNY_API_KEY` in Railway with this password
5. Ensure you're using the regular Password, NOT the Read-only Password

### Bunny.net: Images Upload Successfully But Don't Display (403 on CDN)
**Cause**: Pull Zone not properly configured or connected to Storage Zone

**Symptoms**:
- Image uploads succeed (no errors in backend)
- Direct CDN URL returns 403 Forbidden
- Image tag renders but doesn't load

**Fix**:
1. Go to Bunny.net → CDN → Pull Zones
2. Click your pull zone (e.g., `catatlas`)
3. Go to General → Origin section
4. Verify "Storage zone" is set to your storage zone name
5. Click "Save Origin" if needed
6. Go to Security tab:
   - Ensure "Block root path access" is OFF
   - Clear any "Blocked referrers"
   - Either clear "Allowed referrers" or add your domains
7. Test by accessing image URL directly in browser

### Bunny.net: Diagnostic Tool
**Use Case**: Verify Bunny.net configuration and credentials

**Run**:
```bash
cd backend
python debug_bunny.py
```

**What It Tests**:
- ✅ Environment variables are set
- ✅ Can list files in storage zone (tests API key validity)
- ✅ Can upload test file (tests write permissions)
- ✅ Can delete test file (tests cleanup)

**Output**: Detailed diagnostics with specific error messages and next steps

### Railway Deployment: Persistent Docker Cache
**Cause**: Railway's Docker registry cache persists across service deletions

**Symptoms**:
- Build logs show everything as `cached`
- Deleting and recreating service doesn't help
- Fresh commits don't trigger fresh builds

**Fix**: Add aggressive cache buster to Dockerfile BEFORE COPY commands:
```dockerfile
# Force cache invalidation
RUN echo "Build timestamp: $(date +%Y-%m-%d-%H:%M:%S)" > /tmp/cachebust.txt

# Then copy files
COPY . /app
```

Change the timestamp on every deployment to force Docker to invalidate cache.

## Migration Checklist (SQLite → PostgreSQL)

When migrating to PostgreSQL or adding PostgreSQL support:

- [ ] Install `psycopg2-binary` in `requirements.txt`
- [ ] Add `database_url` field to config with PostgreSQL connection string support
- [ ] Implement `is_postgres` property in config to detect database type
- [ ] Create `get_conn()` function to return appropriate connection type
- [ ] Create `get_cursor()` function to return `RealDictCursor` for PostgreSQL
- [ ] **CRITICAL**: Create `row_get()` helper to handle PostgreSQL's lowercase column names
- [ ] Create `execute_query()` helper to auto-convert placeholders (`?` → `%s`)
- [ ] Update all SQL queries to use `execute_query()` helper
- [ ] Change `INTEGER PRIMARY KEY AUTOINCREMENT` to use conditional `SERIAL PRIMARY KEY`
- [ ] Update INSERT queries to use `RETURNING id` for PostgreSQL
- [ ] **Either** quote all camelCase column names in CREATE TABLE OR use `row_get()` helper
- [ ] Update all row accesses to use `row_get(row, "columnName")` instead of `row["columnName"]`
- [ ] Order table creation to respect foreign key dependencies
- [ ] Test locally with SQLite (ensure backward compatibility)
- [ ] Test with PostgreSQL (local instance or Railway)
- [ ] Update all tests to pass with both database types
- [ ] Set production environment variables (`DATABASE_URL`, `JWT_SECRET`, `DEBUG=False`)
- [ ] Deploy and monitor health checks
- [ ] Verify column name casing works correctly in production

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
- [x] Vercel frontend deployment
- [x] Health check monitoring
- [x] Image upload and storage (Bunny.net CDN)
- [x] Retry logic with exponential backoff
- [x] Circuit breaker pattern for CDN resilience
- [x] Multipart form-data handling
- [x] Image validation (type, size limits)
- [x] CDN integration with Pull Zone
- [x] **Cat Deduplication System (v1.1.0)**
  - [x] Location normalization with OpenStreetMap Nominatim
  - [x] Nearby sighting discovery with radius search
  - [x] Validation workflow (link sightings, create cats)
  - [x] Area-based clustering and suggested groupings
  - [x] Structured address fields for better geocoding
- [x] **Deduplication UI (v1.1.0)**
  - [x] Similar/Nearby panel with tabs
  - [x] Create Cat and Link to Cat modals
  - [x] Interactive map view with Leaflet
  - [x] Dark mode support
  - [x] Auto-location normalization after entry creation

### 🚧 Potential Future Enhancements
- [ ] User authentication and authorization
- [ ] Real-time updates with WebSockets
- [ ] Advanced search and filtering
- [ ] Email notifications for new sightings
- [ ] Mobile app (React Native)
- [ ] Database migrations tool (Alembic)
- [ ] Performance monitoring (New Relic/DataDog)
- [ ] Rate limiting middleware
- [ ] API versioning
- [ ] Image optimization and thumbnails
- [ ] Batch image upload
