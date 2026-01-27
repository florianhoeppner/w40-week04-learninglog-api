# Cat Sighting Area Deduplication - Implementation Plan

## Overview

The workflow for identifying cat sightings in the same area follows these steps:

1. **Create Entry** - User always creates a sighting entry first
2. **Validate & Normalize Location** - System validates location via OpenStreetMap Nominatim API
3. **Find Matches** - System identifies other sightings in the same area
4. **Validate Same Cat** - User confirms if matched sightings are the same cat

## Current State Analysis

### Existing Features (in `backend/main.py`)

| Feature | Location | Description |
|---------|----------|-------------|
| `GET /entries/{entry_id}/matches` | Lines 901-970 | Find similar sightings using text/location similarity |
| `compute_match_score()` | Lines 505-541 | 70% text + 30% location weighted scoring |
| `location_similarity()` | Lines 493-502 | Jaccard similarity on tokenized location strings |
| `POST /entries/{entry_id}/assign/{cat_id}` | Lines 874-899 | Link a sighting to an existing cat |

### Current Limitations

1. **Weak location matching** - Simple tokenization misses semantic similarity
2. **No location validation** - User input not verified against real places
3. **No standardization** - "Central Park" vs "central park NYC" treated as different
4. **No coordinates** - Cannot calculate actual geographic distance
5. **No validation workflow** - No confirmation step to mark sightings as "same cat"

---

## Proposed Implementation

### Phase 1: Location Validation & Normalization via OpenStreetMap

**Goal**: Validate and harmonize location input using OpenStreetMap Nominatim API.

#### 1.1 OpenStreetMap Nominatim Integration

**Nominatim API** (free, no API key required for low volume):
- Base URL: `https://nominatim.openstreetmap.org`
- Rate limit: 1 request/second (must respect this)
- User-Agent required: Must identify your application

**New Helper Function:**

```python
import httpx
from typing import Optional
import time

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_USER_AGENT = "CatAtlas/1.0 (cat-sighting-tracker)"

# Rate limiting
_last_nominatim_call = 0.0

async def geocode_location(location: str) -> Optional[dict]:
    """
    Validate and normalize a location string using OpenStreetMap Nominatim.

    Returns:
        {
            "display_name": "Central Park, Manhattan, New York, USA",
            "lat": "40.7828647",
            "lon": "-73.9653551",
            "place_id": 123456,
            "osm_type": "way",
            "osm_id": 789012,
            "boundingbox": ["40.764...", "40.800...", "-73.981...", "-73.949..."],
            "class": "leisure",
            "type": "park"
        }
        or None if not found
    """
    global _last_nominatim_call

    # Respect rate limit (1 req/sec)
    elapsed = time.time() - _last_nominatim_call
    if elapsed < 1.0:
        await asyncio.sleep(1.0 - elapsed)

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
    return None
```

#### 1.2 Database Schema Changes

Add new columns to store normalized location data:

```sql
ALTER TABLE entries ADD COLUMN location_normalized TEXT;
ALTER TABLE entries ADD COLUMN location_lat REAL;
ALTER TABLE entries ADD COLUMN location_lon REAL;
ALTER TABLE entries ADD COLUMN location_osm_id TEXT;

-- Index for geographic queries
CREATE INDEX idx_entries_location_coords ON entries(location_lat, location_lon);
```

**Updated Entry Model:**

```python
class Entry(BaseModel):
    id: int
    text: str
    createdAt: str
    isFavorite: bool
    nickname: Optional[str] = None
    location: Optional[str] = None              # Original user input
    location_normalized: Optional[str] = None   # OpenStreetMap display_name
    location_lat: Optional[float] = None        # Latitude
    location_lon: Optional[float] = None        # Longitude
    location_osm_id: Optional[str] = None       # OSM identifier for dedup
    cat_id: Optional[int] = None
    photo_url: Optional[str] = None
```

#### 1.3 New Endpoint: Normalize Entry Location

```python
POST /entries/{entry_id}/normalize-location
```

**Description**: Validate and normalize the location of an existing entry using OpenStreetMap.

**Response Model:**

```python
class LocationNormalizationResult(BaseModel):
    entry_id: int
    original_location: str
    normalized_location: Optional[str]  # None if not found
    latitude: Optional[float]
    longitude: Optional[float]
    osm_id: Optional[str]
    status: str  # "success", "not_found", "already_normalized"
    suggestions: List[str]  # Alternative location suggestions if ambiguous
```

**Behavior:**
1. Fetch entry by ID
2. If location already normalized, return existing data
3. Call Nominatim API with original location
4. Store normalized data in entry
5. Return result

#### 1.4 Batch Normalization Endpoint

```python
POST /entries/normalize-locations
```

**Request Body:**

```python
class BatchNormalizeRequest(BaseModel):
    entry_ids: Optional[List[int]] = None  # If None, normalize all entries
    force: bool = False  # Re-normalize even if already done
```

**Description**: Normalize locations for multiple entries (respects rate limiting).

---

### Phase 2: Enhanced Location Matching

**Goal**: Use normalized coordinates for accurate geographic matching.

#### 2.1 Geographic Distance Calculation

```python
from math import radians, cos, sin, asin, sqrt

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great-circle distance between two points in meters.
    """
    R = 6371000  # Earth's radius in meters

    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a))

    return R * c
```

#### 2.2 Updated Match Scoring

