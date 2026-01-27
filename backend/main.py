"""
main.py — CatAtlas / Learning Log backend (FastAPI + PostgreSQL/SQLite)

Version: 1.0.2 (2026-01-26 - Bunny.net default region fix)
=======


This file includes:
- SQLite persistence for sightings (entries)
- Optional fields: nickname, location
- "AI-like" baseline analysis (summary, tags, sentiment/temperament)
- Analysis caching + persistence in SQLite (Week 6 pattern)
- Endpoints:
    GET  /entries
    POST /entries
    POST /entries/{entry_id}/favorite
    GET  /entries/{entry_id}/analysis
    POST /entries/{entry_id}/analyze
    GET  /health   (optional, but helpful)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import random
import re
import sqlite3
import os
import time
from dataclasses import dataclass, field
from enum import Enum
from math import radians, cos, sin, asin, sqrt
from pathlib import Path
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional, Literal, Union, TypeVar, Callable, Awaitable
from fastapi import FastAPI, HTTPException, File, UploadFile, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from config import settings
from image_upload import upload_to_bunny, delete_from_bunny, validate_bunny_config

# Async HTTP client for geocoding
try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False

# Logger for geocoding operations
logger = logging.getLogger(__name__)

# PostgreSQL support
try:
    import psycopg2
    import psycopg2.extras
    POSTGRES_AVAILABLE = True
except ImportError:
    POSTGRES_AVAILABLE = False


# -----------------------------------------------------------------------------
# App setup
# -----------------------------------------------------------------------------

app = FastAPI(title="CatAtlas API")

# CORS: allows your frontend (different port/domain) to call this backend.
# Configured via ALLOWED_ORIGINS environment variable for security.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,  # Configured from environment
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """Log configuration on startup (sanitized, no secrets)."""
    print(f"🚀 Starting {settings.app_name} v{settings.app_version}")
    print(f"📊 Debug mode: {settings.debug}")
    if settings.is_postgres:
        print(f"🗄️  Database: PostgreSQL (production)")
    else:
        print(f"🗄️  Database: SQLite at {DB_PATH}")
    print(f"🔒 CORS allowed origins: {settings.allowed_origins_list}")
    print(f"⏱️  Rate limit: {settings.rate_limit_per_minute}/min")
    if settings.sentry_dsn:
        print(f"📡 Sentry monitoring: enabled")
    print(f"🔐 JWT algorithm: {settings.jwt_algorithm}")
    print(f"⏰ Access token expiry: {settings.access_token_expire_minutes} minutes")

    # Check Bunny.net configuration
    try:
        validate_bunny_config()
        region_info = settings.bunny_storage_region if settings.bunny_storage_region else "default (Falkenstein)"
        print(f"☁️  Bunny.net: configured ({region_info} region)")
        print(f"    Storage endpoint: {settings.bunny_storage_url}")
    except RuntimeError:
        print(f"⚠️  Bunny.net: not configured (image uploads disabled)")


@app.get("/health")
def health():
    """
    Health check endpoint for monitoring + CI smoke tests.
    Keep it extremely fast and dependency-light.
    """
    return {"status": "ok"}


# -----------------------------------------------------------------------------
# Database configuration (SQLite or PostgreSQL)
# -----------------------------------------------------------------------------

# Allow tests to point the app to a temporary DB file
# Backward compatible: CATATLAS_DB_PATH overrides settings.database_path
DB_PATH = Path(os.getenv("CATATLAS_DB_PATH", settings.database_path))



def get_conn() -> Union[sqlite3.Connection, 'psycopg2.extensions.connection']:
    """
    Open a database connection (SQLite or PostgreSQL).

    Returns SQLite connection for local dev/testing,
    or PostgreSQL connection for production.
    """
    if settings.is_postgres:
        if not POSTGRES_AVAILABLE:
            raise RuntimeError("PostgreSQL driver (psycopg2) not installed")
        conn = psycopg2.connect(settings.database_url)
        # Use RealDictCursor for dict-like access (similar to sqlite3.Row)
        return conn
    else:
        # SQLite for local development and tests
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn


def _try_alter_table(cur, sql: str) -> None:
    """
    Attempt ALTER TABLE and ignore errors if column already exists.
    Works for both SQLite and PostgreSQL.
    """
    try:
        execute_query(cur, sql)
    except (sqlite3.OperationalError, Exception):
        # Column already exists or other error - ignore for idempotency
        pass


def get_cursor(conn):
    """Get a cursor with appropriate factory for the database type."""
    if settings.is_postgres:
        return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    else:
        return conn.cursor()


def row_get(row, key):
    """
    Get a value from a database row, handling PostgreSQL lowercase column names.

    PostgreSQL lowercases unquoted column names, so 'createdAt' becomes 'createdat'.
    This helper tries both the original key and lowercase version.
    """
    # Try exact key first (works for SQLite and quoted PostgreSQL columns)
    try:
        return row[key]
    except KeyError:
        pass

    # Try lowercase for PostgreSQL unquoted columns
    lower_key = key.lower()
    try:
        return row[lower_key]
    except KeyError:
        pass

    # If neither works, raise with original key for clearer error message
    raise KeyError(key)


def get_last_insert_id(cur, conn) -> int:
    """Get the last inserted row ID in a database-agnostic way."""
    if settings.is_postgres:
        # PostgreSQL: need to use RETURNING or currval
        # This assumes the cursor just executed an INSERT with RETURNING
        result = cur.fetchone()
        return result['id'] if result else None
    else:
        # SQLite
        return cur.lastrowid


def sql_placeholder() -> str:
    """Return the correct SQL placeholder for the current database."""
    return "%s" if settings.is_postgres else "?"


def execute_query(cur, sql: str, params: tuple = ()):
    """
    Execute a SQL query with automatic placeholder conversion.

    Converts ? to %s for PostgreSQL automatically.
    This allows us to write queries with ? and have them work on both databases.
    """
    if settings.is_postgres and '?' in sql:
        # Replace ? with %s for PostgreSQL
        sql = sql.replace('?', '%s')

    cur.execute(sql, params)
    return cur


def init_db() -> None:
    """
    Create required tables if they don't exist.
    Also performs a minimal "migration" step for older DB files
    (adds new columns if missing).

    Works with both SQLite (local) and PostgreSQL (production).
    """
    conn = get_conn()
    is_postgres = settings.is_postgres

    # For PostgreSQL, we need RealDictCursor for dict-like access
    if is_postgres:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    else:
        cur = conn.cursor()

    # Choose SQL syntax based on database type
    # SQLite uses: INTEGER PRIMARY KEY AUTOINCREMENT
    # PostgreSQL uses: SERIAL PRIMARY KEY
    id_type = "SERIAL PRIMARY KEY" if is_postgres else "INTEGER PRIMARY KEY AUTOINCREMENT"
    int_type = "INT" if is_postgres else "INTEGER"

    # --- Cats table (create first - no dependencies) ---
    execute_query(cur,
        f"""
        CREATE TABLE IF NOT EXISTS cats (
            id {id_type},
            name TEXT,
            createdAt TEXT NOT NULL
        )
        """
    )

    # --- Entries table (sightings) - depends on cats ---
    execute_query(cur,
        f"""
        CREATE TABLE IF NOT EXISTS entries (
            id {id_type},
            text TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            isFavorite {int_type} NOT NULL DEFAULT 0,
            nickname TEXT,
            location TEXT,
            cat_id {int_type},
            photo_url TEXT,
            location_normalized TEXT,
            location_lat REAL,
            location_lon REAL,
            location_osm_id TEXT,
            FOREIGN KEY(cat_id) REFERENCES cats(id) ON DELETE SET NULL
        )
        """
    )

    # For SQLite, add columns if they don't exist (for backward compatibility)
    # PostgreSQL: columns already in CREATE TABLE above
    if not is_postgres:
        _try_alter_table(cur, "ALTER TABLE entries ADD COLUMN nickname TEXT")
        _try_alter_table(cur, "ALTER TABLE entries ADD COLUMN location TEXT")
        _try_alter_table(cur, "ALTER TABLE entries ADD COLUMN cat_id INTEGER")
        _try_alter_table(cur, "ALTER TABLE entries ADD COLUMN photo_url TEXT")

    # Location normalization columns (Phase 1 - OpenStreetMap integration)
    _try_alter_table(cur, "ALTER TABLE entries ADD COLUMN location_normalized TEXT")
    _try_alter_table(cur, "ALTER TABLE entries ADD COLUMN location_lat REAL")
    _try_alter_table(cur, "ALTER TABLE entries ADD COLUMN location_lon REAL")
    _try_alter_table(cur, "ALTER TABLE entries ADD COLUMN location_osm_id TEXT")

    # --- Analyses table - depends on entries ---
    execute_query(cur,
        f"""
        CREATE TABLE IF NOT EXISTS analyses (
            entry_id {int_type} PRIMARY KEY,
            text_hash TEXT NOT NULL,
            summary TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            sentiment TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL,
            FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE
        )
        """
    )

    # --- Cat insights table - depends on cats ---
    execute_query(cur,
        f"""
        CREATE TABLE IF NOT EXISTS cat_insights (
            id {id_type},
            cat_id {int_type} NOT NULL,
            mode TEXT NOT NULL,
            prompt_version TEXT NOT NULL,
            context_hash TEXT NOT NULL,
            insight_json TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL,
            UNIQUE(cat_id, mode, prompt_version, context_hash),
            FOREIGN KEY(cat_id) REFERENCES cats(id) ON DELETE CASCADE
        )
        """
    )

    conn.commit()
    conn.close()


@app.on_event("startup")
def on_startup() -> None:
    """FastAPI lifecycle hook: initialize DB when the server starts."""
    init_db()





# -----------------------------------------------------------------------------
# Pydantic models (API contract)
# -----------------------------------------------------------------------------

class EntryCreate(BaseModel):
    """
    Client payload to create a new sighting/entry.
    Notes (text) is required. nickname/location are optional.
    """
    text: str = Field(..., min_length=1, max_length=5000)
    nickname: Optional[str] = Field(None, max_length=100)
    location: Optional[str] = Field(None, max_length=200)
    photo_url: Optional[str] = Field(None, max_length=1000)

class CatProfile(BaseModel):
    cat_id: int
    name: Optional[str] = None
    sightings_count: int
    locations: List[str]
    top_tags: List[str]
    temperament_guess: str
    profile_text: str


class Entry(BaseModel):
    """
    What the API returns for a stored sighting/entry.
    """
    id: int
    text: str
    createdAt: str
    isFavorite: bool
    nickname: Optional[str] = None
    location: Optional[str] = None
    cat_id: Optional[int] = None
    photo_url: Optional[str] = None
    # Location normalization fields (OpenStreetMap)
    location_normalized: Optional[str] = None
    location_lat: Optional[float] = None
    location_lon: Optional[float] = None
    location_osm_id: Optional[str] = None

class EntryAnalysis(BaseModel):
    """
    Stored analysis result (cached and persisted).
    """
    entry_id: int
    summary: str
    tags: List[str]
    sentiment: str  # later you may rename to temperament
    updatedAt: str

class CatCreate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)

class Cat(BaseModel):
    id: int
    name: Optional[str] = None
    createdAt: str


class MatchCandidate(BaseModel):
    """
    One suggested match candidate for an entry.
    score: 0.0 .. 1.0 (higher = more similar)
    reasons: short explanation strings for transparency/debugging
    """
    entry_id: int
    candidate_id: int
    score: float
    reasons: List[str]

    # Helpful fields to show in UI without extra calls
    candidate_nickname: Optional[str] = None
    candidate_location: Optional[str] = None
    candidate_text: str
    candidate_createdAt: str


class CatInsightRequest(BaseModel):
    """
    mode controls what we generate.
    question is optional and lets the UI ask specific things later.
    """
    mode: Literal["profile", "care", "update", "risk"]
    question: Optional[str] = Field(None, max_length=500)


class Citation(BaseModel):
    """
    A reference to a sighting used as evidence.
    """
    entry_id: int
    quote: str  # short excerpt from notes
    location: Optional[str] = None
    createdAt: str


class CatInsightResponse(BaseModel):
    cat_id: int
    mode: str
    prompt_version: str
    confidence: float  # 0..1
    headline: str
    summary: str
    flags: List[str]           # risk / health / behavior warnings
    suggested_actions: List[str]
    citations: List[Citation]
    generatedAt: str


class LocationNormalizationResult(BaseModel):
    """Result of normalizing a location via OpenStreetMap Nominatim."""
    entry_id: int
    original_location: str
    normalized_location: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    osm_id: Optional[str] = None
    status: str  # "success", "not_found", "already_normalized", "no_location", "error"
    message: Optional[str] = None


class NearbySighting(BaseModel):
    """A sighting found near another sighting."""
    entry_id: int
    distance_meters: float
    location: Optional[str] = None
    location_normalized: Optional[str] = None
    text_preview: str
    cat_id: Optional[int] = None
    cat_name: Optional[str] = None
    created_at: str
    match_score: float
    reasons: List[str]


class GeocodingHealthResponse(BaseModel):
    """Health check for geocoding service."""
    service: str
    circuit_state: str
    failure_count: int
    last_failure: Optional[str] = None
    status: str  # "healthy", "degraded", "unavailable"


# -----------------------------------------------------------------------------
# Phase 3: Validation Workflow Models
# -----------------------------------------------------------------------------

class LinkSightingsRequest(BaseModel):
    """Request to bulk link sightings to an existing cat."""
    entry_ids: List[int] = Field(..., min_length=1, description="List of entry IDs to link")


class LinkSightingsResponse(BaseModel):
    """Response from bulk linking sightings to a cat."""
    cat_id: int
    linked_count: int
    already_linked: List[int]
    newly_linked: List[int]
    failed: List[int]


class CreateCatFromSightingsRequest(BaseModel):
    """Request to create a new cat from matched sightings."""
    entry_ids: List[int] = Field(..., min_length=1, description="List of entry IDs to link to new cat")
    name: Optional[str] = Field(None, max_length=100, description="Optional name for the new cat")


# -----------------------------------------------------------------------------
# Resilience Patterns for Geocoding (Circuit Breaker, Retry, Fallback)
# -----------------------------------------------------------------------------

class CircuitState(Enum):
    """Circuit breaker states."""
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing if service recovered


@dataclass
class CircuitBreaker:
    """
    Circuit breaker pattern to prevent cascading failures.

    States:
    - CLOSED: Normal operation, requests flow through
    - OPEN: Service is down, requests fail fast
    - HALF_OPEN: Testing if service recovered
    """
    failure_threshold: int = 5
    recovery_timeout: float = 60.0
    half_open_max_calls: int = 3

    _failure_count: int = field(default=0, repr=False)
    _last_failure_time: Optional[datetime] = field(default=None, repr=False)
    _state: CircuitState = field(default=CircuitState.CLOSED, repr=False)
    _half_open_calls: int = field(default=0, repr=False)

    def can_execute(self) -> bool:
        """Check if a request should be allowed through."""
        if self._state == CircuitState.CLOSED:
            return True
        if self._state == CircuitState.OPEN:
            if self._last_failure_time and \
               datetime.now() - self._last_failure_time > timedelta(seconds=self.recovery_timeout):
                self._state = CircuitState.HALF_OPEN
                self._half_open_calls = 0
                return True
            return False
        if self._state == CircuitState.HALF_OPEN:
            return self._half_open_calls < self.half_open_max_calls
        return False

    def record_success(self):
        """Record a successful call."""
        if self._state == CircuitState.HALF_OPEN:
            self._half_open_calls += 1
            if self._half_open_calls >= self.half_open_max_calls:
                self._state = CircuitState.CLOSED
                self._failure_count = 0
        else:
            self._failure_count = 0

    def record_failure(self):
        """Record a failed call."""
        self._failure_count += 1
        self._last_failure_time = datetime.now()
        if self._failure_count >= self.failure_threshold:
            self._state = CircuitState.OPEN

    def get_state(self) -> str:
        """Get the current state as a string."""
        return self._state.value


# Global circuit breaker for Nominatim API
nominatim_circuit = CircuitBreaker()

# Rate limiting for Nominatim (1 request per second)
_last_nominatim_call: float = 0.0

# Type variable for retry function
T = TypeVar('T')


async def retry_with_backoff(
    func: Callable[[], Awaitable[T]],
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    exponential_base: float = 2.0,
    jitter: bool = True,
) -> T:
    """
    Retry an async function with exponential backoff.

    Args:
        func: Async function to retry
        max_retries: Maximum number of retry attempts
        base_delay: Initial delay in seconds
        max_delay: Maximum delay cap in seconds
        exponential_base: Base for exponential calculation
        jitter: Add randomness to prevent thundering herd
    """
    last_exception = None

    for attempt in range(max_retries + 1):
        try:
            return await func()
        except Exception as e:
            last_exception = e

            if attempt == max_retries:
                break

            # Calculate delay with exponential backoff
            delay = min(base_delay * (exponential_base ** attempt), max_delay)

            # Add jitter (±25%)
            if jitter:
                delay = delay * (0.75 + random.random() * 0.5)

            await asyncio.sleep(delay)

    raise last_exception


# -----------------------------------------------------------------------------
# Geographic Distance Calculation (Haversine Formula)
# -----------------------------------------------------------------------------

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great-circle distance between two points in meters.

    Uses the Haversine formula for accurate distance on a sphere.

    Args:
        lat1, lon1: Coordinates of first point (degrees)
        lat2, lon2: Coordinates of second point (degrees)

    Returns:
        Distance in meters
    """
    R = 6371000  # Earth's radius in meters

    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a))

    return R * c


