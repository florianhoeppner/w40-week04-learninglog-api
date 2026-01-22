# Production Deployment Plan - CatAtlas Learning Log API

## Executive Summary

This document provides a comprehensive plan for deploying the CatAtlas Learning Log application to production. The current state has:
- ✅ Backend API with environment management (Pydantic Settings)
- ✅ Frontend built and deployed to GitHub Pages
- ✅ Docker image built and pushed to GHCR
- ❌ Backend NOT deployed to any runtime environment
- ❌ Production environment variables not configured
- ❌ SQLite database (not suitable for production scale)

## Current Architecture vs Target Architecture

### Current State
```
Frontend: GitHub Pages (static hosting)
Backend:  Docker image in GHCR (not running anywhere)
Database: SQLite (file-based, not production-ready)
```

### Target Production Architecture
```
Frontend: GitHub Pages (CDN, static) → Backend API
Backend:  Cloud Runtime (Fly.io/Railway/Render) → Database
Database: PostgreSQL (managed, persistent)
Secrets:  Environment variables (platform-specific)
```

## Prerequisites

Before starting, ensure you have:
- [ ] Domain name (optional but recommended): `catatlas.com`
- [ ] Credit card for cloud provider (most have free tiers)
- [ ] GitHub repository access
- [ ] Decision on cloud provider (see options below)

---

## Phase 1: Choose Deployment Platform

### Option A: Fly.io (Recommended)
**Pros:**
- Built for Docker deployments
- Global edge network
- Generous free tier (3 shared-cpu VMs)
- Built-in PostgreSQL (3GB free)
- Automatic HTTPS/SSL
- Great for FastAPI apps

**Cons:**
- Requires credit card
- Newer platform (less mature than Heroku)

**Cost:** FREE for this app size (within free tier limits)

### Option B: Railway
**Pros:**
- Very easy to use
- Auto-deploys from GitHub
- Built-in PostgreSQL
- $5/month free credit

**Cons:**
- Free tier limited to 500 hours/month
- Credit runs out if not careful

**Cost:** FREE initially, ~$5-10/month after free credit

### Option C: Render
**Pros:**
- Simple deployment from GitHub
- Free tier for web services
- Managed PostgreSQL available

**Cons:**
- Free tier spins down after inactivity (slow cold starts)
- Free PostgreSQL expires after 90 days

**Cost:** FREE (with limitations)

### Option D: Google Cloud Run
**Pros:**
- Pay only for actual usage
- Auto-scales to zero
- Production-grade infrastructure

**Cons:**
- More complex setup
- Requires GCP account
- Need separate database setup

**Cost:** ~$0-5/month for low traffic

### Recommendation: Fly.io
Best balance of features, cost, and ease of use for this application.

---

## Phase 2: Database Migration (SQLite → PostgreSQL)

### Why Migrate?
SQLite is file-based and not suitable for:
- Multiple concurrent connections
- Cloud deployments (ephemeral filesystems)
- High traffic
- Data persistence across deployments

### Migration Steps

#### Step 1: Add PostgreSQL Support to Backend

**Install dependencies:**
```bash
cd backend
pip install psycopg2-binary sqlalchemy
pip freeze > requirements.txt
```

**Update `config.py`:**
```python
# Database
database_url: str = "sqlite:///learninglog.db"  # Default for local dev
database_type: str = "sqlite"  # or "postgresql"

@property
def is_production(self) -> bool:
    return not self.debug

@field_validator('database_url')
def validate_database_url(cls, v, info):
    # Ensure production uses PostgreSQL
    if not info.data.get('debug', True):
        if v.startswith('sqlite'):
            raise ValueError('Production must use PostgreSQL, not SQLite')
    return v
```

**Create `database.py` for SQLAlchemy:**
```python
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_type == "sqlite" else {}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

**Effort:** 4-6 hours (includes refactoring database access)
**Risk:** Medium (requires changing all SQL queries)

#### Step 2: Create Migration Script

Export SQLite data and import to PostgreSQL:
```python
# scripts/migrate_sqlite_to_postgres.py
import sqlite3
import psycopg2
from psycopg2.extras import execute_values

