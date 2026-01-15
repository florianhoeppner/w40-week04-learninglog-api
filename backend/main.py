"""
main.py — CatAtlas / Learning Log backend (FastAPI + SQLite)

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

import hashlib
import json
import logging
import re
import sqlite3
import os
from pathlib import Path
from collections import Counter
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, HttpUrl, ValidationError


# -----------------------------------------------------------------------------
# Logging Configuration
# -----------------------------------------------------------------------------

# Configure logging
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)


# -----------------------------------------------------------------------------
# Custom Exceptions
# -----------------------------------------------------------------------------

class DatabaseError(Exception):
    """Raised when database operations fail"""
    pass


class ResourceNotFoundError(Exception):
    """Raised when a requested resource doesn't exist"""
    pass


# -----------------------------------------------------------------------------
# App setup
# -----------------------------------------------------------------------------

app = FastAPI(title="CatAtlas API")


# -----------------------------------------------------------------------------
# Exception Handlers
# -----------------------------------------------------------------------------

@app.exception_handler(DatabaseError)
async def database_exception_handler(request: Request, exc: DatabaseError):
    logger.error(f"Database error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "A database error occurred. Please try again later."}
    )


@app.exception_handler(ResourceNotFoundError)
async def resource_not_found_handler(request: Request, exc: ResourceNotFoundError):
    logger.warning(f"Resource not found: {exc}")
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"detail": str(exc)}
    )


@app.exception_handler(ValidationError)
async def validation_exception_handler(request: Request, exc: ValidationError):
    logger.warning(f"Validation error: {exc}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors()}
    )


@app.exception_handler(sqlite3.IntegrityError)
async def integrity_error_handler(request: Request, exc: sqlite3.IntegrityError):
    logger.error(f"Database integrity error: {exc}")
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": "A database constraint was violated."}
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An unexpected error occurred."}
    )

# CORS: allows your frontend (different port/domain) to call this backend.
# Configure allowed origins via CORS_ORIGINS environment variable (comma-separated)
# Default to "*" for local development
cors_origins_str = os.getenv("CORS_ORIGINS", "*")
allowed_origins = [origin.strip() for origin in cors_origins_str.split(",")] if cors_origins_str != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """
    Health check endpoint for monitoring + CI smoke tests.
    Keep it extremely fast and dependency-light.
    """
    return {"status": "ok"}


# -----------------------------------------------------------------------------
# SQLite configuration
# -----------------------------------------------------------------------------

# Allow tests to point the app to a temporary DB file
DB_PATH = Path(os.getenv("CATATLAS_DB_PATH", str(Path(__file__).parent / "learninglog.db")))



def get_conn() -> sqlite3.Connection:
    """
    Open a SQLite connection.

    - check_same_thread=False:
        FastAPI may handle requests in different threads.
        SQLite by default restricts a connection to the creating thread.
    - row_factory=sqlite3.Row:
        Allows dict-like access row["column_name"].

    Raises:
        DatabaseError: If connection to database fails
    """
    try:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        logger.debug(f"Database connection established to {DB_PATH}")
        return conn
    except sqlite3.Error as e:
        logger.error(f"Failed to connect to database: {e}")
        raise DatabaseError(f"Failed to connect to database: {e}") from e


def _try_alter_table(cur: sqlite3.Cursor, sql: str) -> None:
    """
    SQLite doesn't support 'ADD COLUMN IF NOT EXISTS' in older versions.
    So we attempt ALTER TABLE and ignore errors like 'duplicate column name'.
    """
    try:
        cur.execute(sql)
    except sqlite3.OperationalError:
        # Example: duplicate column name => column already exists
        # We intentionally ignore it to make init_db idempotent.
        pass


