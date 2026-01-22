# Infrastructure Improvement Plan

> Detailed plan for Security Hardening, Testing Infrastructure, Monitoring, and CI/CD improvements for the CatAtlas Learning Log API.

---

## Table of Contents

1. [Security Hardening](#1-security-hardening)
2. [Testing Infrastructure](#2-testing-infrastructure)
3. [Monitoring](#3-monitoring)
4. [CI/CD](#4-cicd)
5. [Implementation Priority](#5-implementation-priority)
6. [Estimated Effort](#6-estimated-effort)

---

## 1. Security Hardening

### 1.1 Rate Limiting

**Current State:** Configuration exists (`RATE_LIMIT_PER_MINUTE=100`, `AUTH_RATE_LIMIT_PER_MINUTE=5`) but no middleware implementation.

#### Implementation Plan

**A. Install Dependencies**
```bash
pip install slowapi>=0.1.9
```

**B. Create Rate Limiting Middleware** (`backend/middleware/rate_limit.py`)
```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi import Request

limiter = Limiter(key_func=get_remote_address)

def setup_rate_limiting(app, settings):
    """Configure rate limiting for the FastAPI app."""
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # Configure limits from settings
    limiter.default_limits = [f"{settings.rate_limit_per_minute}/minute"]
```

**C. Apply to Endpoints**
```python
from middleware.rate_limit import limiter

@app.post("/entries")
@limiter.limit("100/minute")
async def create_entry(request: Request, entry: EntryCreate):
    ...

@app.post("/auth/login")
@limiter.limit("5/minute")  # Stricter for auth endpoints
async def login(request: Request, credentials: LoginRequest):
    ...
```

**D. Rate Limit Configuration by Endpoint Type**

| Endpoint Category | Limit | Rationale |
|-------------------|-------|-----------|
| Authentication | 5/min | Prevent brute force attacks |
| Write operations (POST/PUT/DELETE) | 30/min | Prevent spam/abuse |
| Read operations (GET) | 100/min | Allow normal browsing |
| AI/Analysis endpoints | 10/min | Expensive operations |
| Health check | Unlimited | Monitoring systems |

**E. Response Headers**
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Remaining requests in window
- `X-RateLimit-Reset`: Unix timestamp when limit resets

**F. Testing Requirements**
- Test rate limit enforcement
- Test 429 Too Many Requests response
- Test rate limit headers
- Test IP-based vs user-based limiting

---

### 1.2 Input Sanitization

**Current State:** Good Pydantic validation exists (length limits, type checking). Missing: XSS protection, content sanitization.

#### Implementation Plan

**A. Install Dependencies**
```bash
pip install bleach>=6.0.0
pip install python-magic>=0.4.27  # File type validation
```

**B. Create Sanitization Utilities** (`backend/utils/sanitize.py`)
```python
import bleach
import re
from typing import Optional

ALLOWED_TAGS = ['b', 'i', 'u', 'em', 'strong', 'p', 'br']
ALLOWED_ATTRIBUTES = {}

def sanitize_html(text: str) -> str:
    """Remove dangerous HTML/JS while preserving safe formatting."""
    return bleach.clean(text, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRIBUTES, strip=True)

def sanitize_text(text: str) -> str:
    """Remove all HTML tags for plain text fields."""
    return bleach.clean(text, tags=[], strip=True)

def validate_url(url: Optional[str]) -> Optional[str]:
    """Validate URL format and allowed schemes."""
    if url is None:
        return None
    allowed_schemes = ['http', 'https']
    parsed = urlparse(url)
    if parsed.scheme not in allowed_schemes:
        raise ValueError(f"URL scheme must be one of: {allowed_schemes}")
    return url

def remove_null_bytes(text: str) -> str:
    """Remove null bytes that could cause issues."""
    return text.replace('\x00', '')
```

**C. Enhanced Pydantic Validators**
```python
from pydantic import field_validator
from utils.sanitize import sanitize_text, remove_null_bytes

class EntryCreate(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)

    @field_validator('text')
    @classmethod
    def sanitize_text_field(cls, v: str) -> str:
        v = remove_null_bytes(v)
        v = sanitize_text(v)
        return v.strip()
```

**D. File Upload Validation** (if applicable)
```python
import magic

ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB

def validate_uploaded_file(file_content: bytes) -> bool:
    mime = magic.from_buffer(file_content, mime=True)
    if mime not in ALLOWED_MIME_TYPES:
        raise ValueError(f"File type {mime} not allowed")
    if len(file_content) > MAX_FILE_SIZE:
        raise ValueError(f"File exceeds {MAX_FILE_SIZE} bytes limit")
    return True
```

---

### 1.3 Security Headers

**Current State:** No security headers implemented.

#### Implementation Plan

**A. Create Security Headers Middleware** (`backend/middleware/security_headers.py`)
```python
from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Clickjacking protection
        response.headers["X-Frame-Options"] = "DENY"

        # XSS Protection (legacy browsers)
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Strict Transport Security (HTTPS enforcement)
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        # Content Security Policy
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https:; "
            "font-src 'self'; "
            "connect-src 'self' https://api.example.com; "
            "frame-ancestors 'none';"
        )

        # Referrer Policy
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Permissions Policy (restrict browser features)
        response.headers["Permissions-Policy"] = (
            "geolocation=(), "
            "microphone=(), "
            "camera=(), "
            "payment=()"
        )

        return response

def setup_security_headers(app: FastAPI):
    app.add_middleware(SecurityHeadersMiddleware)
```

**B. Apply to Application**
```python
# In main.py
from middleware.security_headers import setup_security_headers

# Apply middleware (order matters - security headers should be early)
setup_security_headers(app)
```

**C. Security Headers Summary**

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `X-XSS-Protection` | `1; mode=block` | Legacy XSS protection |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Force HTTPS |
| `Content-Security-Policy` | (see above) | Control resource loading |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control referrer info |
| `Permissions-Policy` | Restrict features | Disable unused browser APIs |

**D. Testing Requirements**
```python
def test_security_headers(client):
    response = client.get("/health")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert "Strict-Transport-Security" in response.headers
    assert "Content-Security-Policy" in response.headers
```

---

## 2. Testing Infrastructure

### 2.1 End-to-End (E2E) Tests

**Current State:** Backend has good unit/integration tests. No E2E tests, no frontend tests.

#### Implementation Plan

**A. E2E Test Framework Selection**

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **Playwright** | Fast, multi-browser, good API | Newer | **Recommended** |
| Cypress | Great DX, time travel debugging | Single browser at time | Good alternative |
| Selenium | Mature, wide support | Slower, verbose | Legacy choice |

**B. Playwright Setup** (`frontend/e2e/`)
```bash
npm install -D @playwright/test
npx playwright install
```

**C. E2E Test Structure**
```
frontend/
├── e2e/
│   ├── fixtures/
│   │   └── test-data.ts
│   ├── pages/
│   │   ├── home.page.ts
│   │   └── entry.page.ts
│   ├── tests/
│   │   ├── entry-crud.spec.ts
│   │   ├── cat-tracking.spec.ts
│   │   └── error-handling.spec.ts
│   └── playwright.config.ts
```

**D. Playwright Configuration** (`frontend/playwright.config.ts`)
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.API_URL || 'http://localhost:8000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

**E. Example E2E Test** (`frontend/e2e/tests/entry-crud.spec.ts`)
```typescript
import { test, expect } from '@playwright/test';

test.describe('Entry Management', () => {
  test('should create a new sighting entry', async ({ page }) => {
    await page.goto('/');

    // Fill in entry form
    await page.fill('[data-testid="text-input"]', 'Spotted an orange tabby');
    await page.fill('[data-testid="nickname-input"]', 'Whiskers');
    await page.fill('[data-testid="location-input"]', 'Central Park');

    // Submit form
    await page.click('[data-testid="submit-button"]');

    // Verify entry appears in list
    await expect(page.locator('[data-testid="entry-list"]')).toContainText('Whiskers');
  });

  test('should handle validation errors', async ({ page }) => {
    await page.goto('/');

    // Submit empty form
    await page.click('[data-testid="submit-button"]');

    // Verify error message
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
  });

  test('should delete an entry', async ({ page }) => {
    // ... test implementation
  });
});
```

**F. Page Object Model** (`frontend/e2e/pages/entry.page.ts`)
```typescript
import { Page, Locator } from '@playwright/test';

export class EntryPage {
  readonly page: Page;
  readonly textInput: Locator;
  readonly submitButton: Locator;
  readonly entryList: Locator;

  constructor(page: Page) {
    this.page = page;
    this.textInput = page.locator('[data-testid="text-input"]');
    this.submitButton = page.locator('[data-testid="submit-button"]');
    this.entryList = page.locator('[data-testid="entry-list"]');
  }

  async createEntry(text: string, nickname?: string, location?: string) {
    await this.textInput.fill(text);
    if (nickname) await this.page.fill('[data-testid="nickname-input"]', nickname);
    if (location) await this.page.fill('[data-testid="location-input"]', location);
    await this.submitButton.click();
  }
}
```

---

### 2.2 Load Testing

**Current State:** No load testing.

#### Implementation Plan

**A. Load Testing Tool Selection**

| Tool | Language | Pros | Cons |
|------|----------|------|------|
| **Locust** | Python | Easy to learn, distributed | Less features |
| k6 | JavaScript | Modern, cloud integration | Requires JS |
| Artillery | JavaScript | YAML config, easy | Less flexible |
| JMeter | Java | Full-featured | Complex UI |

**Recommendation:** Use **Locust** (Python-based, matches backend stack)

**B. Install Dependencies**
```bash
pip install locust>=2.20.0
```

**C. Load Test Structure**
```
backend/
├── load_tests/
│   ├── locustfile.py
│   ├── scenarios/
│   │   ├── read_heavy.py
│   │   ├── write_heavy.py
│   │   └── mixed_workload.py
│   └── config/
│       ├── staging.conf
│       └── production.conf
```

**D. Locust Configuration** (`backend/load_tests/locustfile.py`)
```python
from locust import HttpUser, task, between, events
import json
import random

class CatAtlasUser(HttpUser):
    wait_time = between(1, 3)  # Wait 1-3 seconds between tasks

    def on_start(self):
        """Called when a simulated user starts."""
        self.entry_ids = []

    @task(10)  # Weight: 10 (most common)
    def list_entries(self):
        """List all entries - most common operation."""
        with self.client.get("/entries", catch_response=True) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Got status {response.status_code}")

    @task(5)  # Weight: 5
    def get_single_entry(self):
        """Get a specific entry."""
        if self.entry_ids:
            entry_id = random.choice(self.entry_ids)
            self.client.get(f"/entries/{entry_id}")

    @task(3)  # Weight: 3
    def create_entry(self):
        """Create a new entry."""
        payload = {
            "text": f"Load test sighting {random.randint(1, 10000)}",
            "nickname": f"TestCat{random.randint(1, 100)}",
            "location": "Load Test Location"
        }
        with self.client.post("/entries", json=payload, catch_response=True) as response:
            if response.status_code == 200:
                data = response.json()
                self.entry_ids.append(data["id"])
                response.success()

    @task(1)  # Weight: 1 (expensive operation)
    def analyze_entry(self):
        """Request AI analysis - expensive operation."""
        if self.entry_ids:
            entry_id = random.choice(self.entry_ids)
            self.client.post(f"/entries/{entry_id}/analyze")

    @task(2)
    def health_check(self):
        """Check health endpoint."""
        self.client.get("/health")

# Custom metrics reporting
@events.request.add_listener
def on_request(request_type, name, response_time, response_length, **kwargs):
    """Log request metrics for analysis."""
    pass  # Add custom metrics collection here
```

**E. Load Test Scenarios**

**Scenario 1: Baseline Performance** (`scenarios/baseline.py`)
```python
# 50 concurrent users, 5 minute duration
# Target: 95th percentile < 200ms for reads
```

**Scenario 2: Stress Test** (`scenarios/stress.py`)
```python
# Ramp from 10 to 500 users over 10 minutes
# Find breaking point
```

**Scenario 3: Spike Test** (`scenarios/spike.py`)
```python
# Sudden jump from 50 to 300 users
# Test recovery behavior
```

**Scenario 4: Soak Test** (`scenarios/soak.py`)
```python
# 100 users for 4 hours
# Detect memory leaks, connection pool exhaustion
```

**F. Performance Targets**

| Metric | Target | Acceptable | Critical |
|--------|--------|------------|----------|
| Response Time (p50) | < 50ms | < 100ms | > 200ms |
| Response Time (p95) | < 200ms | < 500ms | > 1000ms |
| Error Rate | < 0.1% | < 1% | > 5% |
| Throughput | > 100 RPS | > 50 RPS | < 20 RPS |

**G. Running Load Tests**
```bash
# Local testing
locust -f load_tests/locustfile.py --host=http://localhost:8000

# Headless mode (CI/CD)
locust -f load_tests/locustfile.py --host=http://localhost:8000 \
  --users 100 --spawn-rate 10 --run-time 5m --headless \
  --csv=results/load_test

# Distributed testing
locust -f load_tests/locustfile.py --master
locust -f load_tests/locustfile.py --worker --master-host=localhost
```

---

## 3. Monitoring

### 3.1 Logging

**Current State:** Only startup logs. No request logging, no structured logging.

#### Implementation Plan

**A. Install Dependencies**
```bash
pip install structlog>=23.1.0
pip install python-json-logger>=2.0.7
```

**B. Logging Configuration** (`backend/utils/logging.py`)
```python
import structlog
import logging
import sys
from typing import Any

def setup_logging(log_level: str = "INFO", json_format: bool = False):
    """Configure structured logging for the application."""

    # Configure standard library logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, log_level.upper()),
    )

    # Configure structlog
    processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]

    if json_format:
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer())

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, log_level.upper())
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

    return structlog.get_logger()

# Global logger instance
logger = structlog.get_logger()
```

**C. Request Logging Middleware** (`backend/middleware/request_logging.py`)
```python
import time
import uuid
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from utils.logging import logger
import structlog

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Generate correlation ID
        request_id = str(uuid.uuid4())[:8]

        # Bind context for this request
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            client_ip=request.client.host if request.client else "unknown",
        )

        # Add request ID to response headers
        start_time = time.perf_counter()

        try:
            response = await call_next(request)

            # Calculate duration
            duration_ms = (time.perf_counter() - start_time) * 1000

            # Log request completion
            logger.info(
                "request_completed",
                status_code=response.status_code,
                duration_ms=round(duration_ms, 2),
            )

            # Add correlation ID to response
            response.headers["X-Request-ID"] = request_id

            return response

        except Exception as e:
            duration_ms = (time.perf_counter() - start_time) * 1000
            logger.error(
                "request_failed",
                error=str(e),
                error_type=type(e).__name__,
                duration_ms=round(duration_ms, 2),
            )
            raise
```

**D. Application-Level Logging**
```python
from utils.logging import logger

# In endpoint handlers
@app.post("/entries")
async def create_entry(entry: EntryCreate):
    logger.info("creating_entry", nickname=entry.nickname)

    try:
        result = db.create_entry(entry)
        logger.info("entry_created", entry_id=result.id)
        return result
    except Exception as e:
        logger.error("entry_creation_failed", error=str(e))
        raise

# In database operations
def execute_query(query: str, params: tuple):
    logger.debug("executing_query", query_hash=hash(query))
    start = time.perf_counter()
    result = cursor.execute(query, params)
    duration = (time.perf_counter() - start) * 1000
    logger.debug("query_completed", duration_ms=round(duration, 2))
    return result
```

**E. Log Format Examples**

**Development (Console)**:
```
2024-01-15T10:30:45.123Z [info] request_completed request_id=abc12345 method=POST path=/entries status_code=200 duration_ms=45.23
```

**Production (JSON)**:
```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "info",
  "event": "request_completed",
  "request_id": "abc12345",
  "method": "POST",
  "path": "/entries",
  "status_code": 200,
  "duration_ms": 45.23
}
```

---

### 3.2 Metrics

**Current State:** No metrics collection.

#### Implementation Plan

**A. Metrics Library Selection**

| Option | Integration | Storage | Recommendation |
|--------|-------------|---------|----------------|
| **Prometheus** | FastAPI middleware | Time-series DB | **Recommended** |
| StatsD | Simple UDP | Graphite | Lightweight |
| OpenTelemetry | Universal | Multiple | Future-proof |

**B. Install Dependencies**
```bash
pip install prometheus-client>=0.19.0
pip install prometheus-fastapi-instrumentator>=6.1.0
```

**C. Metrics Setup** (`backend/utils/metrics.py`)
```python
from prometheus_client import Counter, Histogram, Gauge, Info
from prometheus_fastapi_instrumentator import Instrumentator

# Custom metrics
REQUEST_COUNT = Counter(
    'catatlas_requests_total',
    'Total request count',
    ['method', 'endpoint', 'status']
)

REQUEST_LATENCY = Histogram(
    'catatlas_request_latency_seconds',
    'Request latency in seconds',
    ['method', 'endpoint'],
    buckets=[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0]
)

ACTIVE_REQUESTS = Gauge(
    'catatlas_active_requests',
    'Number of active requests'
)

DB_QUERY_LATENCY = Histogram(
    'catatlas_db_query_seconds',
    'Database query latency',
    ['query_type'],
    buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25]
)

ENTRIES_TOTAL = Gauge(
    'catatlas_entries_total',
    'Total number of entries in database'
)

AI_ANALYSIS_DURATION = Histogram(
    'catatlas_ai_analysis_seconds',
    'AI analysis duration',
    buckets=[0.5, 1.0, 2.5, 5.0, 10.0, 30.0]
)

APP_INFO = Info(
    'catatlas_app',
    'Application information'
)

def setup_metrics(app, settings):
    """Initialize Prometheus metrics for FastAPI."""

    # Set application info
    APP_INFO.info({
        'version': '1.0.0',
        'environment': settings.environment,
    })

    # Auto-instrument FastAPI
    instrumentator = Instrumentator(
        should_group_status_codes=True,
        should_ignore_untemplated=True,
        should_respect_env_var=True,
        excluded_handlers=["/health", "/metrics"],
    )

    instrumentator.instrument(app).expose(app, endpoint="/metrics")
```

**D. Custom Metrics Usage**
```python
from utils.metrics import REQUEST_COUNT, DB_QUERY_LATENCY
import time

# In middleware or handlers
REQUEST_COUNT.labels(method='POST', endpoint='/entries', status='200').inc()

# Database timing
def execute_query(query_type: str, func):
    start = time.perf_counter()
    result = func()
    DB_QUERY_LATENCY.labels(query_type=query_type).observe(
        time.perf_counter() - start
    )
    return result
```

**E. Key Metrics to Track**

| Category | Metric | Type | Purpose |
|----------|--------|------|---------|
| **HTTP** | Request count | Counter | Traffic volume |
| **HTTP** | Request latency | Histogram | Performance |
| **HTTP** | Active requests | Gauge | Concurrency |
| **HTTP** | Error rate | Counter | Reliability |
| **Database** | Query latency | Histogram | DB performance |
| **Database** | Connection pool | Gauge | Resource usage |
| **Business** | Entries created | Counter | Usage tracking |
| **Business** | AI analyses | Counter | Feature usage |
| **System** | Memory usage | Gauge | Resource health |
| **System** | CPU usage | Gauge | Resource health |

---

### 3.3 Error Tracking

**Current State:** Sentry DSN configured but not initialized.

#### Implementation Plan

**A. Install Dependencies**
```bash
pip install sentry-sdk[fastapi]>=1.39.0
```

**B. Sentry Initialization** (`backend/utils/error_tracking.py`)
```python
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from typing import Optional

def setup_sentry(dsn: Optional[str], environment: str, release: str = "1.0.0"):
    """Initialize Sentry error tracking."""

    if not dsn:
        print("⚠️  Sentry DSN not configured, error tracking disabled")
        return

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,

        # Integrations
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            StarletteIntegration(transaction_style="endpoint"),
        ],

        # Performance monitoring
        traces_sample_rate=0.1 if environment == "production" else 1.0,
        profiles_sample_rate=0.1 if environment == "production" else 1.0,

        # Error filtering
        before_send=filter_sensitive_data,

        # Additional settings
        send_default_pii=False,  # Don't send user IP, etc.
        attach_stacktrace=True,
        max_breadcrumbs=50,
    )

    print(f"📡 Sentry initialized for {environment}")

def filter_sensitive_data(event, hint):
    """Filter sensitive data before sending to Sentry."""

    # Remove sensitive headers
    if 'request' in event and 'headers' in event['request']:
        headers = event['request']['headers']
        sensitive_headers = ['authorization', 'cookie', 'x-api-key']
        for header in sensitive_headers:
            if header in headers:
                headers[header] = '[FILTERED]'

    # Remove sensitive body fields
    if 'request' in event and 'data' in event['request']:
        data = event['request'].get('data', {})
        if isinstance(data, dict):
            sensitive_fields = ['password', 'token', 'secret', 'api_key']
            for field in sensitive_fields:
                if field in data:
                    data[field] = '[FILTERED]'

    return event
```

**C. Manual Error Capture**
```python
import sentry_sdk

# Capture exception with context
try:
    process_entry(entry)
except Exception as e:
    sentry_sdk.capture_exception(e)
    sentry_sdk.set_context("entry", {
        "id": entry.id,
        "text_length": len(entry.text),
    })
    raise

# Capture message
sentry_sdk.capture_message("AI analysis took too long", level="warning")

# Add breadcrumb for debugging
sentry_sdk.add_breadcrumb(
    category="database",
    message="Querying entries table",
    level="info",
)
```

**D. User Context**
```python
# Set user context (when auth is implemented)
sentry_sdk.set_user({
    "id": user.id,
    "email": user.email,  # Only if PII is enabled
})
```

**E. Performance Transactions**
```python
from sentry_sdk import start_transaction

with start_transaction(op="ai.analysis", name="Analyze Entry"):
    with sentry_sdk.start_span(op="db.query", description="Fetch entry"):
        entry = db.get_entry(entry_id)

    with sentry_sdk.start_span(op="ai.inference", description="Run AI model"):
        analysis = ai_model.analyze(entry.text)
```

---

## 4. CI/CD

### 4.1 Automated Deployments

**Current State:** Docker image builds to GHCR, manual deployment to Railway/Render.

#### Implementation Plan

**A. Deployment Architecture**

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   GitHub    │───▶│   Staging   │───▶│ Production  │
│   Actions   │    │  (Railway)  │    │  (Railway)  │
└─────────────┘    └─────────────┘    └─────────────┘
       │                  │                  │
       ▼                  ▼                  ▼
  Build & Test      Auto-deploy        Manual approve
                   on PR merge         + deploy
```

**B. Railway Deployment Workflow** (`.github/workflows/deploy.yml`)
```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy to'
        required: true
        default: 'staging'
        type: choice
        options:
          - staging
          - production

env:
  RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'

      - name: Install dependencies
        run: |
          cd backend
          pip install -r requirements.txt
          pip install pytest pytest-cov

      - name: Run tests with coverage
        run: |
          cd backend
          pytest --cov=. --cov-report=xml --cov-fail-under=60

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          file: backend/coverage.xml

  deploy-staging:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment:
      name: staging
      url: https://catatlas-staging.railway.app

    steps:
      - uses: actions/checkout@v4

      - name: Install Railway CLI
        run: npm install -g @railway/cli

      - name: Deploy to Staging
        run: |
          cd backend
          railway up --service catatlas-api --environment staging
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN_STAGING }}

      - name: Health Check
        run: |
          sleep 30
          curl -f https://catatlas-staging.railway.app/health || exit 1

      - name: Run Smoke Tests
        run: |
          cd backend
          python -m pytest tests/smoke/ --base-url=https://catatlas-staging.railway.app

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment:
      name: production
      url: https://catatlas.railway.app

    steps:
      - uses: actions/checkout@v4

      - name: Install Railway CLI
        run: npm install -g @railway/cli

      - name: Deploy to Production
        run: |
          cd backend
          railway up --service catatlas-api --environment production
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN_PRODUCTION }}

      - name: Health Check
        run: |
          sleep 30
          curl -f https://catatlas.railway.app/health || exit 1

      - name: Notify Deployment
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "🚀 CatAtlas deployed to production",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*CatAtlas* deployed to production\nCommit: ${{ github.sha }}\nBy: ${{ github.actor }}"
                  }
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

**C. Rollback Strategy**
```yaml
# .github/workflows/rollback.yml
name: Rollback

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to rollback'
        required: true
        type: choice
        options:
          - staging
          - production
      commit_sha:
        description: 'Commit SHA to rollback to'
        required: true

jobs:
  rollback:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}

    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.commit_sha }}

      - name: Deploy previous version
        run: |
          npm install -g @railway/cli
          cd backend
          railway up --service catatlas-api --environment ${{ inputs.environment }}
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}

      - name: Verify rollback
        run: |
          sleep 30
          URL=${{ inputs.environment == 'production' && 'https://catatlas.railway.app' || 'https://catatlas-staging.railway.app' }}
          curl -f $URL/health
```

---

### 4.2 Staging Environment

#### Implementation Plan

**A. Environment Configuration**

| Setting | Staging | Production |
|---------|---------|------------|
| `ENVIRONMENT` | staging | production |
| `DEBUG` | true | false |
| `DATABASE_URL` | Railway Postgres | Railway Postgres |
| `LOG_LEVEL` | DEBUG | INFO |
| `SENTRY_DSN` | staging-dsn | production-dsn |
| `RATE_LIMIT_PER_MINUTE` | 200 | 100 |
| `JWT_SECRET` | staging-secret | production-secret |

**B. Railway Project Structure**
```
Railway Project: CatAtlas
├── Environments
│   ├── staging
│   │   ├── catatlas-api (backend service)
│   │   └── postgres (database)
│   └── production
│       ├── catatlas-api (backend service)
│       └── postgres (database)
```

**C. Environment-Specific Configs** (`backend/config/`)
```python
# config/staging.py
from config import Settings

class StagingSettings(Settings):
    environment: str = "staging"
    debug: bool = True
    log_level: str = "DEBUG"
    rate_limit_per_minute: int = 200

# config/production.py
from config import Settings

class ProductionSettings(Settings):
    environment: str = "production"
    debug: bool = False
    log_level: str = "INFO"
    rate_limit_per_minute: int = 100
```

**D. Database Migration Strategy**

```yaml
# .github/workflows/migrate.yml
name: Database Migration

on:
  workflow_dispatch:
    inputs:
      environment:
        required: true
        type: choice
        options: [staging, production]
      migration:
        description: 'Migration to run (e.g., 001_add_users)'
        required: true

jobs:
  migrate:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}

    steps:
      - uses: actions/checkout@v4

      - name: Run migration
        run: |
          cd backend
          python -m migrations.${{ inputs.migration }}
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**E. Feature Flags for Staged Rollouts**
```python
# backend/utils/feature_flags.py
from typing import Dict
import os

FEATURE_FLAGS: Dict[str, Dict[str, bool]] = {
    "ai_analysis": {
        "staging": True,
        "production": True,
    },
    "new_cat_profiles": {
        "staging": True,
        "production": False,  # Gradual rollout
    },
}

def is_feature_enabled(feature: str) -> bool:
    env = os.getenv("ENVIRONMENT", "development")
    return FEATURE_FLAGS.get(feature, {}).get(env, False)
```

---

## 5. Implementation Priority

### Phase 1: Critical Security (Week 1-2)
| Item | Priority | Effort | Impact |
|------|----------|--------|--------|
| Rate limiting middleware | P0 | Medium | High |
| Security headers | P0 | Low | High |
| Sentry initialization | P0 | Low | High |
| Request logging | P0 | Medium | High |

### Phase 2: Observability (Week 3-4)
| Item | Priority | Effort | Impact |
|------|----------|--------|--------|
| Structured logging | P1 | Medium | High |
| Prometheus metrics | P1 | Medium | Medium |
| Health check expansion | P1 | Low | Medium |

### Phase 3: Testing (Week 5-6)
| Item | Priority | Effort | Impact |
|------|----------|--------|--------|
| E2E test setup (Playwright) | P1 | High | High |
| Load testing (Locust) | P2 | Medium | Medium |
| Frontend unit tests | P2 | High | Medium |

### Phase 4: CI/CD (Week 7-8)
| Item | Priority | Effort | Impact |
|------|----------|--------|--------|
| Staging environment | P1 | Medium | High |
| Automated staging deploy | P1 | Medium | High |
| Production deploy approval | P2 | Low | Medium |
| Rollback workflow | P2 | Low | High |

---

## 6. Estimated Effort

| Category | Items | Total Effort |
|----------|-------|--------------|
| Security Hardening | 3 | 3-4 days |
| Monitoring Setup | 3 | 4-5 days |
| Testing Infrastructure | 2 | 5-7 days |
| CI/CD Pipeline | 4 | 4-5 days |
| **Total** | **12** | **16-21 days** |

### Dependencies Graph

```
┌────────────────┐
│ Security       │
│ Headers        │───┐
└────────────────┘   │
                     ▼
┌────────────────┐  ┌────────────────┐
│ Rate Limiting  │──│ Staging Env    │
└────────────────┘  └────────────────┘
        │                   │
        ▼                   ▼
┌────────────────┐  ┌────────────────┐
│ Logging        │──│ Auto Deploy    │
└────────────────┘  └────────────────┘
        │                   │
        ▼                   ▼
┌────────────────┐  ┌────────────────┐
│ Sentry         │  │ E2E Tests      │
└────────────────┘  └────────────────┘
        │                   │
        ▼                   ▼
┌────────────────┐  ┌────────────────┐
│ Metrics        │  │ Load Tests     │
└────────────────┘  └────────────────┘
```

---

## Next Steps

1. **Review this plan** with the team
2. **Create GitHub issues** for each item
3. **Set up staging environment** on Railway
4. **Begin Phase 1** implementation

---

*Document created: January 2026*
*Last updated: January 2026*