def migrate_data(sqlite_path, postgres_url):
    # Read from SQLite
    sqlite_conn = sqlite3.connect(sqlite_path)
    sqlite_conn.row_factory = sqlite3.Row

    # Write to PostgreSQL
    pg_conn = psycopg2.connect(postgres_url)

    # Migrate each table...
```

**Effort:** 2-3 hours
**Risk:** Low (one-time operation)

---

## Phase 3: Production Environment Configuration

### Required Environment Variables

Create `.env.production` template:

```bash
# Application
APP_NAME=CatAtlas API
APP_VERSION=1.0.0
DEBUG=False  # CRITICAL: Must be False in production

# Database
DATABASE_URL=postgresql://user:pass@host:5432/catatlas
DATABASE_TYPE=postgresql

# Authentication
JWT_SECRET=<GENERATE_WITH_COMMAND_BELOW>
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# Security
ALLOWED_ORIGINS=https://florianhoeppner.github.io,https://catatlas.com
RATE_LIMIT_PER_MINUTE=100
AUTH_RATE_LIMIT_PER_MINUTE=5

# Monitoring
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project
LOG_LEVEL=INFO

# Feature Flags
ENABLE_REGISTRATION=True
```

### Generate Production Secrets

**JWT_SECRET:**
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

**Example output:**
```
e259263dc4eb1b49ff6c82fec74f4cca7634bb9d4fac49c0081326dc2777dd5d
```

### Security Checklist

- [ ] `DEBUG=False` (enables production validation)
- [ ] `JWT_SECRET` is 64+ characters (32 bytes hex)
- [ ] `ALLOWED_ORIGINS` contains only your actual domains (no `*`)
- [ ] `DATABASE_URL` uses PostgreSQL (not SQLite)
- [ ] Secrets are stored in platform environment variables (NOT in code)

---

## Phase 4: Deploy Backend to Fly.io (Step-by-Step)

### Step 1: Install Fly CLI

**macOS:**
```bash
brew install flyctl
```

**Linux:**
```bash
curl -L https://fly.io/install.sh | sh
```

**Windows:**
```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

### Step 2: Login and Initialize

```bash
# Login to Fly.io
flyctl auth login

# Navigate to backend directory
cd backend

# Initialize Fly.io app
flyctl launch --no-deploy
```

**Interactive prompts:**
```
App Name: catatlas-api
Region: Choose closest to users (e.g., iad - Washington DC)
PostgreSQL: Yes (creates free 3GB database)
Redis: No (not needed yet)
```

This creates `fly.toml` configuration file.

### Step 3: Configure `fly.toml`

Edit the generated `fly.toml`:

```toml
app = "catatlas-api"
primary_region = "iad"

[build]
  image = "ghcr.io/florianhoeppner/w40-week04-learninglog-api:main"

[env]
  APP_NAME = "CatAtlas API"
  APP_VERSION = "1.0.0"
  DEBUG = "False"
  DATABASE_TYPE = "postgresql"
  JWT_ALGORITHM = "HS256"
  ACCESS_TOKEN_EXPIRE_MINUTES = "30"
  REFRESH_TOKEN_EXPIRE_DAYS = "7"
  RATE_LIMIT_PER_MINUTE = "100"
  AUTH_RATE_LIMIT_PER_MINUTE = "5"
  LOG_LEVEL = "INFO"
  ENABLE_REGISTRATION = "True"

[http_service]
  internal_port = 8000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0
  processes = ["app"]

[[http_service.checks]]
  interval = "30s"
  timeout = "5s"
  grace_period = "10s"
  method = "GET"
  path = "/health"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256
```

### Step 4: Set Secrets

**NEVER** put secrets in `fly.toml` or code. Use Fly secrets:

```bash
# Generate and set JWT_SECRET
JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
flyctl secrets set JWT_SECRET="$JWT_SECRET"

# Set ALLOWED_ORIGINS (use your actual frontend URL)
flyctl secrets set ALLOWED_ORIGINS="https://florianhoeppner.github.io"

# Database URL is automatically set by Fly PostgreSQL
# It will be available as DATABASE_URL
```

### Step 5: Set Up PostgreSQL

```bash
# Create PostgreSQL database (if not done in launch)
flyctl postgres create --name catatlas-db --region iad

# Attach database to your app
flyctl postgres attach catatlas-db

# This automatically sets DATABASE_URL secret
```