# -----------------------------------------------------------------------------
# OpenStreetMap Nominatim Geocoding
# -----------------------------------------------------------------------------

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_USER_AGENT = "CatAtlas/1.0 (cat-sighting-tracker)"


async def geocode_location(location: str) -> Optional[dict]:
    """
    Geocode a location string using OpenStreetMap Nominatim.

    Args:
        location: Free-text location string

    Returns:
        Dict with display_name, lat, lon, osm_id or None if not found
    """
    global _last_nominatim_call

    if not HTTPX_AVAILABLE:
        logger.warning("httpx not available, geocoding disabled")
        return None

    # Respect rate limit (1 request per second)
    elapsed = time.time() - _last_nominatim_call
    if elapsed < 1.0:
        await asyncio.sleep(1.0 - elapsed)

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                NOMINATIM_URL,
                params={
                    "q": location,
                    "format": "json",
                    "limit": 1,
                    "addressdetails": 1,
                },
                headers={"User-Agent": NOMINATIM_USER_AGENT},
                timeout=10.0,
            )
            _last_nominatim_call = time.time()

            if response.status_code == 200:
                results = response.json()
                if results:
                    return results[0]
    except Exception as e:
        logger.warning(f"Geocoding error for '{location}': {e}")

    return None


async def geocode_with_fallback(location: str) -> dict:
    """
    Geocode with circuit breaker, retry, and fallback strategies.

    Fallback order:
    1. OpenStreetMap Nominatim (primary)
    2. Cached results from similar locations in database
    3. Text-only result (no coordinates)
    """
    # Check circuit breaker
    if not nominatim_circuit.can_execute():
        logger.info(f"Circuit breaker open, using fallback for '{location}'")
        return _fallback_to_text(location)

    try:
        result = await retry_with_backoff(
            lambda: geocode_location(location),
            max_retries=2,
            base_delay=1.0,
        )
        if result:
            nominatim_circuit.record_success()
            return {
                "display_name": result.get("display_name"),
                "lat": result.get("lat"),
                "lon": result.get("lon"),
                "osm_id": str(result.get("osm_id", "")),
                "fallback": None,
            }
        else:
            # Location not found, but API worked
            nominatim_circuit.record_success()
            return _fallback_to_text(location, status="not_found")
    except Exception as e:
        nominatim_circuit.record_failure()
        logger.warning(f"Geocoding failed for '{location}': {e}")
        return _fallback_to_text(location, status="error")