```python
def compute_match_score(
    base_text: str,
    base_location: str,
    base_lat: Optional[float],
    base_lon: Optional[float],
    cand_text: str,
    cand_location: str,
    cand_lat: Optional[float],
    cand_lon: Optional[float],
) -> tuple[float, list[str]]:
    """
    Enhanced scoring with geographic distance.

    Weighting:
    - 50% text similarity
    - 50% location score (geographic if coords available, else text-based)
    """
    reasons: list[str] = []

    # Text similarity (unchanged)
    text_sim = jaccard_similarity(
        tokenize_keywords(base_text),
        tokenize_keywords(cand_text)
    )
    if text_sim > 0:
        reasons.append(f"text similarity {text_sim:.2f}")

    # Location score
    loc_score = 0.0

    if base_lat and base_lon and cand_lat and cand_lon:
        # Use geographic distance
        distance = haversine_distance(base_lat, base_lon, cand_lat, cand_lon)

        # Convert distance to similarity score (closer = higher)
        # 0m = 1.0, 100m = 0.9, 500m = 0.5, 1000m+ = 0.0
        if distance < 1000:
            loc_score = max(0.0, 1.0 - (distance / 1000))
            reasons.append(f"distance {distance:.0f}m (score {loc_score:.2f})")
        else:
            reasons.append(f"distance {distance:.0f}m (too far)")
    elif base_location and cand_location:
        # Fallback to text-based similarity
        loc_score = location_similarity(base_location, cand_location)
        if loc_score > 0:
            reasons.append(f"location text similarity {loc_score:.2f}")

    # Combined score (50/50 split)
    score = 0.5 * text_sim + 0.5 * loc_score

    if not reasons:
        reasons.append("low similarity")

    return score, reasons
```

#### 2.3 New Endpoint: Find Nearby Sightings

```python
GET /entries/{entry_id}/nearby
```

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `radius_meters` | int | No | Search radius (default: 500, max: 5000) |
| `top_k` | int | No | Max results (default: 10) |
| `include_assigned` | bool | No | Include sightings already linked to cats (default: true) |

**Response Model:**

```python
class NearbySighting(BaseModel):
    entry_id: int
    distance_meters: float
    location: str
    location_normalized: Optional[str]
    text_preview: str
    cat_id: Optional[int]
    cat_name: Optional[str]
    created_at: str
    match_score: float
    reasons: List[str]
```

**Behavior:**
1. Get entry coordinates
2. Find all entries within radius using haversine distance
3. Calculate match scores
4. Sort by distance/score
5. Return top_k results

---

### Phase 3: Validation Workflow

**Goal**: Allow users to confirm that multiple sightings are the same cat.

#### 3.1 Bulk Link Sightings to Cat

```python
POST /cats/{cat_id}/link-sightings
```

**Request Body:**

```python
class LinkSightingsRequest(BaseModel):
    entry_ids: List[int]
```

**Response:**

```python
class LinkSightingsResponse(BaseModel):
    cat_id: int
    linked_count: int
    already_linked: List[int]
    newly_linked: List[int]
    failed: List[int]
```

#### 3.2 Create Cat from Matched Sightings

```python
POST /cats/from-sightings
```

**Request Body:**

```python
class CreateCatFromSightingsRequest(BaseModel):
    entry_ids: List[int]
    name: Optional[str] = None
```

**Response**: Returns the new Cat with all sightings linked.

---

### Phase 4: Area-Based Clustering

**Goal**: View and manage sightings grouped by geographic area.

#### 4.1 Get Sightings by Area

```python
GET /entries/by-area
```

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `lat` | float | Yes* | Center latitude |
| `lon` | float | Yes* | Center longitude |
| `location` | string | Yes* | Or search by location name |
| `radius_meters` | int | No | Search radius (default: 1000) |

*Either `lat`+`lon` OR `location` required

**Response:**

```python
class AreaSightingsResponse(BaseModel):
    center_lat: float
    center_lon: float
    center_location: str
    radius_meters: int
    sightings: List[Entry]
    unique_cats: int
    unassigned_count: int
    suggested_groups: List[SuggestedGroup]
```

#### 4.2 Suggested Groupings

```python
class SuggestedGroup(BaseModel):
    confidence: float
    entry_ids: List[int]
    reason: str
    existing_cat_id: Optional[int]
    avg_distance_meters: float
```

---

## Database Migration

### Migration Script

```sql
-- Migration: Add location normalization fields
-- Version: 001_add_location_normalization

-- Add new columns
ALTER TABLE entries ADD COLUMN location_normalized TEXT;
ALTER TABLE entries ADD COLUMN location_lat REAL;
ALTER TABLE entries ADD COLUMN location_lon REAL;
ALTER TABLE entries ADD COLUMN location_osm_id TEXT;

-- Create spatial index
CREATE INDEX idx_entries_location_coords ON entries(location_lat, location_lon);
CREATE INDEX idx_entries_osm_id ON entries(location_osm_id);
```

---

## Implementation Priority

| Phase | Feature | Complexity | Impact |
|-------|---------|------------|--------|
| 1.1 | Nominatim integration | Medium | High |
| 1.2 | Schema changes | Low | High |
| 1.3 | Single location normalize endpoint | Low | High |
| 1.4 | Batch normalization | Low | Medium |
| 2.1 | Haversine distance | Low | High |
| 2.2 | Updated scoring | Medium | High |
| 2.3 | Nearby sightings endpoint | Medium | High |
| 3.1 | Bulk link sightings | Low | High |
| 3.2 | Create cat from sightings | Medium | High |
| 4.1 | Area-based query | Medium | Medium |
| 4.2 | Suggested groupings | High | Medium |

---

