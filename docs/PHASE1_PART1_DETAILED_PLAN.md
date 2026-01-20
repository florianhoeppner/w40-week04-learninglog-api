# Phase 1, Part 1: Environment Management - Detailed Plan & Architectural Analysis

**Duration:** 2 days
**Priority:** CRITICAL - Must be completed before all other work
**Risk Level:** Medium (requires refactoring existing code)

---

## Executive Summary

Environment Management establishes a **typed, validated configuration system** to replace hardcoded values throughout the codebase. This is the foundation upon which authentication, security, and deployment will be built.

---

## Why Environment Management First?

### 1. **Dependency Chain**
Every subsequent feature depends on configuration:
- **Authentication** (Days 3-7) needs: `JWT_SECRET`, `ACCESS_TOKEN_EXPIRE_MINUTES`
- **Security** (Days 8-10) needs: `ALLOWED_ORIGINS`, `RATE_LIMIT_PER_MINUTE`
- **Deployment** (Phase 2) needs: `DATABASE_URL`, `SENTRY_DSN`, environment-specific settings
- **Monitoring** (Phase 2) needs: `LOG_LEVEL`, monitoring endpoints

Without centralized config, each feature would use ad-hoc `os.getenv()` calls scattered throughout the code, leading to:
- No validation (missing vars discovered at runtime)
- No type safety (string parsing errors)
- No documentation (developers guess variable names)
- Security risks (default values in code)

### 2. **Security Foundation**
Current state has **critical security issues**:
```python
# Current code (main.py line 27)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ⚠️ ALLOWS ALL DOMAINS
    ...
)
```

This must be configurable before deploying to production. Environment management provides:
- **Validation**: Rejects `allow_origins=["*"]` in production mode
- **Type checking**: Ensures `ALLOWED_ORIGINS` is a list of strings
- **Documentation**: `.env.example` shows developers what to configure