def _fallback_to_text(location: str, status: str = "fallback") -> dict:
    """Return text-only result when geocoding fails."""
    return {
        "display_name": location,
        "lat": None,
        "lon": None,
        "osm_id": None,
        "fallback": status,
    }


def find_similar_cached_location(conn, location: str) -> Optional[dict]:
    """
    Find a similar location that has already been geocoded.

    Uses simple token matching to find locations with similar text.
    """
    cur = get_cursor(conn)
    execute_query(cur,
        """
        SELECT location, location_normalized, location_lat, location_lon, location_osm_id
        FROM entries
        WHERE location_normalized IS NOT NULL
          AND location_lat IS NOT NULL
        LIMIT 100
        """,
    )
    rows = cur.fetchall()

    # Tokenize the search location
    search_tokens = set(location.lower().split())

    best_match = None
    best_score = 0.0

    for row in rows:
        stored_location = row["location"] or ""
        stored_tokens = set(stored_location.lower().split())

        if not stored_tokens:
            continue

        # Calculate Jaccard similarity
        intersection = len(search_tokens & stored_tokens)
        union = len(search_tokens | stored_tokens)
        if union > 0:
            score = intersection / union
            if score > best_score and score > 0.5:  # Threshold of 50% match
                best_score = score
                best_match = {
                    "location_normalized": row["location_normalized"],
                    "location_lat": row["location_lat"],
                    "location_lon": row["location_lon"],
                    "location_osm_id": row["location_osm_id"],
                }

    return best_match


# -----------------------------------------------------------------------------
# Baseline "AI-like" analysis helpers (Week 5)
# -----------------------------------------------------------------------------

# Very small stopword list to keep tags meaningful
STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "if", "then", "so", "to", "of", "in", "on", "for", "with",
    "is", "are", "was", "were", "be", "been", "it", "this", "that", "i", "you", "we", "they", "my",
    "at", "as", "by", "from", "into", "about", "over", "after", "before", "again"
}

# Simple sentiment word lists (not "real" NLP, but useful for learning the pipeline)
POS_WORDS = {"good", "great", "nice", "love", "fun", "happy", "win", "success", "worked", "improved"}
NEG_WORDS = {"bad", "hard", "confusing", "stuck", "fail", "error", "issue", "frustrating", "broken"}


def baseline_summary(text: str, max_len: int = 160) -> str:
    """
    Baseline summarizer:
    - normalize whitespace
    - truncate to max_len with ellipsis

    Later you can replace this with an LLM call *without changing the API contract*.
    """
    cleaned = " ".join(text.strip().split())
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "…"


def baseline_tags(text: str, k: int = 5) -> list[str]:
    """
    Baseline tagger:
    - extract word-like tokens
    - remove stopwords
    - return most frequent tokens
    """
    tokens = re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", text.lower())
    tokens = [t for t in tokens if t not in STOPWORDS]
    counts = Counter(tokens)
    return [w for w, _ in counts.most_common(k)]


def normalize_text(s: Optional[str]) -> str:
    """Lowercase + collapse whitespace for consistent comparisons."""
    if not s:
        return ""
    return " ".join(s.strip().lower().split())


def tokenize_keywords(text: str) -> set[str]:
    """
    Extract keywords from text.
    - Only keep words with length >= 3
    - Remove stopwords (reuse STOPWORDS)
    This is intentionally simple and explainable.
    """
    tokens = re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", normalize_text(text))
    return {t for t in tokens if t not in STOPWORDS}


def jaccard_similarity(a: set[str], b: set[str]) -> float:
    """
    Jaccard similarity = |A ∩ B| / |A ∪ B|.
    Returns 0.0 if both empty.
    """
    if not a and not b:
        return 0.0
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