def init_db() -> None:
    """
    Create required tables if they don't exist.
    Also performs a minimal "migration" step for older DB files
    (adds new columns if missing).
    """
    conn = get_conn()
    cur = conn.cursor()

    # --- Entries table (sightings) ---
    # Keep this as your source-of-truth domain data.
    # ------------------------------------------------------------
    # Table: entries (existing) — treat as "sightings"
    # ------------------------------------------------------------
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            isFavorite INTEGER NOT NULL DEFAULT 0,
            nickname TEXT,
            location TEXT
        )
        """
    )

    # If entries table existed before nickname/location were added,
    # these ALTER statements will add them (or no-op if already there).
        # Minimal migrations for older DBs (safe no-op if already exists)
    _try_alter_table(cur, "ALTER TABLE entries ADD COLUMN nickname TEXT")
    _try_alter_table(cur, "ALTER TABLE entries ADD COLUMN location TEXT")
    # NEW: link a sighting to a cat identity
    _try_alter_table(cur, "ALTER TABLE entries ADD COLUMN cat_id INTEGER")
    # NEW: photo dimension (for now: just a URL string)
    _try_alter_table(cur, "ALTER TABLE entries ADD COLUMN photo_url TEXT")

    # --- Analyses table ---
    # Derived data: generated from entry text and cached/persisted.
    # One analysis per entry_id (simple, sufficient for learning).


    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS analyses (
            entry_id INTEGER PRIMARY KEY,
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

    # --- Cats table + insights (new) ---
    # Table: cat_insights (new) — cached GenAI outputs per cat + mode + context hash
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS cat_insights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cat_id INTEGER NOT NULL,
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

    # ------------------------------------------------------------
    # Table: cats (new) — explicit identity concept
    # ------------------------------------------------------------
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS cats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,                -- user-assigned name (optional)
            createdAt TEXT NOT NULL
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
    text: str = Field(..., min_length=1, max_length=5000, description="Sighting notes")
    nickname: Optional[str] = Field(None, max_length=100, description="Cat nickname")
    location: Optional[str] = Field(None, max_length=200, description="Location description")
    photo_url: Optional[str] = Field(None, max_length=1000, description="Photo URL")

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
    cat_id: Optional[int] = None       # NEW
    photo_url: Optional[str] = None    # NEW

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
    name: Optional[str] = Field(None, max_length=100, description="Cat name/nickname")

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
    mode: str = Field(..., pattern="^(profile|care|update|risk)$", description="Insight mode")
    question: Optional[str] = Field(None, max_length=500, description="Optional question")


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
) -> tuple[float, list[str]]:
    """
    Combine text similarity + location similarity into one score.

    Weighting (simple but effective):
    - 70% text similarity
    - 30% location similarity

    We also return "reasons" for transparency in UI.
    """
    reasons: list[str] = []

    base_kw = tokenize_keywords(base_text)
    cand_kw = tokenize_keywords(cand_text)
    text_sim = jaccard_similarity(base_kw, cand_kw)

    if text_sim > 0:
        reasons.append(f"text similarity {text_sim:.2f}")

    loc_sim = 0.0
    if base_location and cand_location:
        loc_sim = location_similarity(base_location, cand_location)
        if loc_sim > 0:
            reasons.append(f"location similarity {loc_sim:.2f}")

    score = 0.7 * text_sim + 0.3 * loc_sim

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
    cur.execute(
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
                createdAt=s["createdAt"],
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
    cur = conn.cursor()

    # Ensure cat exists
    cur.execute("SELECT id FROM cats WHERE id = ?", (cat_id,))
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
            f"id={s['id']} createdAt={s['createdAt']} location={s['location'] or ''}\ntext={s['text']}"
        )

    context_hash = make_context_hash(context_parts)

    # Try cache
    cur.execute(
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
    cur.execute(
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


@app.get("/cats/{cat_id}/profile", response_model=CatProfile)
def cat_profile(cat_id: int):
    conn = get_conn()
    cur = conn.cursor()

    # Load cat
    cur.execute("SELECT id, name FROM cats WHERE id = ?", (cat_id,))
    cat = cur.fetchone()
    if cat is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Cat not found")

    # Load all sightings assigned to this cat
    cur.execute(
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
def find_matches(entry_id: int, top_k: int = 5, min_score: float = 0.15):
    """
    Suggest possible matches for a given entry.

    Parameters:
    - top_k: return at most N candidates
    - min_score: ignore candidates below this threshold

    NOTE: This is *not* identity proof. It's a suggestion list.
    """
    conn = get_conn()
    cur = conn.cursor()

    # 1) Load the base entry
    cur.execute(
        """
        SELECT id, text, location
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

    # 2) Load all other candidates
    cur.execute(
        """
        SELECT id, text, createdAt, nickname, location
        FROM entries
        WHERE id != ?
        ORDER BY id DESC
        """,
        (entry_id,),
    )
    rows = cur.fetchall()
    conn.close()

    candidates: list[MatchCandidate] = []

    # 3) Score each candidate
    for r in rows:
        cand_text = r["text"]
        cand_location = r["location"] or ""

        score, reasons = compute_match_score(
            base_text=base_text,
            base_location=base_location,
            cand_text=cand_text,
            cand_location=cand_location,
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
                    candidate_createdAt=r["createdAt"],
                )
            )

    # 4) Sort by score descending and return top_k
    candidates.sort(key=lambda x: x.score, reverse=True)
    return candidates[: max(1, min(top_k, 20))]