## API Flow Example

### User Story: "I spotted a cat at Central Park"

```
1. User creates sighting entry:
   POST /entries
   {
     "text": "Orange tabby cat at the fountain, very friendly",
     "location": "Central Park fountain"
   }
   Returns: entry_id: 55

2. System normalizes location (can be automatic or manual trigger):
   POST /entries/55/normalize-location

   Response:
   {
     "entry_id": 55,
     "original_location": "Central Park fountain",
     "normalized_location": "Bethesda Fountain, Central Park, Manhattan, NY",
     "latitude": 40.7736,
     "longitude": -73.9712,
     "osm_id": "way/123456",
     "status": "success"
   }

3. System finds nearby sightings:
   GET /entries/55/nearby?radius_meters=500

   Response:
   [
     {
       "entry_id": 42,
       "distance_meters": 150,
       "location": "Central Park entrance",
       "location_normalized": "Central Park, Manhattan, NY",
       "text_preview": "Orange tabby with white paws...",
       "cat_id": 5,
       "cat_name": "Marmalade",
       "match_score": 0.85,
       "reasons": ["distance 150m", "text similarity 0.70"]
     },
     {
       "entry_id": 38,
       "distance_meters": 320,
       "location": "Near park bench",
       "text_preview": "Tabby cat with orange fur...",
       "cat_id": null,
       "match_score": 0.62,
       "reasons": ["distance 320m", "text similarity 0.45"]
     }
   ]

4. App shows: "Found 2 sightings within 500m!"
   - "Marmalade" 150m away (85% match)
   - Unassigned sighting 320m away (62% match)

5. User confirms it's the same cat as entry 42:
   POST /entries/55/assign/5

   Now entry 55 is linked to cat "Marmalade" (cat_id: 5)

6. User also links entry 38 to same cat:
   POST /cats/5/link-sightings
   {
     "entry_ids": [38]
   }

   Now all 3 sightings are linked to "Marmalade"
```

---

## Configuration

### Environment Variables

```python
# config.py additions
class Settings(BaseSettings):
    # ... existing settings ...

    # OpenStreetMap Nominatim
    nominatim_url: str = "https://nominatim.openstreetmap.org/search"
    nominatim_user_agent: str = "CatAtlas/1.0"
    nominatim_rate_limit: float = 1.0  # seconds between requests

    # Location matching
    default_search_radius_m: int = 500
    max_search_radius_m: int = 5000
    auto_normalize_on_create: bool = False  # If true, normalize immediately on entry creation
```

---

## Testing Requirements

### Unit Tests

1. **Nominatim integration tests**
   - Successful geocoding
   - Location not found handling
   - Rate limit compliance
   - Network error handling

2. **Haversine distance tests**
   - Known distance calculations
   - Edge cases (same point, antipodal points)