def location_similarity(loc_a: str, loc_b: str) -> float:
    """
    Very naive location similarity.
    - tokenizes location words
    - uses Jaccard similarity
    Because locations are free text right now.
    """
    a = tokenize_keywords(loc_a)
    b = tokenize_keywords(loc_b)
    return jaccard_similarity(a, b)


def compute_match_score(
    base_text: str,
    base_location: str,
    cand_text: str,
    cand_location: str,
    base_lat: Optional[float] = None,
    base_lon: Optional[float] = None,
    cand_lat: Optional[float] = None,
    cand_lon: Optional[float] = None,
) -> tuple[float, list[str]]:
    """
    Combine text similarity + location similarity into one score.

    Enhanced scoring with geographic distance when coordinates available:
    - 50% text similarity
    - 50% location score (geographic distance if coords available, else text-based)

    Falls back to text-only matching (70/30 split) when no coordinates.

    We also return "reasons" for transparency in UI.
    """
    reasons: list[str] = []

    # Text similarity
    base_kw = tokenize_keywords(base_text)
    cand_kw = tokenize_keywords(cand_text)
    text_sim = jaccard_similarity(base_kw, cand_kw)

    if text_sim > 0:
        reasons.append(f"text similarity {text_sim:.2f}")

    # Location score - prefer geographic distance when coordinates available
    loc_score = 0.0
    has_coords = (base_lat is not None and base_lon is not None and
                  cand_lat is not None and cand_lon is not None)

    if has_coords:
        # Use geographic distance
        distance = haversine_distance(base_lat, base_lon, cand_lat, cand_lon)

        # Convert distance to similarity score (closer = higher)
        # 0m = 1.0, 100m = 0.9, 500m = 0.5, 1000m+ = 0.0
        if distance < 1000:
            loc_score = max(0.0, 1.0 - (distance / 1000))
            reasons.append(f"distance {distance:.0f}m (score {loc_score:.2f})")
        else:
            reasons.append(f"distance {distance:.0f}m (too far)")

        # Use 50/50 weighting when we have coordinates
        score = 0.5 * text_sim + 0.5 * loc_score
    else:
        # Fallback to text-based location similarity
        if base_location and cand_location:
            loc_score = location_similarity(base_location, cand_location)
            if loc_score > 0:
                reasons.append(f"location text similarity {loc_score:.2f}")

        # Use original 70/30 weighting for text-only matching
        score = 0.7 * text_sim + 0.3 * loc_score

    # If no reasons, still make it explicit
    if not reasons:
        reasons.append("low similarity")

    return score, reasons


def baseline_sentiment(text: str) -> str:
    """
    Baseline sentiment classifier (very naive):
    - count overlap with positive/negative sets
    """
    tokens = set(re.findall(r"[a-zA-Z']+", text.lower()))
    pos = len(tokens & POS_WORDS)
    neg = len(tokens & NEG_WORDS)
    if pos > neg:
        return "positive"
    if neg > pos:
        return "negative"
    return "neutral"


# -----------------------------------------------------------------------------
# Analysis persistence helpers (Week 6)
# -----------------------------------------------------------------------------

def text_to_hash(text: str) -> str:
    """
    Create a stable hash of the entry text.
    If the text changes, the hash changes => we know cached analysis is stale.
    """
    normalized = " ".join(text.strip().split()).encode("utf-8")
    return hashlib.sha256(normalized).hexdigest()


def tags_to_json(tags: list[str]) -> str:
    """Store tags as JSON string in SQLite."""
    return json.dumps(tags)


def tags_from_json(tags_json: str) -> list[str]:
    """Parse tags list from JSON string stored in SQLite."""
    try:
        return json.loads(tags_json)
    except Exception:
        return []


PROMPT_VERSION = "v1"

def make_context_hash(parts: list[str]) -> str:
    """
    Hash the exact context we feed into generation.
    If context changes (new sightings or edits), hash changes -> cache invalidates.
    """
    joined = "\n---\n".join(parts).encode("utf-8")
    return hashlib.sha256(joined).hexdigest()


def retrieve_cat_sightings(cur: sqlite3.Cursor, cat_id: int, limit: int = 10) -> list[sqlite3.Row]:
    """
    Retrieve sightings for a cat (newest first).
    Keep it simple: we’ll use the newest + keyword relevance if question exists later.
    """
    execute_query(cur, 
        """
        SELECT id, text, location, createdAt
        FROM entries
        WHERE cat_id = ?
        ORDER BY id DESC
        LIMIT ?
        """,
        (cat_id, limit),
    )
    return cur.fetchall()


def excerpt(text: str, max_len: int = 120) -> str:
    cleaned = " ".join(text.strip().split())
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "…"

def generate_cat_insight_stub(
    cat_id: int,
    mode: str,
    sightings: list[sqlite3.Row],
    question: Optional[str],
) -> CatInsightResponse:
    """
    GenAI stub: returns structured, human-like insight using templates + heuristics.
    This keeps the architecture GenAI-ready without needing an external API yet.
    """
    now = datetime.utcnow().isoformat() + "Z"

    notes_blob = "\n".join([s["text"] for s in sightings if s["text"]])
    tags = baseline_tags(notes_blob, k=8)
    sentiment = baseline_sentiment(notes_blob)

    # Map sentiment -> temperament wording (domain framing)
    temperament = (
        "friendly" if sentiment == "positive"
        else "defensive / cautious" if sentiment == "negative"
        else "unknown / neutral"
    )

    # Simple flags based on keywords (extend over time)
    flags: list[str] = []
    lower = (notes_blob or "").lower()
    for kw, flag in [
        ("limp", "possible injury (limping mentioned)"),
        ("blood", "possible injury (blood mentioned)"),
        ("wound", "possible injury (wound mentioned)"),
        ("thin", "possible malnutrition (thin mentioned)"),
        ("cough", "possible respiratory issue (cough mentioned)"),
        ("sneeze", "possible respiratory issue (sneezing mentioned)"),
        ("aggressive", "behavior risk (aggressive mentioned)"),
        ("hiss", "behavior risk (hissing mentioned)"),
    ]:
        if kw in lower:
            flags.append(flag)

    # Suggested actions based on mode
    actions: list[str] = []
    if mode == "care":
        actions = [
            "Approach slowly and keep distance; let the cat initiate contact.",
            "Avoid cornering; use calm voice and minimal movement.",
            "If you suspect injury/illness, document symptoms and contact a local rescue/TNR group.",
            "Leave food/water only if safe and allowed in the area.",
        ]
    elif mode == "risk":
        actions = [
            "Treat this as a suggestion, not a diagnosis.",
            "If repeated sightings show injury/illness, escalate to experienced volunteers.",
            "Capture clear notes and (if possible) a photo for better assessment.",
        ]
    elif mode == "update":
        actions = [
            "Post a short update with location guidance (without encouraging unsafe interactions).",
            "Ask the community for additional sightings at similar times/places.",
        ]
    else:  # "profile" default
        actions = [
            "Collect consistent notes about coat pattern, tail, ear marks, and behavior.",
            "Try to observe at similar times to learn routine.",
        ]

    # Headline and summary tuned by mode
    headline = f"Cat #{cat_id} — {temperament}"
    summary = (
        f"Based on {len(sightings)} sighting(s), this cat is currently described as '{temperament}'. "
        f"Common tags from notes: {', '.join(tags) if tags else 'none yet'}. "
    )

    if question:
        summary += f"Question noted: “{question}”. "

    # Confidence is deliberately conservative
    confidence = min(0.85, 0.35 + 0.08 * len(sightings))
    if len(sightings) < 2:
        confidence = 0.4

    citations: list[Citation] = []
    for s in sightings[:5]:
        citations.append(
            Citation(
                entry_id=s["id"],
                quote=excerpt(s["text"]),
                location=s["location"],
                createdAt=row_get(s, "createdAt"),
            )
        )

    return CatInsightResponse(
        cat_id=cat_id,
        mode=mode,
        prompt_version=PROMPT_VERSION,
        confidence=round(confidence, 2),
        headline=headline,
        summary=summary.strip(),
        flags=flags[:8],
        suggested_actions=actions[:8],
        citations=citations,
        generatedAt=now,
    )

# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------


@app.post("/cats/{cat_id}/insights", response_model=CatInsightResponse)
def cat_insights(cat_id: int, payload: CatInsightRequest):
    """
    Generate or return cached GenAI insights for a cat.

    Cache key:
    - cat_id
    - mode
    - prompt_version
    - context_hash (derived from sightings text + location + createdAt)
    """
    mode = (payload.mode or "").strip().lower()
    if mode not in {"profile", "care", "update", "risk"}:
        raise HTTPException(status_code=400, detail="mode must be one of: profile, care, update, risk")

    conn = get_conn()
    cur = get_cursor(conn)

    # Ensure cat exists
    execute_query(cur, "SELECT id FROM cats WHERE id = ?", (cat_id,))
    if cur.fetchone() is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Cat not found")

    sightings = retrieve_cat_sightings(cur, cat_id=cat_id, limit=10)

    if len(sightings) == 0:
        conn.close()
        raise HTTPException(status_code=400, detail="No sightings assigned to this cat yet")

    # Build context parts (stable)
    context_parts: list[str] = []
    for s in sightings:
        context_parts.append(
            f"id={s['id']} createdAt={row_get(s, 'createdAt')} location={s['location'] or ''}\ntext={s['text']}"
        )

    context_hash = make_context_hash(context_parts)

    # Try cache
    execute_query(cur, 
        """
        SELECT insight_json
        FROM cat_insights
        WHERE cat_id = ? AND mode = ? AND prompt_version = ? AND context_hash = ?
        """,
        (cat_id, mode, PROMPT_VERSION, context_hash),
    )
    row = cur.fetchone()
    if row is not None:
        conn.close()
        data = json.loads(row["insight_json"])
        return CatInsightResponse(**data)

    # Generate (stub for now)
    insight = generate_cat_insight_stub(
        cat_id=cat_id,
        mode=mode,
        sightings=sightings,
        question=payload.question,
    )

    now = datetime.utcnow().isoformat() + "Z"
    execute_query(cur, 
        """
        INSERT INTO cat_insights (cat_id, mode, prompt_version, context_hash, insight_json, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            cat_id,
            mode,
            PROMPT_VERSION,
            context_hash,
            insight.model_dump_json(),
            now,
            now,
        ),
    )
    conn.commit()
    conn.close()

    return insight


@app.get("/health")
def health():
    """Simple health endpoint. Handy for debugging and future monitoring."""
    return {"status": "ok"}


@app.get("/cats/{cat_id}/profile", response_model=CatProfile)
def cat_profile(cat_id: int):
    conn = get_conn()
    cur = get_cursor(conn)

    # Load cat
    execute_query(cur, "SELECT id, name FROM cats WHERE id = ?", (cat_id,))
    cat = cur.fetchone()
    if cat is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Cat not found")

    # Load all sightings assigned to this cat
    execute_query(cur, 
        """
        SELECT id, text, location
        FROM entries
        WHERE cat_id = ?
        ORDER BY id DESC
        """,
        (cat_id,),
    )
    sightings = cur.fetchall()
    conn.close()

    sightings_count = len(sightings)
    if sightings_count == 0:
        return CatProfile(
            cat_id=cat_id,
            name=cat["name"],
            sightings_count=0,
            locations=[],
            top_tags=[],
            temperament_guess="unknown",
            profile_text="No sightings assigned yet. Assign sightings to build a profile.",
        )

    # Aggregate text for simple “generative” profile
    all_text = "\n".join([s["text"] for s in sightings if s["text"]])
    tags = baseline_tags(all_text, k=8)

    # Locations list (unique, keep simple)
    locs = []
    for s in sightings:
        if s["location"]:
            locs.append(s["location"])
    unique_locations = list(dict.fromkeys(locs))[:5]  # preserve order, max 5

    # Temperament guess derived from sentiment classifier over aggregated text
    sentiment = baseline_sentiment(all_text)
    temperament_guess = (
        "friendly" if sentiment == "positive"
        else "defensive / cautious" if sentiment == "negative"
        else "unknown / neutral"
    )

    # “GenAI-ish” profile text: template + summarized lines
    # (Later you can replace this with a real LLM call without changing the endpoint contract.)
    summary = baseline_summary(all_text, max_len=220)

    name = cat["name"] or f"Cat #{cat_id}"
    location_hint = unique_locations[0] if unique_locations else "unknown area"

    profile_text = (
        f"{name} is a community-tracked street cat most often seen around {location_hint}. "
        f"Based on {sightings_count} sighting(s), the current temperament guess is '{temperament_guess}'. "
        f"Common tags from notes: {', '.join(tags) if tags else 'none yet'}. "
        f"Summary of recent notes: {summary}"
    )

    return CatProfile(
        cat_id=cat_id,
        name=cat["name"],
        sightings_count=sightings_count,
        locations=unique_locations,
        top_tags=tags,
        temperament_guess=temperament_guess,
        profile_text=profile_text,
    )



@app.get("/entries/{entry_id}/matches", response_model=List[MatchCandidate])
def find_matches(
    entry_id: int,
    top_k: int = Query(5, ge=1, le=20, description="Max number of matches to return"),
    min_score: float = Query(0.15, ge=0.0, le=1.0, description="Minimum similarity score")
):
    """
    Suggest possible matches for a given entry.

    Uses geographic distance when coordinates are available (from location normalization),
    otherwise falls back to text-based matching.

    Parameters:
    - top_k: return at most N candidates (1-20, default 5)
    - min_score: ignore candidates below this threshold (0.0-1.0, default 0.15)

    NOTE: This is *not* identity proof. It's a suggestion list.
    """
    conn = get_conn()
    cur = get_cursor(conn)

    # 1) Load the base entry with coordinates
    execute_query(cur,
        """
        SELECT id, text, location, location_lat, location_lon
        FROM entries
        WHERE id = ?
        """,
        (entry_id,),
    )
    base = cur.fetchone()
    if base is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Entry not found")

    base_text = base["text"]
    base_location = base["location"] or ""
    base_lat = base["location_lat"]
    base_lon = base["location_lon"]

    # 2) Load all other candidates with coordinates
    execute_query(cur,
        """
        SELECT id, text, createdAt, nickname, location, location_lat, location_lon
        FROM entries
        WHERE id != ?
        ORDER BY id DESC
        """,
        (entry_id,),
    )
    rows = cur.fetchall()
    conn.close()

    candidates: list[MatchCandidate] = []

    # 3) Score each candidate using coordinates when available
    for r in rows:
        cand_text = r["text"]
        cand_location = r["location"] or ""
        cand_lat = r["location_lat"]
        cand_lon = r["location_lon"]

        score, reasons = compute_match_score(
            base_text=base_text,
            base_location=base_location,
            cand_text=cand_text,
            cand_location=cand_location,
            base_lat=base_lat,
            base_lon=base_lon,
            cand_lat=cand_lat,
            cand_lon=cand_lon,
        )

        if score >= min_score:
            candidates.append(
                MatchCandidate(
                    entry_id=entry_id,
                    candidate_id=r["id"],
                    score=round(score, 3),
                    reasons=reasons,
                    candidate_nickname=r["nickname"],
                    candidate_location=r["location"],
                    candidate_text=r["text"],
                    candidate_createdAt=row_get(r, "createdAt"),
                )
            )

    # 4) Sort by score descending and return top_k
    candidates.sort(key=lambda x: x.score, reverse=True)
    return candidates[: max(1, min(top_k, 20))]


@app.get("/entries/{entry_id}/nearby", response_model=List[NearbySighting])
def find_nearby_sightings(
    entry_id: int,
    radius_meters: int = Query(500, ge=1, le=5000, description="Search radius in meters"),
    top_k: int = Query(10, ge=1, le=50, description="Max number of results"),
    include_assigned: bool = Query(True, description="Include sightings already linked to cats"),
):
    """
    Find sightings within a geographic radius of the given entry.

    Requires the entry to have normalized coordinates (location_lat, location_lon).
    Use POST /entries/{id}/normalize-location first if coordinates are missing.

    Parameters:
    - radius_meters: Search radius (1-5000m, default 500m)
    - top_k: Max results to return (1-50, default 10)
    - include_assigned: Include sightings already linked to cats (default true)

    Returns sightings sorted by distance (closest first).
    """
    conn = get_conn()
    cur = get_cursor(conn)

    # 1) Load the base entry with coordinates
    execute_query(cur,
        """
        SELECT id, text, location, location_normalized, location_lat, location_lon
        FROM entries
        WHERE id = ?
        """,
        (entry_id,),
    )
    base = cur.fetchone()
    if base is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Entry not found")

    base_lat = base["location_lat"]
    base_lon = base["location_lon"]

    if base_lat is None or base_lon is None:
        conn.close()
        raise HTTPException(
            status_code=400,
            detail="Entry has no coordinates. Use POST /entries/{id}/normalize-location first."
        )

    base_text = base["text"]
    base_location = base["location"] or ""

    # 2) Load all other entries with coordinates
    if include_assigned:
        execute_query(cur,
            """
            SELECT e.id, e.text, e.createdAt, e.nickname, e.location,
                   e.location_normalized, e.location_lat, e.location_lon,
                   e.cat_id, c.name as cat_name
            FROM entries e
            LEFT JOIN cats c ON e.cat_id = c.id
            WHERE e.id != ? AND e.location_lat IS NOT NULL AND e.location_lon IS NOT NULL
            ORDER BY e.id DESC
            """,
            (entry_id,),
        )
    else:
        execute_query(cur,
            """
            SELECT e.id, e.text, e.createdAt, e.nickname, e.location,
                   e.location_normalized, e.location_lat, e.location_lon,
                   e.cat_id, c.name as cat_name
            FROM entries e
            LEFT JOIN cats c ON e.cat_id = c.id
            WHERE e.id != ? AND e.location_lat IS NOT NULL AND e.location_lon IS NOT NULL
                  AND e.cat_id IS NULL
            ORDER BY e.id DESC
            """,
            (entry_id,),
        )

    rows = cur.fetchall()
    conn.close()

    nearby: list[NearbySighting] = []

    # 3) Calculate distance and score for each candidate
    for r in rows:
        cand_lat = r["location_lat"]
        cand_lon = r["location_lon"]

        # Calculate geographic distance
        distance = haversine_distance(base_lat, base_lon, cand_lat, cand_lon)

        # Skip if outside radius
        if distance > radius_meters:
            continue

        # Calculate match score
        score, reasons = compute_match_score(
            base_text=base_text,
            base_location=base_location,
            cand_text=r["text"],
            cand_location=r["location"] or "",
            base_lat=base_lat,
            base_lon=base_lon,
            cand_lat=cand_lat,
            cand_lon=cand_lon,
        )

        # Create text preview (first 100 chars)
        text_preview = r["text"][:100] + "..." if len(r["text"]) > 100 else r["text"]

        nearby.append(
            NearbySighting(
                entry_id=r["id"],
                distance_meters=round(distance, 1),
                location=r["location"],
                location_normalized=r["location_normalized"],
                text_preview=text_preview,
                cat_id=r["cat_id"],
                cat_name=r["cat_name"],
                created_at=row_get(r, "createdAt"),
                match_score=round(score, 3),
                reasons=reasons,
            )
        )

    # 4) Sort by distance (closest first) and return top_k
    nearby.sort(key=lambda x: x.distance_meters)
    return nearby[:top_k]


@app.get("/entries", response_model=List[Entry])
def get_entries():
    """
    Return all entries, newest first.
    """
    conn = get_conn()
    cur = get_cursor(conn)
    execute_query(cur,
    """
    SELECT id, text, createdAt, isFavorite, nickname, location, cat_id, photo_url,
           location_normalized, location_lat, location_lon, location_osm_id
    FROM entries
    ORDER BY id DESC
    """
    )
    rows = cur.fetchall()
    conn.close()

    result: list[Entry] = []
    for r in rows:
        result.append(
            Entry(
                id=r["id"],
                text=r["text"],
                createdAt=row_get(r, "createdAt"),
                isFavorite=bool(row_get(r, "isFavorite")),
                nickname=r["nickname"],
                location=r["location"],
                cat_id=r["cat_id"],
                photo_url=r["photo_url"],
                location_normalized=r["location_normalized"],
                location_lat=r["location_lat"],
                location_lon=r["location_lon"],
                location_osm_id=r["location_osm_id"],
            )
        )
    return result


@app.post("/cats", response_model=Cat)
def create_cat(payload: CatCreate):
    created_at = datetime.utcnow().isoformat() + "Z"
    name = payload.name.strip() if payload.name and payload.name.strip() else None

    conn = get_conn()
    cur = get_cursor(conn)

    ph = sql_placeholder()
    if settings.is_postgres:
        execute_query(cur, 
            f"INSERT INTO cats (name, createdAt) VALUES ({ph}, {ph}) RETURNING id",
            (name, created_at),
        )
        new_id = cur.fetchone()['id']
    else:
        execute_query(cur, 
            f"INSERT INTO cats (name, createdAt) VALUES ({ph}, {ph})",
            (name, created_at),
        )
        new_id = cur.lastrowid

    conn.commit()
    conn.close()

    return Cat(id=new_id, name=name, createdAt=created_at)


@app.post("/entries", response_model=Entry)
def create_entry(payload: EntryCreate):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text must not be empty")

    created_at = datetime.utcnow().isoformat() + "Z"

    nickname = payload.nickname.strip() if payload.nickname and payload.nickname.strip() else None
    location = payload.location.strip() if payload.location and payload.location.strip() else None
    photo_url = payload.photo_url.strip() if payload.photo_url and payload.photo_url.strip() else None

    conn = get_conn()
    cur = get_cursor(conn)

    ph = sql_placeholder()
    if settings.is_postgres:
        execute_query(cur, 
            f"""
            INSERT INTO entries (text, createdAt, isFavorite, nickname, location, cat_id, photo_url)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            RETURNING id
            """,
            (text, created_at, 0, nickname, location, None, photo_url),
        )
        new_id = cur.fetchone()['id']
    else:
        execute_query(cur, 
            f"""
            INSERT INTO entries (text, createdAt, isFavorite, nickname, location, cat_id, photo_url)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (text, created_at, 0, nickname, location, None, photo_url),
        )
        new_id = cur.lastrowid

    conn.commit()
    conn.close()

    return Entry(
        id=new_id,
        text=text,
        createdAt=created_at,
        isFavorite=False,
        nickname=nickname,
        location=location,
        cat_id=None,
        photo_url=photo_url,
        location_normalized=None,
        location_lat=None,
        location_lon=None,
        location_osm_id=None,
    )