### 3. **12-Factor App Compliance**
The [12-Factor App methodology](https://12factor.net/config) mandates:
> "Store config in the environment"

Benefits:
- **Separation of code and config**: Same codebase deployed to dev/staging/prod
- **No secrets in git**: `.env` files are gitignored
- **Easy configuration changes**: No code redeployment needed for config updates

### 4. **Developer Experience**
Pydantic Settings provides:
- **IDE autocomplete**: `settings.jwt_secret` vs `os.getenv("JWT_SECRET")`
- **Type hints**: Know what type each setting is
- **Startup validation**: App won't start with invalid config
- **Self-documenting**: Settings class shows all available options

---

## Current State Analysis

### Problems in Existing Codebase

**1. Hardcoded CORS (main.py:27)**
```python
allow_origins=["*"]  # Security vulnerability
```
**Impact**: Any website can make requests to the API (CSRF, data theft)

**2. Ad-hoc Environment Variable Usage (main.py:47)**
```python
DB_PATH = os.getenv("CATATLAS_DB_PATH", "learninglog.db")
```
**Problems**:
- No validation (could be None, empty string, invalid path)
- Inconsistent naming (why `CATATLAS_DB_PATH` vs `DATABASE_PATH`?)
- No documentation (developers don't know this exists)

**3. No Environment File Template**
- `.env.example` doesn't exist
- New developers don't know what to configure
- Production deployments guess at required variables

**4. Frontend Environment Issues**
- `/frontend/.env` is **tracked in git** (visible in commit history)
- Contains Codespaces URL (environment-specific value in version control)
- No validation that `VITE_API_BASE` is set

---

## Proposed Solution: Pydantic Settings

### Architecture Decision: Why Pydantic Settings?

I evaluated three approaches:

#### Option 1: python-decouple
```python
from decouple import config

JWT_SECRET = config('JWT_SECRET')
DEBUG = config('DEBUG', default=False, cast=bool)
```

**Pros:**
- Lightweight (small dependency)
- Simple API

**Cons:**
- No type hints (IDE doesn't know types)
- No validation (can't enforce "JWT_SECRET must be 32+ chars")
- No structure (settings scattered across files)
- Manual type casting required

#### Option 2: os.getenv() (current approach)
```python
import os

JWT_SECRET = os.getenv('JWT_SECRET', 'default-secret')
DEBUG = os.getenv('DEBUG', 'False') == 'True'
```

**Pros:**
- Zero dependencies (stdlib only)
- Simple

**Cons:**
- String parsing everywhere (error-prone)
- No validation
- No IDE support
- Hard to test

#### Option 3: Pydantic Settings (RECOMMENDED)
```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    jwt_secret: str
    debug: bool = False
    allowed_origins: List[str] = ["http://localhost:5173"]

    class Config:
        env_file = ".env"
```

**Pros:**
- **Type safety**: Automatic validation and parsing
- **IDE support**: Autocomplete, type hints, refactoring
- **Validation**: Custom validators (e.g., "jwt_secret must be 32+ chars")
- **Documentation**: Self-documenting (class shows all settings)
- **FastAPI integration**: Same library, consistent patterns
- **Testability**: Easy to mock settings in tests

**Cons:**
- Additional dependency (but we already use pydantic via FastAPI)
- Slightly more code upfront (pays off long-term)

**Decision: Use Pydantic Settings** because type safety and validation prevent entire classes of bugs, and the integration with FastAPI is seamless.

---

## Implementation Plan - Detailed Breakdown

### Day 1, Morning: Backend Configuration Module

#### Task 1.1: Install Dependencies (30 minutes)

**Action:**
```bash
cd backend
echo "python-dotenv==1.0.0" >> requirements.txt
echo "pydantic-settings==2.1.0" >> requirements.txt
pip install -r requirements.txt
```

**Why these versions?**
- `python-dotenv==1.0.0`: Latest stable, loads .env files
- `pydantic-settings==2.1.0`: Matches Pydantic v2 (FastAPI uses this)

**Implication:** Adds 2 dependencies (minimal overhead, both are widely used)

---

#### Task 1.2: Create Settings Module (2 hours)

**Action:** Create `backend/config.py`

**Key Design Decisions:**

**1. Settings Class Structure**
```python
class Settings(BaseSettings):
    # Application
    app_name: str = "CatAtlas API"
    app_version: str = "1.0.0"
    debug: bool = False
```

**Why separate sections?**
- **Organization**: Groups related settings
- **Documentation**: Developers know where to add new settings
- **Maintainability**: Easy to find specific settings

**2. Required vs Optional Settings**
```python
jwt_secret: str  # REQUIRED (no default)
sentry_dsn: Optional[str] = None  # OPTIONAL
```

**Why?**
- **Fail fast**: App won't start without JWT_SECRET
- **Graceful degradation**: Sentry is optional (monitoring nice-to-have)

**Critical Implication:** This breaks existing deployments that don't have `JWT_SECRET` set. **Mitigation:** Provide clear error message and migration guide.

**3. Type Hints for Lists**
```python
allowed_origins: List[str] = ["http://localhost:5173"]
```

**Why List[str]?**
- Pydantic automatically parses comma-separated env var: `"http://a.com,http://b.com"` → `["http://a.com", "http://b.com"]`
- Type safety: Can't accidentally set to integer or dict

**4. Production Validation Method**
```python
def validate_production_settings(self):
    if not self.debug:
        if self.jwt_secret == "change-me-in-production":
            raise ValueError("JWT_SECRET must be changed in production!")
```

**Why?**
- **Security enforcement**: Prevents common mistakes (forgotten placeholder values)
- **Explicit**: Called on import in production mode (line 50: `if not settings.debug: settings.validate_production_settings()`)

**Implication:** Production deployments will **crash at startup** if misconfigured. This is **intentional** - better to fail visibly than run insecurely.

---

#### Task 1.3: Create .env.example Template (1 hour)

**Action:** Create `backend/.env.example`

**Key Design Decisions:**

**1. Documentation in Comments**
```bash
# Authentication (CHANGE IN PRODUCTION!)
JWT_SECRET=change-me-in-production-use-openssl-rand-hex-32
```

**Why?**
- **Guidance**: Tells developers to change it
- **How-to**: Shows command to generate secure value
- **Security**: Placeholder is clearly insecure (would trigger validation error)

**2. Sensible Defaults**
```bash
DEBUG=True
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

**Why?**
- **Developer experience**: Copy .env.example → rename to .env → works for local dev
- **Multiple ports**: Covers Vite (5173) and alternative dev servers (3000)

**3. Optional Settings Shown But Empty**
```bash
SENTRY_DSN=
```

**Why?**
- **Discovery**: Developers know this option exists
- **Documentation**: Can add later without code changes

**Implication:** Developers must manually generate JWT_SECRET before first run. **Mitigation:** Document in README with copy-paste commands.

---

### Day 1, Afternoon: Refactor Existing Code (3 hours)

#### Task 1.4: Update main.py to Use Settings

**Critical Refactoring Points:**

**1. CORS Middleware (main.py:27)**
```python
# BEFORE
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ⚠️ SECURITY ISSUE
    ...
)

# AFTER
from config import settings

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,  # ✅ CONFIGURABLE
    ...
)
```

**Implication:**
- **Breaking change**: Existing deployments must set `ALLOWED_ORIGINS`
- **Security improvement**: Forces explicit origin configuration
- **Default behavior**: Local development still works (default: localhost:5173)

**Migration Path:**
1. Development: Use default (localhost)
2. Production: Set `ALLOWED_ORIGINS=https://your-domain.com`

**2. Database Path (main.py:47)**
```python
# BEFORE
DB_PATH = os.getenv("CATATLAS_DB_PATH", "learninglog.db")

# AFTER
from config import settings
DB_PATH = os.getenv("CATATLAS_DB_PATH", settings.database_path)
```

**Why keep os.getenv() here?**
- **Backward compatibility**: Existing deployments using `CATATLAS_DB_PATH` still work
- **Deprecation path**: We'll migrate to `DATABASE_PATH` in Phase 2 (database migrations)

**Implication:** Two ways to set database path (temporary, technical debt). **Resolution:** Phase 2 will standardize on `DATABASE_PATH`.

**3. Startup Logging**
```python
@app.on_event("startup")
async def startup_event():
    print(f"🚀 Starting {settings.app_name} v{settings.app_version}")
    print(f"📊 Debug mode: {settings.debug}")
    print(f"🗄️  Database: {DB_PATH}")
    print(f"🔒 CORS allowed origins: {settings.allowed_origins}")
```

**Why log on startup?**
- **Verification**: Developers can see what config is active
- **Debugging**: Production issues often traced to config problems
- **Security**: Sanitized output (no secrets logged)

**Implication:** Log output increases (negligible performance impact). **Benefit:** Vastly improved debuggability.

---

### Day 1, Evening: Frontend Environment Setup (2 hours)

#### Task 1.5: Create Frontend .env.example

**Key Decision: Keep It Simple**
```bash
VITE_API_BASE=http://localhost:8000
VITE_APP_NAME=CatAtlas
VITE_APP_VERSION=1.0.0
```

**Why minimal?**
- Frontend has fewer config needs
- Most settings are build-time (Vite bundles them)
- Can expand later (analytics, feature flags)

**Critical Issue: Current .env is in git history**

**Problem:**
```bash
$ git log --all --full-history -- "frontend/.env"
# Shows commits with .env file containing Codespaces URLs
```

**Implication:** Sensitive URLs exposed in git history. **Mitigation:**
1. Add to .gitignore (prevents future commits)
2. Document that old commits may contain .env (acceptable for learning project)
3. For production: Would need to purge history (git-filter-repo) or rotate secrets

**For this project:** Document the issue, ensure .env is gitignored going forward.

---

### Day 2, Morning: Testing & Validation (3 hours)

#### Task 1.6: Create Config Tests

**Test Strategy: Validate All Edge Cases**

**Test 1: Settings Load with Defaults**
```python
def test_settings_load_with_defaults():
    os.environ["JWT_SECRET"] = "test-secret-32-chars-long"
    settings = Settings()
    assert settings.app_name == "CatAtlas API"
    assert settings.jwt_algorithm == "HS256"
```

**Why?**
- Ensures default values work
- Documents expected defaults
- Catches accidental changes to defaults

**Test 2: Required Field Validation**
```python
def test_settings_require_jwt_secret():
    if "JWT_SECRET" in os.environ:
        del os.environ["JWT_SECRET"]

    with pytest.raises(ValidationError):
        Settings()
```

**Why?**
- **Critical security**: JWT_SECRET must be set
- **Fail fast**: Catch at startup, not runtime

**Implication:** Developers running tests must set `JWT_SECRET` in test environment. **Solution:** Tests set it in fixture.

**Test 3: Production Validation**
```python
def test_settings_validate_production_mode():
    os.environ["JWT_SECRET"] = "change-me-in-production"
    os.environ["DEBUG"] = "False"

    settings = Settings()
    with pytest.raises(ValueError, match="JWT_SECRET must be changed"):
        settings.validate_production_settings()
```

**Why?**
- **Production safety**: Can't deploy with placeholder values
- **Explicit**: Tests the validation actually works

**Test 4: .env File Loading**
```python
def test_settings_from_env_file(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("JWT_SECRET=test-key\nRATE_LIMIT_PER_MINUTE=200")

    settings = Settings(_env_file=str(env_file))
    assert settings.rate_limit_per_minute == 200
```

**Why?**
- **File loading**: Ensures .env files work
- **Override behavior**: Tests env vars override defaults

**Test 5: List Parsing**
```python
def test_allowed_origins_parsing():
    os.environ["ALLOWED_ORIGINS"] = "http://localhost:3000,https://example.com"
    settings = Settings()
    assert len(settings.allowed_origins) == 2
```

**Why?**
- **Complex types**: Lists need special parsing
- **Production use case**: Multiple origins common in prod

---

### Day 2, Afternoon: Documentation & Migration (3 hours)

#### Task 1.7: Update README

**Key Sections to Add:**

**1. Environment Setup**
```markdown
## Environment Setup

### Backend
1. Copy the template: `cp backend/.env.example backend/.env`
2. Generate JWT secret: `python3 -c "import secrets; print(secrets.token_hex(32))"`
3. Update .env with the generated secret
```

**Why explicit steps?**
- **Developer onboarding**: New developers know exactly what to do
- **Security**: Forces JWT secret generation (can't skip)

**2. Environment Variables Table**
```markdown
| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| JWT_SECRET | Secret key for JWT tokens | ✅ Yes | - |
| DATABASE_PATH | SQLite database location | No | learninglog.db |
```

**Why table format?**
- **Scannable**: Developers quickly find what they need
- **Complete reference**: No need to read code
- **Required column**: Makes dependencies explicit

**3. Production Deployment Notes**
```markdown
### Production Checklist
- [ ] Set JWT_SECRET to secure random value (32+ bytes)
- [ ] Set DEBUG=False
- [ ] Configure ALLOWED_ORIGINS to your domain(s)
- [ ] Verify settings with startup logs
```

**Why checklist?**
- **Operational**: Deployers don't miss critical steps
- **Security**: Makes security requirements explicit

---

#### Task 1.8: Create Migration Guide

**For Existing Deployments:**

**Problem:** Deployed instances currently have:
- `CATATLAS_DB_PATH` set (old naming)
- No `JWT_SECRET` (new requirement)
- No `ALLOWED_ORIGINS` (new requirement)

**Migration Steps:**
```markdown
## Migrating Existing Deployments

### Step 1: Add Required Variables
```bash
# Generate JWT secret
JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")

# Add to your deployment platform (Railway/Render/etc)
export JWT_SECRET="<generated-value>"
export ALLOWED_ORIGINS="https://your-domain.com"
```

### Step 2: Backward Compatibility
Old variable `CATATLAS_DB_PATH` still works - no changes needed.
Will be deprecated in Phase 2.

### Step 3: Restart Application
New settings take effect on restart.
```

**Implication:** Zero-downtime migration not possible (requires restart). **Acceptable because:** This is a learning project, not production with SLA requirements.

---

## Architectural Implications

### 1. **Breaking Changes**
**Impact:** Existing deployments will break without environment configuration

**Affected:**
- Codespaces URLs (need to set `ALLOWED_ORIGINS`)
- Any deployed instances (need `JWT_SECRET`)

**Mitigation:**
- Clear error messages on startup
- Migration guide in documentation
- Backward compatibility for `CATATLAS_DB_PATH`

### 2. **Technical Debt Created**
**Two ways to set database path:**
```python
# Old way (still supported)
os.getenv("CATATLAS_DB_PATH")

# New way (recommended)
settings.database_path
```

**Resolution Plan:** Phase 2 (Database Migrations) will:
- Standardize on `DATABASE_PATH`
- Deprecate `CATATLAS_DB_PATH`
- Update all documentation

### 3. **Increased Startup Complexity**
**Before:** App always starts (no validation)
**After:** App validates config, may fail to start

**Trade-off Analysis:**
- **Cost:** Slightly longer startup time (~10ms for validation)
- **Benefit:** Catches misconfiguration before handling requests
- **Verdict:** Worth it - fail-fast principle prevents production issues

### 4. **Testing Impact**
**Before:** Tests used hardcoded values
**After:** Tests must set environment variables

**Example:**
```python
# Test setup now requires
os.environ["JWT_SECRET"] = "test-secret-32-chars"
```

**Mitigation:** Use pytest fixtures to set env vars automatically

### 5. **Type Safety vs Flexibility**
**Pydantic enforces types:**
```python
rate_limit_per_minute: int = 100

# Setting RATE_LIMIT_PER_MINUTE=abc raises ValidationError
```

**Trade-off:**
- **Pro:** Catches type errors at startup
- **Con:** Less forgiving (must be valid integer)
- **Verdict:** Type safety prevents bugs worth the strictness

---

## Security Implications

### 1. **Secrets Management Improved**
**Before:**
```python
# Hardcoded or weak defaults
SECRET = "secret123"  # ⚠️ INSECURE
```

**After:**
```python
# Required to be set, validated on startup
jwt_secret: str  # MUST be provided
```

**Impact:** Forces proper secret generation

### 2. **CORS Vulnerability Fixed**
**Before:** `allow_origins=["*"]` (all domains)
**After:** Must explicitly set allowed origins

**Security Improvement:** Prevents CSRF attacks, data theft

### 3. **Production Mode Validation**
```python
if not self.debug:
    if self.jwt_secret == "change-me-in-production":
        raise ValueError("JWT_SECRET must be changed in production!")
```

**Impact:** Impossible to deploy with placeholder values

**Trade-off:** More strict, but prevents security vulnerabilities

### 4. **Environment File Security**
**.gitignore includes:**
```
.env
.env.local
.env.production
```

**Impact:** Secrets never committed (going forward)

**Known Issue:** Old commits have .env in history
**Resolution:** Acceptable for learning project, document the issue

---

## Performance Implications

### 1. **Startup Time**
**Added overhead:**
- Load .env file: ~1-2ms
- Parse and validate settings: ~5-10ms
- Total: **~10-15ms** added to startup

**Context:** FastAPI startup is ~100-200ms, so this is **5-10% increase**

**Verdict:** Negligible, worth the benefits

### 2. **Runtime Performance**
**Before:** `os.getenv("VAR")` on every access (dict lookup + string parsing)
**After:** `settings.var` (attribute access on pre-parsed object)

**Performance:** **Settings access is faster** (computed once at startup)

### 3. **Memory Usage**
**Added:** Single Settings object (~1KB in memory)

**Verdict:** Trivial memory overhead

---

## Testing Strategy

### Unit Tests (5 tests)
1. ✅ Settings load with defaults
2. ✅ Required fields validated
3. ✅ Production mode validation
4. ✅ .env file loading
5. ✅ Complex type parsing (lists)

**Coverage Target:** 100% of config.py

### Integration Tests
**Defer to subsequent phases** (will test auth with settings, security with settings, etc.)

### Manual Testing Checklist
```markdown
- [ ] Copy .env.example to .env
- [ ] Generate JWT secret
- [ ] Start backend - verify startup logs
- [ ] Change ALLOWED_ORIGINS - verify CORS works
- [ ] Set invalid value - verify ValidationError
- [ ] Set DEBUG=False with weak secret - verify rejection
```

---

## Rollback Plan

### If Implementation Fails

**Scenario:** Settings module causes critical issues

**Rollback Steps:**
1. Revert commit: `git revert <commit-hash>`
2. Restore old code: `allow_origins=["*"]`
3. Remove dependencies: Remove from requirements.txt
4. Restart app

**Recovery Time:** ~5 minutes

**Data Loss:** None (config changes don't affect database)

---

## Success Criteria

### Functional Requirements
- ✅ Settings load from .env file
- ✅ Settings load from environment variables
- ✅ Type validation works (rejects invalid types)
- ✅ Production validation works (rejects weak secrets)
- ✅ All tests pass
- ✅ Existing functionality still works

### Non-Functional Requirements
- ✅ Startup time increase < 50ms
- ✅ No impact on request latency
- ✅ Documentation complete (.env.example, README)
- ✅ Migration guide for existing deployments

### Security Requirements
- ✅ No hardcoded secrets in code
- ✅ .env files gitignored
- ✅ Production mode rejects weak defaults
- ✅ CORS configurable (no wildcard in prod)

---

## Timeline & Dependencies

### Day 1: Configuration Setup
```
09:00-09:30  Install dependencies (30m)
09:30-11:30  Create Settings module (2h)
11:30-12:30  Create .env.example (1h)
--- Lunch ---
13:30-16:30  Refactor main.py (3h)
16:30-18:30  Frontend .env setup (2h)
```

**Deliverables:** Settings module working, CORS configurable

### Day 2: Testing & Documentation
```
09:00-12:00  Write config tests (3h)
--- Lunch ---
13:00-16:00  Documentation & migration guide (3h)
16:00-17:00  Manual testing & validation (1h)
17:00-18:00  Buffer time for issues
```

**Deliverables:** All tests passing, documentation complete

---

## Risk Assessment

### High Risk
**Risk:** Breaking existing Codespaces/deployments
**Probability:** High (99% - will definitely break without config)
**Impact:** High (app won't start)
**Mitigation:**
- Clear error messages
- Migration guide in docs
- Test in Codespaces before finalizing

### Medium Risk
**Risk:** Developers confused by new configuration system
**Probability:** Medium (30% - some may struggle)
**Impact:** Medium (delays onboarding)
**Mitigation:**
- Excellent documentation
- .env.example template
- Explicit error messages

### Low Risk
**Risk:** Performance degradation from validation
**Probability:** Low (5% - validation is fast)
**Impact:** Low (10-15ms startup overhead)
**Mitigation:**
- Benchmark before/after
- Lazy load if needed (unlikely)

---

## Alternative Approaches Considered

### Alternative 1: Keep os.getenv() Everywhere
**Pros:** No refactoring needed
**Cons:** No validation, no type safety, scattered config
**Verdict:** ❌ Rejected - technical debt accumulates

### Alternative 2: Custom Config Class
```python
class Config:
    def __init__(self):
        self.jwt_secret = os.getenv("JWT_SECRET")
        if not self.jwt_secret:
            raise ValueError("JWT_SECRET required")
```

**Pros:** No dependency, simple
**Cons:** Manual validation for every field, no type hints, more code
**Verdict:** ❌ Rejected - reinventing the wheel

### Alternative 3: Pydantic Settings (CHOSEN)
**Pros:** Type safety, validation, FastAPI integration, well-tested
**Cons:** Additional dependency (already using pydantic)
**Verdict:** ✅ **SELECTED** - Best balance of features and maintainability

---

## Post-Implementation Tasks

### Phase 1, Part 2 (Authentication) Dependency
Authentication will use:
```python
from config import settings

create_access_token(
    data={"sub": user_id},
    expires_delta=timedelta(minutes=settings.access_token_expire_minutes)
)
```

**Benefit:** Token expiration configurable per environment

### Phase 2 (Deployment) Dependency
Deployment will set:
```bash
# Railway/Render environment variables
JWT_SECRET=<production-secret>
ALLOWED_ORIGINS=https://your-frontend.com
DATABASE_PATH=/data/learninglog.db
SENTRY_DSN=https://...
```

**Benefit:** Same code, different config per environment

---

## Conclusion

**Environment Management is non-negotiable foundation work** that:
- ✅ Enables all subsequent features (auth, security, deployment)
- ✅ Fixes critical CORS security vulnerability
- ✅ Provides type safety and validation
- ✅ Improves developer experience
- ✅ Follows industry best practices (12-factor)

**Trade-offs accepted:**
- Small startup time increase (10-15ms)
- Breaking change for existing deployments (mitigated with docs)
- Additional dependency (pydantic-settings, but we already use pydantic)

**Why do this first:** Every other feature will benefit from proper configuration management. Doing it later means refactoring authentication, security, and deployment code. **Do it once, do it right, do it now.**

---

## Questions for Discussion

1. **JWT_SECRET requirement:** Should we auto-generate if missing (dev mode only)? Or always require explicit set?

2. **CORS strictness:** Should default allow localhost:5173 OR require explicit configuration even for dev?

3. **Database path:** Deprecate `CATATLAS_DB_PATH` now or in Phase 2?

4. **Feature flags:** Add `ENABLE_REGISTRATION` now or wait until needed?

5. **Validation strictness:** Fail fast on all validation errors OR allow some flexibility?

**My Recommendations:**
1. Always require JWT_SECRET (security first)
2. Allow localhost default (developer convenience)
3. Deprecate in Phase 2 (backward compatibility for now)
4. Add now (enables disabling registration in production)
5. Fail fast (better to crash at startup than have runtime issues)