@app.get("/entries", response_model=List[Entry])
def get_entries():
    """
    Return all entries, newest first.
    """
    conn = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
        """
        SELECT id, text, createdAt, isFavorite, nickname, location, cat_id, photo_url
        FROM entries
        ORDER BY id DESC
        """
        )
        rows = cur.fetchall()
        logger.debug(f"Retrieved {len(rows)} entries")

        result: list[Entry] = []
        for r in rows:
            result.append(
                Entry(
                    id=r["id"],
                    text=r["text"],
                    createdAt=r["createdAt"],
                    isFavorite=bool(r["isFavorite"]),
                    nickname=r["nickname"],
                    location=r["location"],
                    cat_id=r["cat_id"],
                    photo_url=r["photo_url"],
                )
            )
        return result
    except sqlite3.Error as e:
        logger.error(f"Failed to retrieve entries: {e}")
        raise DatabaseError(f"Failed to retrieve entries: {e}") from e
    finally:
        if conn:
            conn.close()


@app.post("/cats", response_model=Cat)
def create_cat(payload: CatCreate):
    created_at = datetime.utcnow().isoformat() + "Z"
    name = payload.name.strip() if payload.name and payload.name.strip() else None

    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO cats (name, createdAt) VALUES (?, ?)",
        (name, created_at),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()

    return Cat(id=new_id, name=name, createdAt=created_at)


@app.post("/entries", response_model=Entry)
def create_entry(payload: EntryCreate):
    """Create a new cat sighting entry"""
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text must not be empty")

    created_at = datetime.utcnow().isoformat() + "Z"

    nickname = payload.nickname.strip() if payload.nickname and payload.nickname.strip() else None
    location = payload.location.strip() if payload.location and payload.location.strip() else None
    photo_url = payload.photo_url.strip() if payload.photo_url and payload.photo_url.strip() else None

    conn = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO entries (text, createdAt, isFavorite, nickname, location, cat_id, photo_url)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (text, created_at, 0, nickname, location, None, photo_url),
        )
        conn.commit()
        new_id = cur.lastrowid
        logger.info(f"Created new entry with ID {new_id}")

        return Entry(
            id=new_id,
            text=text,
            createdAt=created_at,
            isFavorite=False,
            nickname=nickname,
            location=location,
            cat_id=None,
            photo_url=photo_url,
        )
    except sqlite3.Error as e:
        logger.error(f"Failed to create entry: {e}")
        raise DatabaseError(f"Failed to create entry: {e}") from e
    finally:
        if conn:
            conn.close()