### Step 6: Deploy

```bash
# Deploy the application
flyctl deploy

# Monitor deployment
flyctl logs
```

### Step 7: Run Database Migrations

```bash
# SSH into the running app
flyctl ssh console

# Inside the container, run migrations
python3 scripts/init_db.py

# Exit
exit
```

### Step 8: Verify Deployment

```bash
# Check app status
flyctl status

# Check health endpoint
curl https://catatlas-api.fly.dev/health

# View logs
flyctl logs

# Open app in browser
flyctl open
```

Your backend will be available at: `https://catatlas-api.fly.dev`

---

## Phase 5: Update Frontend Configuration

### Step 1: Update Frontend Environment

Edit `frontend/.env.production`:

```bash
VITE_API_BASE=https://catatlas-api.fly.dev
```

### Step 2: Rebuild and Deploy Frontend

```bash
cd frontend
npm run build
git add dist/
git commit -m "build: update API endpoint to production"
git push origin main
```

GitHub Pages will automatically deploy the updated frontend.

### Step 3: Update Backend CORS

The backend needs to allow your GitHub Pages domain:

```bash
flyctl secrets set ALLOWED_ORIGINS="https://florianhoeppner.github.io,https://w40-week04-learninglog-api.github.io"
```

---

## Phase 6: CI/CD Pipeline Updates

### Update GitHub Actions for Production Deploys

Create `.github/workflows/deploy-production.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Fly CLI
        uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy to Fly.io
        run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
        working-directory: ./backend

  deploy-frontend:
    runs-on: ubuntu-latest
    needs: deploy-backend
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '19'

      - name: Build Frontend
        run: |
          cd frontend
          npm ci
          npm run build

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./frontend/dist
```

**Add Fly.io token to GitHub Secrets:**
1. Get your Fly.io token: `flyctl auth token`
2. Go to GitHub → Settings → Secrets → Actions
3. Add `FLY_API_TOKEN` with the token value

---

## Phase 7: Monitoring and Observability

### Set Up Sentry for Error Tracking

1. **Create Sentry account:** https://sentry.io
2. **Create new project:** Choose Python/FastAPI
3. **Install Sentry SDK:**
   ```bash
   pip install sentry-sdk[fastapi]
   ```

4. **Update `main.py`:**
   ```python
   import sentry_sdk
   from config import settings

   if settings.sentry_dsn:
       sentry_sdk.init(
           dsn=settings.sentry_dsn,
           environment="production" if not settings.debug else "development",
           traces_sample_rate=0.1,
       )
   ```

5. **Set secret:**
   ```bash
   flyctl secrets set SENTRY_DSN="https://your-key@sentry.io/project-id"
   ```

### Set Up Logging

Update `main.py` with structured logging:

```python
import logging
from config import settings

logging.basicConfig(
    level=settings.log_level,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_event():
    logger.info(f"Starting {settings.app_name} v{settings.app_version}")
    logger.info(f"Environment: {'production' if not settings.debug else 'development'}")
```

### View Production Logs

```bash
# Tail logs in real-time
flyctl logs

# Search logs
flyctl logs --search "error"

# Last 100 lines
flyctl logs --lines 100
```

---

## Phase 8: Performance and Scaling

### Database Connection Pooling

Update `database.py` for production:

```python
from sqlalchemy.pool import QueuePool

engine = create_engine(
    settings.database_url,
    poolclass=QueuePool,
    pool_size=5,          # Number of connections to maintain
    max_overflow=10,      # Max additional connections
    pool_pre_ping=True,   # Verify connections before using
)
```

### Add Database Indexes

Create migration for performance:

```sql
-- backend/migrations/add_indexes.sql
CREATE INDEX idx_entries_cat_id ON entries(cat_id);
CREATE INDEX idx_entries_created_at ON entries(createdAt);
CREATE INDEX idx_analyses_entry_id ON analyses(entry_id);
CREATE INDEX idx_cats_created_at ON cats(createdAt);
```

### Enable Response Caching

Add caching middleware for expensive operations:

```python
from fastapi_cache import FastAPICache
from fastapi_cache.backends.redis import RedisBackend
from fastapi_cache.decorator import cache

@app.get("/cats/{cat_id}/profile")
@cache(expire=300)  # Cache for 5 minutes
async def get_cat_profile(cat_id: int):
    # Expensive profile generation
    ...
```

### Scale Resources (if needed)

```bash
# Increase VM size
flyctl scale vm shared-cpu-2x

# Increase memory
flyctl scale memory 512

# Add more instances
flyctl scale count 2
```

---

## Phase 9: Domain and SSL Setup

### Option A: Use Fly.io Domain (Free)

Your app is already available at:
```
https://catatlas-api.fly.dev
```

No additional setup needed. SSL is automatic.

### Option B: Custom Domain (Optional)

1. **Buy domain:** catatlas.com from Namecheap/Google Domains

2. **Add certificate:**
   ```bash
   flyctl certs create catatlas.com
   flyctl certs create www.catatlas.com
   ```

3. **Add DNS records** at your domain registrar:
   ```
   Type: CNAME
   Name: @
   Value: catatlas-api.fly.dev

   Type: CNAME
   Name: www
   Value: catatlas-api.fly.dev
   ```

4. **Update ALLOWED_ORIGINS:**
   ```bash
   flyctl secrets set ALLOWED_ORIGINS="https://catatlas.com,https://www.catatlas.com"
   ```

---

## Phase 10: Testing and Validation

### Production Smoke Tests

Create `scripts/production_smoke_test.sh`:

```bash
#!/bin/bash
API_BASE="https://catatlas-api.fly.dev"

echo "Testing health endpoint..."
curl -f "$API_BASE/health" || exit 1

echo "Testing CORS headers..."
curl -H "Origin: https://florianhoeppner.github.io" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: Content-Type" \
     -X OPTIONS \
     "$API_BASE/entries" || exit 1

echo "Testing POST /entries..."
curl -X POST "$API_BASE/entries" \
     -H "Content-Type: application/json" \
     -d '{"text":"Production test entry","nickname":"Smokey"}' || exit 1

echo "All smoke tests passed!"
```

### Run Tests Against Production

```bash
# Set production API URL
export CATATLAS_API_BASE=https://catatlas-api.fly.dev

# Run integration tests
pytest tests/test_integration.py -v
```

### Load Testing (Optional)

Use `locust` to test performance:

```bash
pip install locust

# Create locustfile.py
cat > locustfile.py << 'EOF'
from locust import HttpUser, task, between

class CatAtlasUser(HttpUser):
    wait_time = between(1, 3)

    @task
    def get_entries(self):
        self.client.get("/entries")

    @task(3)
    def create_entry(self):
        self.client.post("/entries", json={
            "text": "Load test entry",
            "nickname": "Test Cat"
        })

    @task
    def health_check(self):
        self.client.get("/health")
EOF

# Run load test
locust -f locustfile.py --host https://catatlas-api.fly.dev
```

Open http://localhost:8089 to control the load test.

---

## Phase 11: Backup and Disaster Recovery

### Database Backups

Fly.io PostgreSQL has automatic backups, but set up additional:

```bash
# Create manual snapshot
flyctl postgres backup create --app catatlas-db

# List backups
flyctl postgres backup list --app catatlas-db

# Restore from backup
flyctl postgres backup restore <backup-id> --app catatlas-db
```

### Automated Backup Script

Create GitHub Action for weekly backups:

```yaml
name: Database Backup

on:
  schedule:
    - cron: '0 2 * * 0'  # Every Sunday at 2 AM
  workflow_dispatch:

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Backup Database
        run: |
          flyctl postgres backup create --app catatlas-db
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

### Rollback Plan

If deployment fails:

```bash
# View deployment history
flyctl releases

# Rollback to previous version
flyctl releases rollback <version-number>
```

---

## Phase 12: Cost Optimization

### Fly.io Free Tier Limits

- 3 shared-cpu-1x VMs (256MB RAM each)
- 3GB PostgreSQL database
- 160GB outbound data transfer/month

**Your app will likely stay FREE** with these limits.

### Cost Monitoring

```bash
# Check current usage
flyctl dashboard billing