# -----------------------------------------------------------------------------
# Image Upload Endpoints (Bunny.net CDN Storage)
# -----------------------------------------------------------------------------

@app.post("/upload/image")
async def upload_image_endpoint(file: UploadFile = File(...)):
    """
    Upload an image and return its CDN URL.

    This is a standalone endpoint that can be called independently
    or as part of creating/updating a sighting.

    Returns:
        {"url": "https://catatlas.b-cdn.net/sightings/..."}
    """
    url = await upload_to_bunny(file, folder="sightings")
    return {"url": url}


@app.post("/entries/with-image", response_model=Entry)
async def create_entry_with_image(
    text: str = Form(..., min_length=1, max_length=5000),
    nickname: Optional[str] = Form(None, max_length=100),
    location: Optional[str] = Form(None, max_length=200),
    image: Optional[UploadFile] = File(None)
):
    """
    Create a new cat sighting with optional image upload.

    This endpoint accepts multipart/form-data instead of JSON.
    Use this when uploading an image along with the entry data.

    Validation:
    - text: 1-5000 characters (required)
    - nickname: max 100 characters (optional)
    - location: max 200 characters (optional)
    - image: max 10MB, types: jpeg/png/webp/gif (optional)
    """
    # Upload image if provided
    photo_url = None
    if image:
        photo_url = await upload_to_bunny(image, folder="sightings")

    # Validate text
    text_clean = text.strip()
    if not text_clean:
        raise HTTPException(status_code=400, detail="text must not be empty")

    created_at = datetime.utcnow().isoformat() + "Z"

    nickname_clean = nickname.strip() if nickname and nickname.strip() else None
    location_clean = location.strip() if location and location.strip() else None

    conn = get_conn()
    cur = get_cursor(conn)

    ph = sql_placeholder()
    if settings.is_postgres:
        execute_query(cur,
            f"""
            INSERT INTO entries (text, createdAt, isFavorite, nickname, location, cat_id, photo_url)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            RETURNING id
            """,
            (text_clean, created_at, 0, nickname_clean, location_clean, None, photo_url),
        )
        new_id = cur.fetchone()['id']
    else:
        execute_query(cur,
            f"""
            INSERT INTO entries (text, createdAt, isFavorite, nickname, location, cat_id, photo_url)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (text_clean, created_at, 0, nickname_clean, location_clean, None, photo_url),
        )
        new_id = cur.lastrowid

    conn.commit()
    conn.close()

    return Entry(
        id=new_id,
        text=text_clean,
        createdAt=created_at,
        isFavorite=False,
        nickname=nickname_clean,
        location=location_clean,
        cat_id=None,
        photo_url=photo_url,
    )


@app.patch("/entries/{entry_id}/image", response_model=Entry)
async def update_entry_image(entry_id: int, image: UploadFile = File(...)):
    """
    Add or replace an image for an existing sighting.

    If the entry already has an image, the old one will be deleted from Bunny.net.
    """
    conn = get_conn()
    cur = get_cursor(conn)

    # Get existing entry
    ph = sql_placeholder()
    execute_query(cur,
        f"SELECT id, text, createdAt, isFavorite, nickname, location, cat_id, photo_url FROM entries WHERE id = {ph}",
        (entry_id,)
    )
    row = cur.fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Entry not found")

    # Delete old image if exists
    old_url = row_get(row, "photo_url")
    if old_url:
        await delete_from_bunny(old_url)  # Best effort, don't fail if deletion fails

    # Upload new image
    new_url = await upload_to_bunny(image, folder="sightings")

    # Update entry
    execute_query(cur,
        f"UPDATE entries SET photo_url = {ph} WHERE id = {ph}",
        (new_url, entry_id)
    )
    conn.commit()
    conn.close()

    return Entry(
        id=row_get(row, "id"),
        text=row_get(row, "text"),
        createdAt=row_get(row, "createdAt"),
        isFavorite=bool(row_get(row, "isFavorite")),
        nickname=row_get(row, "nickname"),
        location=row_get(row, "location"),
        cat_id=row_get(row, "cat_id"),
        photo_url=new_url,
    )


@app.post("/entries/{entry_id}/favorite", response_model=Entry)
def toggle_favorite(entry_id: int):
    """
    Toggle isFavorite for an entry.
    """
    conn = get_conn()
    cur = get_cursor(conn)

    execute_query(cur, 
        """
        SELECT id, text, createdAt, isFavorite, nickname, location
        FROM entries
        WHERE id = ?
        """,
        (entry_id,),
    )
    row = cur.fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Entry not found")

    new_fav = 0 if row_get(row, "isFavorite") else 1

    execute_query(cur, 
        "UPDATE entries SET isFavorite = ? WHERE id = ?",
        (new_fav, entry_id),
    )
    conn.commit()
    conn.close()

    return Entry(
        id=row["id"],
        text=row["text"],
        createdAt=row_get(row, "createdAt"),
        isFavorite=bool(new_fav),
        nickname=row["nickname"],
        location=row["location"],
    )


@app.post("/entries/{entry_id}/normalize-location", response_model=LocationNormalizationResult)
async def normalize_entry_location(entry_id: int, force: bool = Query(False, description="Re-normalize even if already done")):
    """
    Normalize the location of an entry using OpenStreetMap Nominatim.

    This validates and standardizes the location, adding:
    - Normalized display name
    - Latitude and longitude coordinates
    - OpenStreetMap ID for deduplication

    Parameters:
    - force: Re-normalize even if location is already normalized
    """
    conn = get_conn()
    cur = get_cursor(conn)

    # Fetch the entry
    execute_query(cur,
        """
        SELECT id, location, location_normalized, location_lat, location_lon, location_osm_id
        FROM entries
        WHERE id = ?
        """,
        (entry_id,),
    )
    row = cur.fetchone()

    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Entry not found")

    original_location = row["location"]

    # Check if entry has a location
    if not original_location:
        conn.close()
        return LocationNormalizationResult(
            entry_id=entry_id,
            original_location="",
            status="no_location",
            message="Entry has no location to normalize",
        )

    # Check if already normalized (unless force=True)
    if not force and row["location_normalized"] and row["location_lat"]:
        conn.close()
        return LocationNormalizationResult(
            entry_id=entry_id,
            original_location=original_location,
            normalized_location=row["location_normalized"],
            latitude=row["location_lat"],
            longitude=row["location_lon"],
            osm_id=row["location_osm_id"],
            status="already_normalized",
            message="Location already normalized. Use force=true to re-normalize.",
        )

    # Try geocoding with fallback
    geo_result = await geocode_with_fallback(original_location)

    # Check if we got coordinates
    if geo_result.get("lat") and geo_result.get("lon"):
        # Update the entry with normalized data
        execute_query(cur,
            """
            UPDATE entries
            SET location_normalized = ?,
                location_lat = ?,
                location_lon = ?,
                location_osm_id = ?
            WHERE id = ?
            """,
            (
                geo_result["display_name"],
                float(geo_result["lat"]),
                float(geo_result["lon"]),
                geo_result.get("osm_id"),
                entry_id,
            ),
        )
        conn.commit()
        conn.close()

        return LocationNormalizationResult(
            entry_id=entry_id,
            original_location=original_location,
            normalized_location=geo_result["display_name"],
            latitude=float(geo_result["lat"]),
            longitude=float(geo_result["lon"]),
            osm_id=geo_result.get("osm_id"),
            status="success",
            message="Location normalized successfully",
        )
    else:
        # Geocoding failed or location not found
        conn.close()
        fallback_status = geo_result.get("fallback", "error")
        return LocationNormalizationResult(
            entry_id=entry_id,
            original_location=original_location,
            normalized_location=geo_result.get("display_name"),
            status=fallback_status if fallback_status != "not_found" else "not_found",
            message=f"Could not geocode location: {fallback_status}",
        )


@app.get("/health/geocoding", response_model=GeocodingHealthResponse)
def geocoding_health():
    """
    Health check for the geocoding service.

    Returns circuit breaker state and service availability.
    """
    return GeocodingHealthResponse(
        service="nominatim",
        circuit_state=nominatim_circuit.get_state(),
        failure_count=nominatim_circuit._failure_count,
        last_failure=nominatim_circuit._last_failure_time.isoformat() if nominatim_circuit._last_failure_time else None,
        status="healthy" if nominatim_circuit._state == CircuitState.CLOSED else "degraded",
    )


@app.get("/cats", response_model=List[Cat])
def list_cats():
    conn = get_conn()
    cur = get_cursor(conn)
    execute_query(cur, "SELECT id, name, createdAt FROM cats ORDER BY id DESC")
    rows = cur.fetchall()
    conn.close()

    return [Cat(id=r["id"], name=r["name"], createdAt=row_get(r, "createdAt")) for r in rows]


@app.get("/entries/{entry_id}/analysis", response_model=EntryAnalysis)
def get_entry_analysis(entry_id: int):
    """
    Return stored analysis for an entry, if it exists.
    If it doesn't exist yet, return 404.
    """
    conn = get_conn()
    cur = get_cursor(conn)

    execute_query(cur, 
        """
        SELECT entry_id, summary, tags_json, sentiment, updatedAt
        FROM analyses
        WHERE entry_id = ?
        """,
        (entry_id,),
    )
    row = cur.fetchone()
    conn.close()

    if row is None:
        raise HTTPException(status_code=404, detail="No analysis found for this entry")

    return EntryAnalysis(
        entry_id=row["entry_id"],
        summary=row["summary"],
        tags=tags_from_json(row["tags_json"]),
        sentiment=row["sentiment"],
        updatedAt=row_get(row, "updatedAt"),
    )


@app.post("/entries/{entry_id}/assign/{cat_id}", response_model=Entry)
def assign_entry_to_cat(entry_id: int, cat_id: int):
    conn = get_conn()
    cur = get_cursor(conn)

    # Ensure cat exists
    execute_query(cur, "SELECT id FROM cats WHERE id = ?", (cat_id,))
    if cur.fetchone() is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Cat not found")

    # Ensure entry exists
    execute_query(cur,
        """SELECT id, text, createdAt, isFavorite, nickname, location, cat_id, photo_url,
                  location_normalized, location_lat, location_lon, location_osm_id
           FROM entries WHERE id = ?""",
        (entry_id,),
    )
    row = cur.fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Entry not found")

    # Assign
    execute_query(cur, "UPDATE entries SET cat_id = ? WHERE id = ?", (cat_id, entry_id))
    conn.commit()

    # Return updated entry
    execute_query(cur,
        """SELECT id, text, createdAt, isFavorite, nickname, location, cat_id, photo_url,
                  location_normalized, location_lat, location_lon, location_osm_id
           FROM entries WHERE id = ?""",
        (entry_id,),
    )
    updated = cur.fetchone()
    conn.close()

    return Entry(
        id=updated["id"],
        text=updated["text"],
        createdAt=row_get(updated, "createdAt"),
        isFavorite=bool(row_get(updated, "isFavorite")),
        nickname=updated["nickname"],
        location=updated["location"],
        cat_id=updated["cat_id"],
        photo_url=updated["photo_url"],
        location_normalized=updated["location_normalized"],
        location_lat=updated["location_lat"],
        location_lon=updated["location_lon"],
        location_osm_id=updated["location_osm_id"],
    )


# -----------------------------------------------------------------------------
# Phase 3: Validation Workflow Endpoints
# -----------------------------------------------------------------------------

@app.post("/cats/{cat_id}/link-sightings", response_model=LinkSightingsResponse)
def link_sightings_to_cat(cat_id: int, payload: LinkSightingsRequest):
    """
    Bulk link multiple sightings to an existing cat.

    This endpoint allows you to link multiple entries to a cat in a single request,
    useful after reviewing nearby sightings and confirming they belong to the same cat.

    Returns a summary of:
    - newly_linked: entries that were successfully linked
    - already_linked: entries that were already linked to this cat
    - failed: entries that don't exist
    """
    conn = get_conn()
    cur = get_cursor(conn)

    # Ensure cat exists
    execute_query(cur, "SELECT id FROM cats WHERE id = ?", (cat_id,))
    if cur.fetchone() is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Cat not found")

    already_linked: List[int] = []
    newly_linked: List[int] = []
    failed: List[int] = []

    for entry_id in payload.entry_ids:
        # Check if entry exists
        execute_query(cur, "SELECT id, cat_id FROM entries WHERE id = ?", (entry_id,))
        entry = cur.fetchone()

        if entry is None:
            failed.append(entry_id)
            continue

        current_cat_id = entry["cat_id"]

        if current_cat_id == cat_id:
            # Already linked to this cat
            already_linked.append(entry_id)
        else:
            # Link to the cat (even if previously linked to another cat)
            execute_query(cur, "UPDATE entries SET cat_id = ? WHERE id = ?", (cat_id, entry_id))
            newly_linked.append(entry_id)

    conn.commit()
    conn.close()

    return LinkSightingsResponse(
        cat_id=cat_id,
        linked_count=len(newly_linked) + len(already_linked),
        already_linked=already_linked,
        newly_linked=newly_linked,
        failed=failed,
    )


@app.post("/cats/from-sightings", response_model=Cat)
def create_cat_from_sightings(payload: CreateCatFromSightingsRequest):
    """
    Create a new cat and link multiple sightings to it in a single operation.

    This is a convenience endpoint for when you've identified that several
    unassigned sightings belong to the same (previously unknown) cat.

    The workflow is:
    1. Create a new cat (with optional name)
    2. Link all specified entries to the new cat
    3. Return the new cat

    Note: Entries that are already linked to another cat will be re-linked
    to the new cat. Entries that don't exist are silently skipped.
    """
    created_at = datetime.utcnow().isoformat() + "Z"
    name = payload.name.strip() if payload.name and payload.name.strip() else None

    conn = get_conn()
    cur = get_cursor(conn)

    # Create the new cat
    ph = sql_placeholder()
    if settings.is_postgres:
        execute_query(cur,
            f"INSERT INTO cats (name, createdAt) VALUES ({ph}, {ph}) RETURNING id",
            (name, created_at),
        )
        new_cat_id = cur.fetchone()['id']
    else:
        execute_query(cur,
            f"INSERT INTO cats (name, createdAt) VALUES ({ph}, {ph})",
            (name, created_at),
        )
        new_cat_id = cur.lastrowid

    # Link all specified entries to the new cat
    for entry_id in payload.entry_ids:
        # Check if entry exists before updating
        execute_query(cur, "SELECT id FROM entries WHERE id = ?", (entry_id,))
        if cur.fetchone() is not None:
            execute_query(cur, "UPDATE entries SET cat_id = ? WHERE id = ?", (new_cat_id, entry_id))

    conn.commit()
    conn.close()

    return Cat(id=new_cat_id, name=name, createdAt=created_at)


@app.post("/entries/{entry_id}/analyze", response_model=EntryAnalysis)
def analyze_and_store(entry_id: int):
    """
    Analyze an entry by ID and persist the result in SQLite (cached AI pattern).

    Logic:
    1) Load the entry text
    2) Compute a hash of the text
    3) If a stored analysis exists with same hash -> return cached result
    4) Else compute baseline analysis -> upsert into DB -> return new result
    """
    conn = get_conn()
    cur = get_cursor(conn)

    # 1) Load entry
    execute_query(cur, "SELECT id, text FROM entries WHERE id = ?", (entry_id,))
    entry = cur.fetchone()
    if entry is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Entry not found")

    text = entry["text"]
    current_hash = text_to_hash(text)

    # 2) Check cache
    execute_query(cur, 
        """
        SELECT entry_id, text_hash, summary, tags_json, sentiment, updatedAt
        FROM analyses
        WHERE entry_id = ?
        """,
        (entry_id,),
    )
    existing = cur.fetchone()

    # If analysis exists and text has not changed -> return cached analysis
    if existing is not None and existing["text_hash"] == current_hash:
        conn.close()
        return EntryAnalysis(
            entry_id=existing["entry_id"],
            summary=existing["summary"],
            tags=tags_from_json(existing["tags_json"]),
            sentiment=existing["sentiment"],
            updatedAt=row_get(existing, "updatedAt"),
        )

    # 3) Compute fresh analysis (baseline "AI")
    summary = baseline_summary(text)
    tags = baseline_tags(text)
    sentiment = baseline_sentiment(text)
    now = datetime.utcnow().isoformat() + "Z"

    # 4) Upsert analysis
    # ON CONFLICT(entry_id) means: if entry_id already exists, update that row.
    execute_query(cur, 
        """
        INSERT INTO analyses (entry_id, text_hash, summary, tags_json, sentiment, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entry_id) DO UPDATE SET
            text_hash=excluded.text_hash,
            summary=excluded.summary,
            tags_json=excluded.tags_json,
            sentiment=excluded.sentiment,
            updatedAt=excluded.updatedAt
        """,
        (entry_id, current_hash, summary, tags_to_json(tags), sentiment, now, now),
    )
    conn.commit()
    conn.close()

    return EntryAnalysis(
        entry_id=entry_id,
        summary=summary,
        tags=tags,
        sentiment=sentiment,
        updatedAt=now,
    )