@app.post("/entries/{entry_id}/favorite", response_model=Entry)
def toggle_favorite(entry_id: int):
    """
    Toggle isFavorite for an entry.
    """
    conn = None
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute(
            """
            SELECT id, text, createdAt, isFavorite, nickname, location, cat_id, photo_url
            FROM entries
            WHERE id = ?
            """,
            (entry_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise ResourceNotFoundError(f"Entry with ID {entry_id} not found")

        new_fav = 0 if row["isFavorite"] else 1

        cur.execute(
            "UPDATE entries SET isFavorite = ? WHERE id = ?",
            (new_fav, entry_id),
        )
        conn.commit()
        logger.info(f"Toggled favorite for entry {entry_id} to {bool(new_fav)}")

        return Entry(
            id=row["id"],
            text=row["text"],
            createdAt=row["createdAt"],
            isFavorite=bool(new_fav),
            nickname=row["nickname"],
            location=row["location"],
            cat_id=row["cat_id"],
            photo_url=row["photo_url"],
        )
    except sqlite3.Error as e:
        logger.error(f"Failed to toggle favorite for entry {entry_id}: {e}")
        raise DatabaseError(f"Failed to update entry: {e}") from e
    finally:
        if conn:
            conn.close()


@app.get("/cats", response_model=List[Cat])
def list_cats():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, name, createdAt FROM cats ORDER BY id DESC")
    rows = cur.fetchall()
    conn.close()

    return [Cat(id=r["id"], name=r["name"], createdAt=r["createdAt"]) for r in rows]


@app.get("/entries/{entry_id}/analysis", response_model=EntryAnalysis)
def get_entry_analysis(entry_id: int):
    """
    Return stored analysis for an entry, if it exists.
    If it doesn't exist yet, return 404.
    """
    conn = get_conn()
    cur = conn.cursor()

    cur.execute(
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
        updatedAt=row["updatedAt"],
    )


@app.post("/entries/{entry_id}/assign/{cat_id}", response_model=Entry)
def assign_entry_to_cat(entry_id: int, cat_id: int):
    conn = get_conn()
    cur = conn.cursor()

    # Ensure cat exists
    cur.execute("SELECT id FROM cats WHERE id = ?", (cat_id,))
    if cur.fetchone() is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Cat not found")

    # Ensure entry exists
    cur.execute(
        "SELECT id, text, createdAt, isFavorite, nickname, location, cat_id, photo_url FROM entries WHERE id = ?",
        (entry_id,),
    )
    row = cur.fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Entry not found")

    # Assign
    cur.execute("UPDATE entries SET cat_id = ? WHERE id = ?", (cat_id, entry_id))
    conn.commit()

    # Return updated entry
    cur.execute(
        "SELECT id, text, createdAt, isFavorite, nickname, location, cat_id, photo_url FROM entries WHERE id = ?",
        (entry_id,),
    )
    updated = cur.fetchone()
    conn.close()

    return Entry(
        id=updated["id"],
        text=updated["text"],
        createdAt=updated["createdAt"],
        isFavorite=bool(updated["isFavorite"]),
        nickname=updated["nickname"],
        location=updated["location"],
        cat_id=updated["cat_id"],
        photo_url=updated["photo_url"],
    )


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
    cur = conn.cursor()

    # 1) Load entry
    cur.execute("SELECT id, text FROM entries WHERE id = ?", (entry_id,))
    entry = cur.fetchone()
    if entry is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Entry not found")

    text = entry["text"]
    current_hash = text_to_hash(text)

    # 2) Check cache
    cur.execute(
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
            updatedAt=existing["updatedAt"],
        )

    # 3) Compute fresh analysis (baseline "AI")
    summary = baseline_summary(text)
    tags = baseline_tags(text)
    sentiment = baseline_sentiment(text)
    now = datetime.utcnow().isoformat() + "Z"

    # 4) Upsert analysis
    # ON CONFLICT(entry_id) means: if entry_id already exists, update that row.
    cur.execute(
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