3. **Match scoring tests**
   - With coordinates
   - Without coordinates (fallback)
   - Mixed (one has coords, other doesn't)

### Integration Tests

1. **Full workflow test**
   - Create sighting
   - Normalize location
   - Find nearby sightings
   - Link to cat
   - Verify all linked

2. **Batch normalization test**
   - Multiple entries
   - Rate limit respected
   - Partial failures handled

### Mock Tests (for CI/CD)

```python
# Mock Nominatim responses for testing
MOCK_NOMINATIM_RESPONSES = {
    "Central Park": {
        "display_name": "Central Park, Manhattan, New York, USA",
        "lat": "40.7828647",
        "lon": "-73.9653551",
        "osm_id": "123456",
    },
    # ... more mocks
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `backend/main.py` | Add endpoints, models, Nominatim client |
| `backend/config.py` | Add Nominatim settings |
| `backend/requirements.txt` | Add `httpx` for async HTTP |
| `backend/tests/test_api.py` | Add unit tests |
| `backend/tests/test_integration.py` | Add workflow tests |

---

## Dependencies

Add to `requirements.txt`:

```
httpx>=0.25.0  # Async HTTP client for Nominatim API
```

---

## Rate Limiting Considerations

**OpenStreetMap Nominatim Usage Policy:**
- Maximum 1 request per second
- Must provide valid User-Agent
- Bulk geocoding should use own Nominatim instance

**For Production (high volume):**
Consider self-hosting Nominatim or using alternatives:
- **Self-hosted Nominatim**: Docker image available
- **LocationIQ**: Free tier 5000 req/day
- **Mapbox Geocoding**: 100k req/month free
- **Google Geocoding**: Pay-per-use, very accurate

---

## Success Metrics

1. **Location normalization rate** - % of entries successfully geocoded
2. **Geographic match accuracy** - Precision of distance-based matching
3. **Deduplication rate** - % of sightings linked to cats after nearby suggestions
4. **User confirmation rate** - % of suggested matches that users confirm

---

## Resilience Design Patterns

### 1. Circuit Breaker for Nominatim API

Prevent cascading failures when the external geocoding service is unavailable.

```python
from enum import Enum
from dataclasses import dataclass
from datetime import datetime, timedelta
import asyncio

class CircuitState(Enum):
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing if service recovered

@dataclass
class CircuitBreaker:
    failure_threshold: int = 5        # Failures before opening
    recovery_timeout: float = 60.0    # Seconds before trying again
    half_open_max_calls: int = 3      # Test calls in half-open state

    _failure_count: int = 0
    _last_failure_time: Optional[datetime] = None
    _state: CircuitState = CircuitState.CLOSED
    _half_open_calls: int = 0

    def can_execute(self) -> bool:
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

    def record_success(self):
        if self._state == CircuitState.HALF_OPEN:
            self._half_open_calls += 1
            if self._half_open_calls >= self.half_open_max_calls:
                self._state = CircuitState.CLOSED
                self._failure_count = 0
        else:
            self._failure_count = 0

    def record_failure(self):
        self._failure_count += 1
        self._last_failure_time = datetime.now()
        if self._failure_count >= self.failure_threshold:
            self._state = CircuitState.OPEN

# Global circuit breaker instance
nominatim_circuit = CircuitBreaker()
```

### 2. Retry with Exponential Backoff

Handle transient failures gracefully.

```python
import random
from typing import TypeVar, Callable, Awaitable

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
```

### 3. Fallback Strategy

Graceful degradation when geocoding fails.

```python
async def geocode_with_fallback(location: str) -> dict:
    """
    Attempt geocoding with multiple fallback strategies.

    Fallback order:
    1. OpenStreetMap Nominatim (primary)
    2. Cached results for similar locations
    3. Text-based location matching (no coordinates)
    """
    # Check circuit breaker
    if not nominatim_circuit.can_execute():
        return await fallback_to_cache_or_text(location)

    try:
        result = await retry_with_backoff(
            lambda: geocode_location(location),
            max_retries=2,
        )
        if result:
            nominatim_circuit.record_success()
            # Cache successful result
            await cache_geocode_result(location, result)
            return result
    except Exception as e:
        nominatim_circuit.record_failure()
        logger.warning(f"Geocoding failed for '{location}': {e}")

    return await fallback_to_cache_or_text(location)


async def fallback_to_cache_or_text(location: str) -> dict:
    """
    Fallback when primary geocoding fails.
    """
    # Try to find similar cached location
    cached = await find_similar_cached_location(location)
    if cached:
        return {
            "display_name": cached["location_normalized"],
            "lat": cached["location_lat"],
            "lon": cached["location_lon"],
            "fallback": "cache",
        }

    # Return text-only result (no coordinates)
    return {
        "display_name": location,
        "lat": None,
        "lon": None,
        "fallback": "text_only",
    }
```

### 4. Request Timeout and Cancellation

Prevent hanging requests.

```python
async def geocode_location_safe(location: str, timeout: float = 10.0) -> Optional[dict]:
    """
    Geocode with timeout protection.
    """
    try:
        return await asyncio.wait_for(
            geocode_location(location),
            timeout=timeout
        )
    except asyncio.TimeoutError:
        logger.warning(f"Geocoding timeout for '{location}'")
        return None
    except asyncio.CancelledError:
        logger.info(f"Geocoding cancelled for '{location}'")
        raise
```

### 5. Bulkhead Pattern for Batch Operations

Isolate batch normalization to prevent resource exhaustion.

```python
from asyncio import Semaphore

# Limit concurrent geocoding operations
GEOCODE_SEMAPHORE = Semaphore(5)  # Max 5 concurrent (respecting rate limit)

async def batch_normalize_with_bulkhead(entry_ids: List[int]) -> dict:
    """
    Normalize multiple entries with controlled concurrency.
    """
    results = {
        "success": [],
        "failed": [],
        "skipped": [],
    }

    async def process_entry(entry_id: int):
        async with GEOCODE_SEMAPHORE:
            # Rate limit: 1 req/sec
            await asyncio.sleep(1.0)
            try:
                result = await normalize_entry_location(entry_id)
                results["success"].append(entry_id)
                return result
            except Exception as e:
                results["failed"].append({"id": entry_id, "error": str(e)})
                return None

    # Process with controlled concurrency
    tasks = [process_entry(eid) for eid in entry_ids]
    await asyncio.gather(*tasks, return_exceptions=True)

    return results
```

### 6. Health Check Endpoint

Monitor geocoding service availability.

```python
@app.get("/health/geocoding")
async def geocoding_health():
    """
    Health check for geocoding service.
    """
    return {
        "service": "nominatim",
        "circuit_state": nominatim_circuit._state.value,
        "failure_count": nominatim_circuit._failure_count,
        "last_failure": nominatim_circuit._last_failure_time.isoformat()
            if nominatim_circuit._last_failure_time else None,
        "status": "healthy" if nominatim_circuit._state == CircuitState.CLOSED else "degraded",
    }
```

---

## Automated Tests

### Test Structure

```
backend/tests/
├── conftest.py                    # Shared fixtures
├── test_api.py                    # Existing API tests
├── test_integration.py            # Existing integration tests
├── test_geocoding.py              # NEW: Geocoding tests
├── test_location_matching.py      # NEW: Location matching tests
├── test_resilience.py             # NEW: Resilience pattern tests
└── mocks/
    └── nominatim_responses.py     # Mock geocoding responses
```

### 1. Geocoding Unit Tests (`test_geocoding.py`)

```python
import pytest
from unittest.mock import AsyncMock, patch
from httpx import Response

# Import from main module
from main import (
    geocode_location,
    haversine_distance,
    normalize_entry_location,
)


class TestHaversineDistance:
    """Test geographic distance calculations."""

    def test_same_point_returns_zero(self):
        """Distance from a point to itself should be 0."""
        dist = haversine_distance(40.7128, -74.0060, 40.7128, -74.0060)
        assert dist == 0.0

    def test_known_distance_nyc_to_la(self):
        """Test with known distance: NYC to LA ~3944km."""
        nyc = (40.7128, -74.0060)
        la = (34.0522, -118.2437)
        dist = haversine_distance(*nyc, *la)
        # Allow 1% tolerance
        assert 3900000 < dist < 4000000  # meters

    def test_short_distance_accuracy(self):
        """Test accuracy for short distances (< 1km)."""
        # Two points ~500m apart in Central Park
        point1 = (40.7829, -73.9654)
        point2 = (40.7874, -73.9654)
        dist = haversine_distance(*point1, *point2)
        assert 490 < dist < 510  # ~500 meters

    def test_antipodal_points(self):
        """Test maximum distance (antipodal points)."""
        dist = haversine_distance(0, 0, 0, 180)
        # Half Earth circumference ~20000km
        assert 20000000 < dist < 20100000


class TestGeocodeLocation:
    """Test OpenStreetMap Nominatim integration."""

    @pytest.fixture
    def mock_nominatim_response(self):
        return [{
            "display_name": "Central Park, Manhattan, New York, USA",
            "lat": "40.7828647",
            "lon": "-73.9653551",
            "place_id": 123456,
            "osm_id": "789012",
            "osm_type": "way",
        }]

    @pytest.mark.asyncio
    async def test_successful_geocoding(self, mock_nominatim_response):
        """Test successful location geocoding."""
        with patch('httpx.AsyncClient.get') as mock_get:
            mock_get.return_value = AsyncMock(
                status_code=200,
                json=lambda: mock_nominatim_response
            )

            result = await geocode_location("Central Park")

            assert result is not None
            assert result["display_name"] == "Central Park, Manhattan, New York, USA"
            assert float(result["lat"]) == pytest.approx(40.7828647)
            assert float(result["lon"]) == pytest.approx(-73.9653551)

    @pytest.mark.asyncio
    async def test_location_not_found(self):
        """Test handling of unknown location."""
        with patch('httpx.AsyncClient.get') as mock_get:
            mock_get.return_value = AsyncMock(
                status_code=200,
                json=lambda: []  # Empty results
            )

            result = await geocode_location("xyznonexistentplace123")

            assert result is None

    @pytest.mark.asyncio
    async def test_api_error_handling(self):
        """Test handling of API errors."""
        with patch('httpx.AsyncClient.get') as mock_get:
            mock_get.return_value = AsyncMock(status_code=500)

            result = await geocode_location("Central Park")

            assert result is None

    @pytest.mark.asyncio
    async def test_network_timeout(self):
        """Test handling of network timeout."""
        with patch('httpx.AsyncClient.get') as mock_get:
            mock_get.side_effect = TimeoutError("Connection timed out")

            result = await geocode_location("Central Park")

            assert result is None

    @pytest.mark.asyncio
    async def test_rate_limiting_respected(self):
        """Test that rate limiting is enforced."""
        import time

        with patch('httpx.AsyncClient.get') as mock_get:
            mock_get.return_value = AsyncMock(
                status_code=200,
                json=lambda: [{"display_name": "Test", "lat": "0", "lon": "0"}]
            )

            start = time.time()
            await geocode_location("Location 1")
            await geocode_location("Location 2")
            elapsed = time.time() - start

            # Should take at least 1 second due to rate limiting
            assert elapsed >= 1.0


class TestNormalizeEntryLocation:
    """Test entry location normalization endpoint logic."""

    @pytest.mark.asyncio
    async def test_normalize_new_location(self, client, mock_nominatim_response):
        """Test normalizing a location for the first time."""
        # Create entry
        entry = client.post("/entries", json={
            "text": "Cat sighting",
            "location": "Central Park"
        }).json()

        with patch('main.geocode_location') as mock_geo:
            mock_geo.return_value = mock_nominatim_response[0]

            response = client.post(f"/entries/{entry['id']}/normalize-location")

            assert response.status_code == 200
            result = response.json()
            assert result["status"] == "success"
            assert result["normalized_location"] == "Central Park, Manhattan, New York, USA"
            assert result["latitude"] == pytest.approx(40.7828647)

    @pytest.mark.asyncio
    async def test_already_normalized_returns_existing(self, client):
        """Test that already normalized entries return cached data."""
        # Create and normalize entry
        entry = client.post("/entries", json={
            "text": "Cat sighting",
            "location": "Central Park"
        }).json()

        # First normalization
        with patch('main.geocode_location') as mock_geo:
            mock_geo.return_value = {"display_name": "Test", "lat": "1.0", "lon": "2.0"}
            client.post(f"/entries/{entry['id']}/normalize-location")

        # Second normalization should not call API
        with patch('main.geocode_location') as mock_geo:
            response = client.post(f"/entries/{entry['id']}/normalize-location")
            mock_geo.assert_not_called()

        assert response.json()["status"] == "already_normalized"

    @pytest.mark.asyncio
    async def test_normalize_entry_without_location(self, client):
        """Test normalizing entry with no location returns appropriate error."""
        entry = client.post("/entries", json={
            "text": "Cat sighting without location"
        }).json()

        response = client.post(f"/entries/{entry['id']}/normalize-location")

        assert response.status_code == 400
        assert "no location" in response.json()["detail"].lower()
```

### 2. Location Matching Tests (`test_location_matching.py`)

```python
import pytest
from main import (
    compute_match_score,
    location_similarity,
    tokenize_keywords,
)


class TestLocationSimilarity:
    """Test text-based location similarity."""

    def test_identical_locations(self):
        """Identical locations should have similarity 1.0."""
        sim = location_similarity("Central Park", "Central Park")
        assert sim == 1.0

    def test_similar_locations(self):
        """Similar locations should have high similarity."""
        sim = location_similarity("Central Park entrance", "Central Park exit")
        assert sim > 0.5

    def test_different_locations(self):
        """Different locations should have low similarity."""
        sim = location_similarity("Central Park", "Times Square")
        assert sim < 0.3

    def test_case_insensitivity(self):
        """Location matching should be case insensitive."""
        sim1 = location_similarity("Central Park", "central park")
        assert sim1 == 1.0

    def test_empty_locations(self):
        """Empty locations should return 0."""
        assert location_similarity("", "") == 0.0
        assert location_similarity("Central Park", "") == 0.0


class TestComputeMatchScore:
    """Test combined text + location scoring."""

    def test_high_match_same_location_similar_text(self):
        """High score for same location and similar description."""
        score, reasons = compute_match_score(
            base_text="Orange tabby cat with white paws",
            base_location="Central Park",
            base_lat=40.7829,
            base_lon=-73.9654,
            cand_text="Orange tabby with white feet",
            cand_location="Central Park",
            cand_lat=40.7829,
            cand_lon=-73.9654,
        )
        assert score > 0.7
        assert any("distance" in r for r in reasons)

    def test_nearby_locations_boost_score(self):
        """Nearby coordinates should boost the match score."""
        # Same text, nearby locations
        score_near, _ = compute_match_score(
            base_text="Orange cat",
            base_location="Park",
            base_lat=40.7829,
            base_lon=-73.9654,
            cand_text="Orange cat",
            cand_location="Park",
            cand_lat=40.7830,  # ~10m away
            cand_lon=-73.9654,
        )

        # Same text, far locations
        score_far, _ = compute_match_score(
            base_text="Orange cat",
            base_location="Park",
            base_lat=40.7829,
            base_lon=-73.9654,
            cand_text="Orange cat",
            cand_location="Other Park",
            cand_lat=40.8000,  # ~2km away
            cand_lon=-73.9654,
        )

        assert score_near > score_far

    def test_fallback_to_text_matching_without_coords(self):
        """Should use text-based matching when coordinates unavailable."""
        score, reasons = compute_match_score(
            base_text="Orange cat at park",
            base_location="Central Park",
            base_lat=None,
            base_lon=None,
            cand_text="Orange cat near park",
            cand_location="Central Park entrance",
            cand_lat=None,
            cand_lon=None,
        )
        assert score > 0
        assert any("text similarity" in r for r in reasons)
        assert not any("distance" in r for r in reasons)

    def test_reasons_explain_score(self):
        """Reasons should explain the score components."""
        _, reasons = compute_match_score(
            base_text="Cat",
            base_location="Park",
            base_lat=40.0,
            base_lon=-74.0,
            cand_text="Cat",
            cand_location="Park",
            cand_lat=40.001,
            cand_lon=-74.0,
        )
        # Should have both text and distance reasons
        assert len(reasons) >= 1


class TestNearbyEndpoint:
    """Test the /entries/{id}/nearby endpoint."""

    def test_find_nearby_sightings(self, client):
        """Test finding sightings within radius."""
        # Create entries with normalized locations
        entries = []
        locations = [
            ("40.7829", "-73.9654"),  # Central Park
            ("40.7835", "-73.9650"),  # ~60m away
            ("40.7900", "-73.9600"),  # ~800m away
            ("40.8500", "-73.9000"),  # ~8km away (outside default radius)
        ]

        for i, (lat, lon) in enumerate(locations):
            entry = client.post("/entries", json={
                "text": f"Cat sighting {i}",
                "location": f"Location {i}"
            }).json()
            # Manually set coordinates (simulating normalization)
            # In real tests, would use proper DB fixtures
            entries.append(entry)

        # Find nearby for first entry
        response = client.get(
            f"/entries/{entries[0]['id']}/nearby",
            params={"radius_meters": 500}
        )

        assert response.status_code == 200
        nearby = response.json()

        # Should find entries within 500m but not 8km away
        nearby_ids = [n["entry_id"] for n in nearby]
        assert entries[1]["id"] in nearby_ids  # 60m away
        assert entries[3]["id"] not in nearby_ids  # 8km away

    def test_nearby_respects_radius_parameter(self, client):
        """Test that radius parameter is respected."""
        # Similar setup as above, test with different radii
        pass

    def test_nearby_includes_cat_info(self, client):
        """Test that nearby results include cat information."""
        pass
```

### 3. Resilience Pattern Tests (`test_resilience.py`)

```python
import pytest
import asyncio
from unittest.mock import AsyncMock, patch
from main import (
    CircuitBreaker,
    CircuitState,
    retry_with_backoff,
    geocode_with_fallback,
)


class TestCircuitBreaker:
    """Test circuit breaker implementation."""

    def test_initial_state_is_closed(self):
        """Circuit should start in closed state."""
        cb = CircuitBreaker()
        assert cb._state == CircuitState.CLOSED
        assert cb.can_execute() is True

    def test_opens_after_threshold_failures(self):
        """Circuit should open after reaching failure threshold."""
        cb = CircuitBreaker(failure_threshold=3)

        for _ in range(3):
            cb.record_failure()

        assert cb._state == CircuitState.OPEN
        assert cb.can_execute() is False

    def test_success_resets_failure_count(self):
        """Success should reset the failure count."""
        cb = CircuitBreaker(failure_threshold=3)

        cb.record_failure()
        cb.record_failure()
        cb.record_success()

        assert cb._failure_count == 0
        assert cb._state == CircuitState.CLOSED

    @pytest.mark.asyncio
    async def test_transitions_to_half_open_after_timeout(self):
        """Circuit should transition to half-open after recovery timeout."""
        cb = CircuitBreaker(failure_threshold=1, recovery_timeout=0.1)

        cb.record_failure()
        assert cb._state == CircuitState.OPEN
        assert cb.can_execute() is False

        # Wait for recovery timeout
        await asyncio.sleep(0.15)

        assert cb.can_execute() is True
        assert cb._state == CircuitState.HALF_OPEN

    def test_half_open_closes_after_successes(self):
        """Circuit should close after successful calls in half-open state."""
        cb = CircuitBreaker(failure_threshold=1, half_open_max_calls=2)

        # Open the circuit
        cb.record_failure()
        cb._state = CircuitState.HALF_OPEN  # Simulate timeout elapsed

        # Successful calls in half-open
        cb.record_success()
        cb.record_success()

        assert cb._state == CircuitState.CLOSED

    def test_half_open_reopens_on_failure(self):
        """Circuit should reopen if failure occurs in half-open state."""
        cb = CircuitBreaker(failure_threshold=1)

        cb.record_failure()
        cb._state = CircuitState.HALF_OPEN

        cb.record_failure()

        assert cb._state == CircuitState.OPEN


class TestRetryWithBackoff:
    """Test retry mechanism with exponential backoff."""

    @pytest.mark.asyncio
    async def test_succeeds_on_first_try(self):
        """Should return immediately on success."""
        mock_func = AsyncMock(return_value="success")

        result = await retry_with_backoff(mock_func, max_retries=3)

        assert result == "success"
        assert mock_func.call_count == 1

    @pytest.mark.asyncio
    async def test_retries_on_failure(self):
        """Should retry on failure."""
        mock_func = AsyncMock(side_effect=[Exception("fail"), "success"])

        result = await retry_with_backoff(
            mock_func,
            max_retries=3,
            base_delay=0.01  # Fast for testing
        )

        assert result == "success"
        assert mock_func.call_count == 2

    @pytest.mark.asyncio
    async def test_raises_after_max_retries(self):
        """Should raise exception after exhausting retries."""
        mock_func = AsyncMock(side_effect=Exception("persistent failure"))

        with pytest.raises(Exception, match="persistent failure"):
            await retry_with_backoff(
                mock_func,
                max_retries=2,
                base_delay=0.01
            )

        assert mock_func.call_count == 3  # Initial + 2 retries

    @pytest.mark.asyncio
    async def test_exponential_delay(self):
        """Should increase delay exponentially between retries."""
        import time

        mock_func = AsyncMock(side_effect=[
            Exception("1"),
            Exception("2"),
            "success"
        ])

        start = time.time()
        await retry_with_backoff(
            mock_func,
            max_retries=3,
            base_delay=0.1,
            jitter=False  # Disable jitter for predictable timing
        )
        elapsed = time.time() - start

        # Should have delays of 0.1s and 0.2s = 0.3s total
        assert elapsed >= 0.25  # Allow some tolerance


class TestGeocodeFallback:
    """Test geocoding fallback strategies."""

    @pytest.mark.asyncio
    async def test_uses_primary_when_available(self):
        """Should use primary geocoding when available."""
        with patch('main.geocode_location') as mock_geo:
            mock_geo.return_value = {
                "display_name": "Test Location",
                "lat": "1.0",
                "lon": "2.0"
            }

            result = await geocode_with_fallback("Test")

            assert result["display_name"] == "Test Location"
            assert "fallback" not in result

    @pytest.mark.asyncio
    async def test_falls_back_to_cache_on_failure(self):
        """Should use cached results when primary fails."""
        with patch('main.geocode_location') as mock_geo, \
             patch('main.find_similar_cached_location') as mock_cache:
            mock_geo.side_effect = Exception("API error")
            mock_cache.return_value = {
                "location_normalized": "Cached Location",
                "location_lat": 1.0,
                "location_lon": 2.0
            }

            result = await geocode_with_fallback("Test")

            assert result["fallback"] == "cache"
            assert result["display_name"] == "Cached Location"

    @pytest.mark.asyncio
    async def test_falls_back_to_text_when_no_cache(self):
        """Should return text-only when no cache available."""
        with patch('main.geocode_location') as mock_geo, \
             patch('main.find_similar_cached_location') as mock_cache:
            mock_geo.side_effect = Exception("API error")
            mock_cache.return_value = None

            result = await geocode_with_fallback("Unknown Place")

            assert result["fallback"] == "text_only"
            assert result["display_name"] == "Unknown Place"
            assert result["lat"] is None

    @pytest.mark.asyncio
    async def test_respects_circuit_breaker(self):
        """Should not call API when circuit is open."""
        with patch('main.nominatim_circuit') as mock_circuit, \
             patch('main.geocode_location') as mock_geo:
            mock_circuit.can_execute.return_value = False

            await geocode_with_fallback("Test")

            mock_geo.assert_not_called()


class TestBatchNormalization:
    """Test batch location normalization with bulkhead pattern."""

    @pytest.mark.asyncio
    async def test_processes_entries_with_rate_limit(self):
        """Should process entries respecting rate limit."""
        import time

        with patch('main.normalize_entry_location') as mock_norm:
            mock_norm.return_value = {"status": "success"}

            start = time.time()
            result = await batch_normalize_with_bulkhead([1, 2, 3])
            elapsed = time.time() - start

            # 3 entries with 1s rate limit = at least 2s
            assert elapsed >= 2.0
            assert len(result["success"]) == 3

    @pytest.mark.asyncio
    async def test_handles_partial_failures(self):
        """Should continue processing after individual failures."""
        with patch('main.normalize_entry_location') as mock_norm:
            mock_norm.side_effect = [
                {"status": "success"},
                Exception("Failed"),
                {"status": "success"},
            ]

            result = await batch_normalize_with_bulkhead([1, 2, 3])

            assert len(result["success"]) == 2
            assert len(result["failed"]) == 1

    @pytest.mark.asyncio
    async def test_respects_concurrency_limit(self):
        """Should not exceed max concurrent operations."""
        # Track concurrent executions
        concurrent = 0
        max_concurrent = 0

        async def track_concurrent(entry_id):
            nonlocal concurrent, max_concurrent
            concurrent += 1
            max_concurrent = max(max_concurrent, concurrent)
            await asyncio.sleep(0.1)
            concurrent -= 1
            return {"status": "success"}

        with patch('main.normalize_entry_location', side_effect=track_concurrent):
            await batch_normalize_with_bulkhead(list(range(10)))

        # Should not exceed semaphore limit (5)
        assert max_concurrent <= 5
```

### 4. Integration Tests (`test_integration.py` additions)

```python
class TestLocationDeduplicationWorkflow:
    """End-to-end tests for location-based deduplication."""

    def test_full_deduplication_workflow(self, client):
        """
        Test complete workflow:
        1. Create multiple sightings in same area
        2. Normalize locations
        3. Find nearby sightings
        4. Link to same cat
        """
        # Step 1: Create sightings
        sighting1 = client.post("/entries", json={
            "text": "Orange tabby cat, very friendly",
            "location": "Central Park fountain"
        }).json()

        sighting2 = client.post("/entries", json={
            "text": "Tabby cat with orange fur",
            "location": "Central Park near fountain"
        }).json()

        sighting3 = client.post("/entries", json={
            "text": "Friendly orange cat",
            "location": "Central Park bench"
        }).json()

        # Step 2: Normalize locations (mocked)
        with patch('main.geocode_location') as mock_geo:
            mock_geo.side_effect = [
                {"display_name": "Bethesda Fountain, Central Park", "lat": "40.7736", "lon": "-73.9712"},
                {"display_name": "Central Park, near fountain", "lat": "40.7740", "lon": "-73.9710"},
                {"display_name": "Central Park bench area", "lat": "40.7750", "lon": "-73.9700"},
            ]

            for s in [sighting1, sighting2, sighting3]:
                resp = client.post(f"/entries/{s['id']}/normalize-location")
                assert resp.status_code == 200

        # Step 3: Find nearby sightings
        nearby_resp = client.get(
            f"/entries/{sighting1['id']}/nearby",
            params={"radius_meters": 500}
        )
        assert nearby_resp.status_code == 200
        nearby = nearby_resp.json()

        # Should find the other 2 sightings
        nearby_ids = [n["entry_id"] for n in nearby]
        assert sighting2["id"] in nearby_ids
        assert sighting3["id"] in nearby_ids

        # Step 4: Create cat and link sightings
        cat_resp = client.post("/cats/from-sightings", json={
            "entry_ids": [sighting1["id"], sighting2["id"], sighting3["id"]],
            "name": "Marmalade"
        })
        assert cat_resp.status_code == 200
        cat = cat_resp.json()

        # Step 5: Verify all linked
        profile = client.get(f"/cats/{cat['id']}/profile").json()
        assert profile["sighting_count"] == 3

    def test_graceful_degradation_when_geocoding_fails(self, client):
        """
        Test that system works even when geocoding is unavailable.
        """
        # Create sighting
        sighting = client.post("/entries", json={
            "text": "Cat sighting",
            "location": "Some Park"
        }).json()

        # Normalization fails
        with patch('main.geocode_location') as mock_geo:
            mock_geo.side_effect = Exception("Service unavailable")

            resp = client.post(f"/entries/{sighting['id']}/normalize-location")

            # Should still return a response (degraded)
            assert resp.status_code == 200
            result = resp.json()
            assert result["status"] in ["not_found", "fallback"]

        # Matching should still work with text-based fallback
        matches_resp = client.get(f"/entries/{sighting['id']}/matches")
        assert matches_resp.status_code == 200
```

### 5. Test Fixtures (`conftest.py` additions)

```python
import pytest
from unittest.mock import patch

@pytest.fixture
def mock_nominatim():
    """Mock Nominatim API responses."""
    responses = {
        "Central Park": {
            "display_name": "Central Park, Manhattan, New York, USA",
            "lat": "40.7828647",
            "lon": "-73.9653551",
            "osm_id": "123456",
        },
        "Times Square": {
            "display_name": "Times Square, Manhattan, New York, USA",
            "lat": "40.7580",
            "lon": "-73.9855",
            "osm_id": "789012",
        },
    }

    def mock_geocode(location):
        for key, value in responses.items():
            if key.lower() in location.lower():
                return value
        return None

    with patch('main.geocode_location', side_effect=mock_geocode):
        yield responses


@pytest.fixture
def reset_circuit_breaker():
    """Reset circuit breaker state between tests."""
    from main import nominatim_circuit, CircuitState

    yield

    nominatim_circuit._state = CircuitState.CLOSED
    nominatim_circuit._failure_count = 0
    nominatim_circuit._last_failure_time = None
```

---

## Future Enhancements (Out of Scope)

- Reverse geocoding (coords → address) for photo EXIF data
- Map visualization of sightings
- Image-based cat recognition
- Push notifications for new sightings in watched areas
- Offline geocoding with local database