# Set spending limit (optional)
flyctl orgs billing limit set 10  # $10/month max
```

### Optimization Tips

1. **Auto-stop/start machines:** Already configured in `fly.toml`
2. **Reduce VM size:** Use smallest that handles load
3. **Cache responses:** Reduce database queries
4. **Optimize images:** If serving images, use CDN

---

## Timeline and Effort Estimates

| Phase | Task | Time | Risk |
|-------|------|------|------|
| 1 | Choose platform | 30 min | Low |
| 2 | Database migration | 6-8 hours | Medium |
| 3 | Environment config | 1 hour | Low |
| 4 | Deploy to Fly.io | 2 hours | Medium |
| 5 | Update frontend | 30 min | Low |
| 6 | CI/CD updates | 2 hours | Low |
| 7 | Monitoring setup | 1 hour | Low |
| 8 | Performance tuning | 2-3 hours | Low |
| 9 | Custom domain (optional) | 1 hour | Low |
| 10 | Testing | 2 hours | Low |
| 11 | Backup setup | 1 hour | Low |
| 12 | Cost optimization | 30 min | Low |

**Total: 18-22 hours** (2-3 days of focused work)

---

## Success Criteria

Your deployment is successful when:

- [ ] Backend API responds at production URL
- [ ] Frontend connects to production backend
- [ ] All tests pass against production
- [ ] HTTPS/SSL working
- [ ] CORS configured correctly
- [ ] Database is PostgreSQL (not SQLite)
- [ ] Environment variables set securely
- [ ] Error monitoring (Sentry) configured
- [ ] Logs accessible via `flyctl logs`
- [ ] Health check endpoint returns 200
- [ ] No DEBUG=True in production
- [ ] JWT_SECRET is strong and unique
- [ ] Backups configured
- [ ] Zero cost (within free tier)

---

## Troubleshooting Common Issues

### Issue: "Database connection failed"
```bash
# Check DATABASE_URL is set
flyctl secrets list

# Verify PostgreSQL is running
flyctl postgres status --app catatlas-db

# Test connection from app
flyctl ssh console -C "python3 -c 'from database import engine; engine.connect()'"
```

### Issue: "CORS errors in browser"
```bash
# Check ALLOWED_ORIGINS
flyctl secrets list

# Ensure it includes your frontend domain
flyctl secrets set ALLOWED_ORIGINS="https://florianhoeppner.github.io"

# Check response headers
curl -v https://catatlas-api.fly.dev/health
```

### Issue: "App not starting"
```bash
# View logs
flyctl logs

# Check health check
flyctl checks list

# SSH into app
flyctl ssh console
```

### Issue: "Slow cold starts"
```bash
# Keep at least 1 machine running
flyctl scale count 1 --min-machines-running 1
```

---

## Next Steps After Deployment

Once in production, consider:

1. **Analytics:** Add Google Analytics or Plausible to track usage
2. **User Feedback:** Add feedback mechanism in UI
3. **API Documentation:** Enable `/docs` endpoint (FastAPI OpenAPI)
4. **Rate Limiting:** Implement per-IP rate limiting
5. **Authentication:** Add user accounts (cancelled earlier, but may want later)
6. **Mobile App:** Build React Native app using same API
7. **Email Notifications:** Notify users of insights
8. **AI Integration:** Real AI for cat analysis (currently baseline)

---

## Support and Resources

- **Fly.io Docs:** https://fly.io/docs/
- **FastAPI Deployment:** https://fastapi.tiangolo.com/deployment/
- **PostgreSQL Migration:** https://www.postgresql.org/docs/
- **Sentry FastAPI:** https://docs.sentry.io/platforms/python/guides/fastapi/

---

## Questions to Answer Before Starting

1. **Do you want to migrate to PostgreSQL now, or start with SQLite in production?**
   - PostgreSQL: Better for production, but more setup
   - SQLite: Quick to deploy, but limited

2. **Which deployment platform do you prefer?**
   - Fly.io (recommended)
   - Railway
   - Render
   - Google Cloud Run
   - Other

3. **Do you need a custom domain, or is `*.fly.dev` acceptable?**

4. **What's your target traffic?**
   - Low (< 1000 requests/day): Free tier sufficient
   - Medium (1000-10000/day): May need paid tier
   - High (> 10000/day): Definitely paid tier

**Once you answer these, I can help you execute the specific deployment path!**
