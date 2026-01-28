# Cat Profile Page - Implementation Plan

**Document Version:** 1.0
**Target Timeline:** 1-2 weeks (incremental delivery)
**Status:** Planning

---

## Executive Summary

This document outlines the implementation plan for a dedicated "Cat Profile" page in the CatAtlas application. Each tracked cat will have its own page displaying aggregated sightings, location history, photos, community updates, and AI-generated insights.

---

## Table of Contents

1. [High-Level Architecture Options](#1-high-level-architecture-options)
2. [Recommended Approach](#2-recommended-approach)
3. [Backend Implementation](#3-backend-implementation)
4. [Frontend Implementation](#4-frontend-implementation)
5. [Testing Strategy](#5-testing-strategy)
6. [Resiliency & Robustness](#6-resiliency--robustness)
7. [Incremental Delivery Plan](#7-incremental-delivery-plan)
8. [API Contracts](#8-api-contracts)

---

## 1. High-Level Architecture Options

### Option A: Single Monolithic Endpoint

**Description:** One large `/cats/{id}/page` endpoint returns all data needed for the profile page in a single response.

```
GET /cats/{id}/page → {profile, sightings, photos, insights, stats}
```

**Pros:**
- Single network request
- Simple frontend data fetching
- Easy to cache at CDN level

**Cons:**
- Slow initial load (waits for everything)
- All-or-nothing failure mode
- Wasteful if user only views partial content
- Harder to test individual components

**Verdict:** ❌ Not recommended - poor UX for slow connections, violates "ship small" principle

---

### Option B: Micro-Endpoints (Fully Decomposed)

**Description:** Separate endpoints for each data type, fetched independently by frontend.

```
GET /cats/{id}                    → basic profile
GET /cats/{id}/sightings          → paginated sightings
GET /cats/{id}/photos             → photo gallery
GET /cats/{id}/locations          → location history
GET /cats/{id}/insights           → AI insights
GET /cats/{id}/stats              → aggregated stats
GET /cats/{id}/timeline           → activity timeline
```

**Pros:**
- Maximum flexibility
- Independent failure handling
- Parallel loading possible
- Fine-grained caching

**Cons:**
- Many network requests (waterfall risk)
- Complex frontend orchestration
- Harder to ensure data consistency
- Over-engineered for current scale

**Verdict:** ⚠️ Partially recommended - good structure, but too many initial endpoints

---

### Option C: Hybrid Approach (Recommended) ✅

**Description:** Core profile endpoint with essential data, supplemented by on-demand endpoints for heavy/optional content.

```
GET /cats/{id}/profile            → core data + recent activity (fast)
GET /cats/{id}/sightings?page=N   → paginated sightings (lazy load)
GET /cats/{id}/insights?mode=X    → AI insights (on-demand, existing)
```

**Pros:**
- Fast initial render with core data
- Heavy content loads progressively
- Graceful partial failures
- Leverages existing endpoints
- Simple to implement incrementally

**Cons:**
- Requires frontend loading state management
- Slightly more complex than Option A

**Verdict:** ✅ Recommended - balances simplicity with performance

---

## 2. Recommended Approach

### Architecture Decision

**Adopt Option C (Hybrid)** with the following structure:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Cat Profile Page                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Header: Name, Photo, Quick Stats                         │  │
│  │  (from GET /cats/{id}/profile - CRITICAL PATH)            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─────────────────────┐  ┌─────────────────────────────────┐  │
│  │  Location History   │  │  AI Insights                    │  │
│  │  (embedded in core) │  │  (lazy load on tab switch)      │  │
│  └─────────────────────┘  └─────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Sightings Timeline (paginated, infinite scroll)          │  │
│  │  GET /cats/{id}/sightings?page=N&limit=10                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Photo Gallery (lazy load thumbnails)                     │  │
│  │  (photos extracted from sightings, client-side)           │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Justification

1. **Leverages Existing Code:** Builds on current `/cats/{id}/profile` and insight endpoints
2. **Progressive Enhancement:** Core content loads fast, extras load on demand
3. **Mobile-Friendly:** Small initial payload, pagination prevents memory issues
4. **Resilient:** Insights failing doesn't break the whole page
5. **Testable:** Each endpoint can be unit tested independently
6. **Incremental:** v0 can ship with just the core profile, expand in v1

---

## 3. Backend Implementation

### 3.1 New/Modified Endpoints

#### 3.1.1 Enhanced Cat Profile Endpoint

**Endpoint:** `GET /cats/{id}/profile`
**Status:** Modify existing endpoint

**Current Response:**
```json
{
  "cat": {"id": 1, "name": "Whiskers", "createdAt": "..."},
  "sightings": [...all sightings...],
  "insights": {...}
}
```

**Enhanced Response:**
```json
{
  "cat": {
    "id": 1,
    "name": "Whiskers",
    "createdAt": "2024-01-15T10:30:00Z",
    "primaryPhoto": "https://cdn.example.com/cats/1/primary.jpg"
  },
  "stats": {
    "totalSightings": 47,
    "uniqueLocations": 12,
    "photoCount": 23,
    "firstSeen": "2024-01-15T10:30:00Z",
    "lastSeen": "2024-03-20T14:45:00Z",
    "mostFrequentLocation": "Maple Street Park"
  },
  "recentSightings": [
    // Last 5 sightings (preview)
  ],
  "locationSummary": [
    {"location": "Maple Street Park", "count": 15, "lastSeen": "2024-03-20"},
    {"location": "Oak Avenue", "count": 8, "lastSeen": "2024-03-18"}
  ],
  "insightStatus": {
    "hasProfile": true,
    "hasCare": false,
    "hasUpdate": true,
    "hasRisk": false,
    "lastUpdated": "2024-03-19T12:00:00Z"
  }
}
```

#### 3.1.2 Paginated Sightings Endpoint

**Endpoint:** `GET /cats/{id}/sightings`
**Status:** New endpoint

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | int | 1 | Page number (1-indexed) |
| `limit` | int | 10 | Items per page (max 50) |
| `sort` | string | "desc" | Sort order: "asc" or "desc" |
| `has_photo` | bool | null | Filter by photo presence |

**Response:**
```json
{
  "items": [
    {
      "id": 123,
      "text": "Spotted near the fountain",
      "createdAt": "2024-03-20T14:45:00Z",
      "location": "Maple Street Park",
      "location_normalized": "Maple Street Park, Downtown",
      "location_lat": 40.7128,
      "location_lon": -74.0060,
      "photo_url": "https://cdn.example.com/sightings/123.jpg",
      "isFavorite": true,
      "analysis": {
        "summary": "...",
        "sentiment": "positive"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "totalItems": 47,
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

#### 3.1.3 Location History Endpoint (Optional - v1)

**Endpoint:** `GET /cats/{id}/locations`
**Status:** New endpoint (v1)

**Response:**
```json
{
  "locations": [
    {
      "location": "Maple Street Park",
      "location_normalized": "Maple Street Park, Downtown, City",
      "lat": 40.7128,
      "lon": -74.0060,
      "sightingCount": 15,
      "firstSeen": "2024-01-20T10:00:00Z",
      "lastSeen": "2024-03-20T14:45:00Z",
      "photos": ["url1", "url2"]
    }
  ],
  "totalLocations": 12
}
```

### 3.2 Error Codes & Failure Modes

| HTTP Code | Error Type | Scenario | Client Behavior |
|-----------|------------|----------|-----------------|
| 200 | Success | Normal response | Render data |
| 400 | `INVALID_PAGE` | page < 1 or limit > 50 | Show validation error |
| 404 | `CAT_NOT_FOUND` | Cat ID doesn't exist | Show "Cat not found" page |
| 404 | `NO_SIGHTINGS` | Cat exists but has no sightings | Show empty state |
| 500 | `DATABASE_ERROR` | DB connection failed | Show retry button |
| 503 | `SERVICE_UNAVAILABLE` | Geocoding service down | Show degraded mode |

**Error Response Format:**
```json
{
  "detail": {
    "code": "CAT_NOT_FOUND",
    "message": "Cat with ID 999 not found",
    "retryable": false
  }
}
```

### 3.3 Pagination Strategy

**Offset-Based Pagination** (chosen for simplicity):

```python
# Backend implementation
offset = (page - 1) * limit
sightings = db.execute(
    """
    SELECT * FROM entries
    WHERE cat_id = ?
    ORDER BY createdAt DESC
    LIMIT ? OFFSET ?
    """,
    (cat_id, limit, offset)
).fetchall()

total = db.execute(
    "SELECT COUNT(*) FROM entries WHERE cat_id = ?",
    (cat_id,)
).fetchone()[0]
```

**Why not cursor-based?**
- Dataset is small (< 10K sightings per cat expected)
- No real-time insertions while paginating
- Simpler client implementation
- Supports "jump to page" UX

### 3.4 Backend Code Location

All new endpoints will be added to `/backend/main.py` following existing patterns:

```python
# Location: backend/main.py (after line ~850, cat endpoints section)

@app.get("/cats/{cat_id}/sightings")
async def get_cat_sightings(
    cat_id: int,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=10, ge=1, le=50),
    sort: str = Query(default="desc", regex="^(asc|desc)$"),
    has_photo: Optional[bool] = None,
):
    """Get paginated sightings for a specific cat."""
    # Implementation here
```

---

## 4. Frontend Implementation

### 4.1 Component Structure

```
frontend/src/
├── pages/
│   └── CatProfilePage.tsx          # New: Main page component
├── components/
│   ├── cat-profile/                # New: Feature-specific components
│   │   ├── CatHeader.tsx           # Name, photo, quick stats
│   │   ├── CatStats.tsx            # Statistics summary
│   │   ├── LocationHistory.tsx     # Location list with map preview
│   │   ├── SightingsTimeline.tsx   # Paginated sightings list
│   │   ├── PhotoGallery.tsx        # Photo grid with lightbox
│   │   ├── InsightsPanel.tsx       # AI insights tabs
│   │   └── CatProfileSkeleton.tsx  # Loading state
│   ├── shared/
│   │   ├── Pagination.tsx          # Reusable pagination controls
│   │   └── EmptyState.tsx          # Reusable empty state
│   └── (existing components...)
├── hooks/
│   ├── useCatProfile.ts            # New: Profile data fetching
│   ├── usePagination.ts            # New: Pagination state management
│   └── (existing hooks...)
└── api/
    └── endpoints.ts                # Add new endpoint functions
```

### 4.2 Page Layout (Textual Sketch)

```
┌──────────────────────────────────────────────────────────────────┐
│ ← Back to Cats                                    [Share] [Edit] │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐  WHISKERS                                         │
│  │          │  First seen: Jan 15, 2024                          │
│  │  [Photo] │  ────────────────────────────────────             │
│  │          │  47 sightings · 12 locations · 23 photos          │
│  └──────────┘                                                    │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  [Overview]  [Sightings]  [Locations]  [Photos]  [Insights]     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  OVERVIEW TAB (default):                                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  📍 Recent Locations                                        │ │
│  │  ├─ Maple Street Park (15 sightings) - 2 hours ago         │ │
│  │  ├─ Oak Avenue (8 sightings) - yesterday                   │ │
│  │  └─ Central Plaza (5 sightings) - 3 days ago               │ │
│  │                                              [View all →]   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  🐱 AI Profile                                              │ │
│  │  "Whiskers is a friendly orange tabby frequently spotted   │ │
│  │   in the downtown area. Known for..."                      │ │
│  │                              [Generate Update] [View all →] │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  📸 Recent Photos                                           │ │
│  │  [img] [img] [img] [img] [img]              [View all →]   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  SIGHTINGS TAB:                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Mar 20, 2024 · 2:45 PM                                     │ │
│  │  "Spotted near the fountain, looked healthy"                │ │
│  │  📍 Maple Street Park  [img]                    ★ Favorite │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │  Mar 18, 2024 · 10:30 AM                                    │ │
│  │  "Playing with another cat near the bench"                  │ │
│  │  📍 Oak Avenue                                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  [← Prev]  Page 1 of 5  [Next →]                                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 4.3 Mobile Layout Adjustments

```
┌────────────────────────┐
│ ← Back          [···]  │
├────────────────────────┤
│    ┌──────────────┐    │
│    │              │    │
│    │   [Photo]    │    │
│    │              │    │
│    └──────────────┘    │
│                        │
│      WHISKERS          │
│   First seen: Jan 15   │
│                        │
│  47 sightings          │
│  12 locations          │
│  23 photos             │
│                        │
├────────────────────────┤
│ [Overview] [Sightings] │
│ [Locations] [Photos]   │
├────────────────────────┤
│                        │
│  (Tab content here,    │
│   full width,          │
│   vertical stacking)   │
│                        │
└────────────────────────┘
```

### 4.4 State Management Approach

**Pattern:** Custom hooks with local component state (consistent with existing codebase)

```typescript
// hooks/useCatProfile.ts
interface UseCatProfileResult {
  profile: CatProfile | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => Promise<void>;
}

export function useCatProfile(catId: number): UseCatProfileResult {
  const [profile, setProfile] = useState<CatProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchProfile() {
      setLoading(true);
      setError(null);

      try {
        const data = await getCatProfile(catId);
        if (mounted) setProfile(data);
      } catch (err) {
        if (mounted) setError(err as ApiError);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchProfile();
    return () => { mounted = false; };
  }, [catId]);

  const refetch = useCallback(async () => {
    // ... refetch logic
  }, [catId]);

  return { profile, loading, error, refetch };
}
```

```typescript
// hooks/usePagination.ts
interface UsePaginationOptions<T> {
  fetchFn: (page: number, limit: number) => Promise<PaginatedResponse<T>>;
  limit?: number;
  initialPage?: number;
}

interface UsePaginationResult<T> {
  items: T[];
  loading: boolean;
  error: ApiError | null;
  pagination: PaginationMeta;
  goToPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  refresh: () => void;
}

export function usePagination<T>(options: UsePaginationOptions<T>): UsePaginationResult<T> {
  // Implementation with page state, loading states, etc.
}
```

### 4.5 API Integration

Add to `/frontend/src/api/endpoints.ts`:

```typescript
// Cat Profile Page Endpoints

export interface CatProfile {
  cat: {
    id: number;
    name: string;
    createdAt: string;
    primaryPhoto?: string;
  };
  stats: {
    totalSightings: number;
    uniqueLocations: number;
    photoCount: number;
    firstSeen: string;
    lastSeen: string;
    mostFrequentLocation: string;
  };
  recentSightings: Entry[];
  locationSummary: LocationSummary[];
  insightStatus: InsightStatus;
}

export interface PaginatedSightings {
  items: Entry[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export async function getCatProfile(catId: number): Promise<CatProfile> {
  return request(`/cats/${catId}/profile`);
}

export async function getCatSightings(
  catId: number,
  page: number = 1,
  limit: number = 10
): Promise<PaginatedSightings> {
  return request(`/cats/${catId}/sightings?page=${page}&limit=${limit}`);
}
```

### 4.6 Routing

Add route using existing pattern (likely hash-based or simple state):

```typescript
// In App.tsx or new router setup
// Option 1: Hash routing (simple, no server config needed)
// URL: /#/cats/123

// Option 2: State-based (current approach)
const [selectedCatId, setSelectedCatId] = useState<number | null>(null);

// Render logic
{selectedCatId !== null ? (
  <CatProfilePage
    catId={selectedCatId}
    onBack={() => setSelectedCatId(null)}
  />
) : (
  <MainView />
)}
```

---

## 5. Testing Strategy

### 5.1 Backend Tests

#### Unit Tests (Priority: High)

```python
# tests/test_cat_profile.py

class TestCatProfileEndpoint:
    """Tests for GET /cats/{id}/profile"""

    def test_returns_profile_with_stats(self, client, db_with_cat):
        """Profile includes computed statistics."""
        response = client.get("/cats/1/profile")
        assert response.status_code == 200
        data = response.json()
        assert "stats" in data
        assert data["stats"]["totalSightings"] == 5

    def test_returns_404_for_nonexistent_cat(self, client):
        """Returns 404 when cat doesn't exist."""
        response = client.get("/cats/9999/profile")
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "CAT_NOT_FOUND"

    def test_location_summary_ordered_by_count(self, client, db_with_cat):
        """Location summary sorted by sighting count descending."""
        response = client.get("/cats/1/profile")
        locations = response.json()["locationSummary"]
        counts = [loc["count"] for loc in locations]
        assert counts == sorted(counts, reverse=True)


class TestCatSightingsEndpoint:
    """Tests for GET /cats/{id}/sightings"""

    def test_pagination_defaults(self, client, db_with_cat):
        """Default pagination: page 1, limit 10."""
        response = client.get("/cats/1/sightings")
        assert response.status_code == 200
        data = response.json()
        assert data["pagination"]["page"] == 1
        assert data["pagination"]["limit"] == 10

    def test_pagination_respects_params(self, client, db_with_cat):
        """Pagination parameters are applied correctly."""
        response = client.get("/cats/1/sightings?page=2&limit=5")
        data = response.json()
        assert data["pagination"]["page"] == 2
        assert data["pagination"]["limit"] == 5

    def test_invalid_page_returns_400(self, client, db_with_cat):
        """Page < 1 returns 400 error."""
        response = client.get("/cats/1/sightings?page=0")
        assert response.status_code == 400

    def test_limit_max_enforced(self, client, db_with_cat):
        """Limit > 50 returns 400 error."""
        response = client.get("/cats/1/sightings?limit=100")
        assert response.status_code == 400

    def test_has_photo_filter(self, client, db_with_cat):
        """has_photo filter returns only sightings with photos."""
        response = client.get("/cats/1/sightings?has_photo=true")
        items = response.json()["items"]
        assert all(item["photo_url"] is not None for item in items)

    def test_sort_order_desc(self, client, db_with_cat):
        """Default sort is newest first."""
        response = client.get("/cats/1/sightings")
        items = response.json()["items"]
        dates = [item["createdAt"] for item in items]
        assert dates == sorted(dates, reverse=True)
```

#### Integration Tests (Priority: Medium)

```python
# tests/test_cat_profile_integration.py

class TestCatProfileIntegration:
    """End-to-end tests for cat profile workflow."""

    def test_create_cat_and_view_profile(self, client):
        """Create cat with sightings, verify profile aggregates correctly."""
        # Create entries
        entry1 = client.post("/entries", json={"text": "Spotted cat", "location": "Park"})
        entry2 = client.post("/entries", json={"text": "Cat again", "location": "Park"})

        # Create cat from sightings
        cat = client.post("/cats/from-sightings", json={
            "name": "TestCat",
            "sighting_ids": [entry1.json()["id"], entry2.json()["id"]]
        })
        cat_id = cat.json()["cat"]["id"]

        # Verify profile
        profile = client.get(f"/cats/{cat_id}/profile")
        assert profile.json()["stats"]["totalSightings"] == 2
        assert profile.json()["stats"]["uniqueLocations"] == 1
```

### 5.2 Frontend Tests

#### Unit Tests (Priority: High)

```typescript
// hooks/__tests__/useCatProfile.test.ts

describe('useCatProfile', () => {
  it('fetches profile on mount', async () => {
    const mockProfile = { cat: { id: 1, name: 'Whiskers' }, stats: {...} };
    vi.mocked(getCatProfile).mockResolvedValue(mockProfile);

    const { result } = renderHook(() => useCatProfile(1));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toEqual(mockProfile);
  });

  it('handles 404 error gracefully', async () => {
    vi.mocked(getCatProfile).mockRejectedValue(
      new ApiError('CAT_NOT_FOUND', 'Cat not found', 404)
    );

    const { result } = renderHook(() => useCatProfile(999));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.code).toBe('CAT_NOT_FOUND');
    expect(result.current.profile).toBeNull();
  });
});
```

```typescript
// components/cat-profile/__tests__/CatHeader.test.tsx

describe('CatHeader', () => {
  it('renders cat name and stats', () => {
    render(<CatHeader profile={mockProfile} />);

    expect(screen.getByText('Whiskers')).toBeInTheDocument();
    expect(screen.getByText('47 sightings')).toBeInTheDocument();
  });

  it('shows placeholder when no photo', () => {
    const profileNoPhoto = { ...mockProfile, cat: { ...mockProfile.cat, primaryPhoto: undefined } };
    render(<CatHeader profile={profileNoPhoto} />);

    expect(screen.getByTestId('photo-placeholder')).toBeInTheDocument();
  });
});
```

#### What to Skip (Low Priority)

- **E2E browser tests:** Not critical for v0, add in v1 if needed
- **Visual regression tests:** Overhead not justified for small team
- **Snapshot tests:** Fragile, provide little value for dynamic content
- **Testing third-party components:** Trust Leaflet, etc.

### 5.3 Test Fixtures

```python
# tests/conftest.py (additions)

@pytest.fixture
def db_with_cat(test_db):
    """Database with a cat and associated sightings."""
    cursor = test_db.cursor()

    # Create cat
    cursor.execute("INSERT INTO cats (name, createdAt) VALUES (?, ?)",
                   ("TestCat", "2024-01-15T10:00:00Z"))
    cat_id = cursor.lastrowid

    # Create sightings
    sightings = [
        ("Spotted in park", "2024-03-20T14:00:00Z", "Park", 40.7, -74.0, cat_id, "url1"),
        ("Near fountain", "2024-03-18T10:00:00Z", "Park", 40.7, -74.0, cat_id, None),
        ("On bench", "2024-03-15T09:00:00Z", "Avenue", 40.71, -74.01, cat_id, "url2"),
    ]

    for text, date, loc, lat, lon, cid, photo in sightings:
        cursor.execute("""
            INSERT INTO entries (text, createdAt, location, location_lat, location_lon, cat_id, photo_url)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (text, date, loc, lat, lon, cid, photo))

    test_db.commit()
    return test_db
```

---

## 6. Resiliency & Robustness

### 6.1 Graceful Handling of Missing Data

| Data Type | Missing Scenario | UI Behavior |
|-----------|-----------------|-------------|
| Cat photo | No `primaryPhoto` | Show placeholder icon |
| Location | No coordinates | Show text location, hide map pin |
| Sightings | Zero sightings | Show "No sightings yet" empty state |
| Insights | Not generated | Show "Generate" button |
| Analysis | Missing for sighting | Skip analysis badge |
| Stats | Computation error | Show "—" placeholder |

**Implementation:**

```typescript
// CatHeader.tsx
<div className="cat-photo">
  {profile.cat.primaryPhoto ? (
    <img src={profile.cat.primaryPhoto} alt={profile.cat.name} />
  ) : (
    <div className="photo-placeholder">
      <CatIcon size={64} />
    </div>
  )}
</div>

// LocationHistory.tsx
{profile.locationSummary.length > 0 ? (
  <LocationList locations={profile.locationSummary} />
) : (
  <EmptyState
    icon={<MapPinIcon />}
    message="No locations recorded yet"
  />
)}
```

### 6.2 Partial Failure Handling

**Scenario:** Profile loads but insights fail

```typescript
// CatProfilePage.tsx
function CatProfilePage({ catId }: Props) {
  const { profile, loading, error } = useCatProfile(catId);
  const { insights, error: insightsError, refetch: refetchInsights } = useCatInsights(catId);

  // Profile error is critical - show error page
  if (error) {
    return <ErrorPage error={error} onRetry={() => window.location.reload()} />;
  }

  return (
    <div>
      <CatHeader profile={profile} />

      {/* Insights panel handles its own errors */}
      <InsightsPanel
        insights={insights}
        error={insightsError}
        onRetry={refetchInsights}
        loading={!insights && !insightsError}
      />
    </div>
  );
}

// InsightsPanel.tsx
function InsightsPanel({ insights, error, onRetry, loading }: Props) {
  if (loading) return <InsightsSkeleton />;

  if (error) {
    return (
      <div className="insights-error">
        <p>Could not load insights</p>
        <button onClick={onRetry}>Try again</button>
      </div>
    );
  }

  return <InsightsContent insights={insights} />;
}
```

### 6.3 Retry & Fallback Strategies

**Backend:**
- Existing circuit breaker for geocoding service
- Database retry for transient connection errors (1 retry)
- AI insight generation: use baseline classifier if LLM unavailable

**Frontend:**
- Leverage existing `withRetry` wrapper (3 attempts, exponential backoff)
- Circuit breaker prevents cascade failures
- User-initiated retry buttons for failed sections

```typescript
// Pattern for retryable sections
<ErrorBoundary
  fallback={({ error, retry }) => (
    <RetryableError error={error} onRetry={retry} />
  )}
>
  <InsightsPanel catId={catId} />
</ErrorBoundary>
```

### 6.4 Loading States

```typescript
// CatProfileSkeleton.tsx - shown during initial load
function CatProfileSkeleton() {
  return (
    <div className="cat-profile-skeleton">
      <div className="skeleton header">
        <div className="skeleton photo" />
        <div className="skeleton text title" />
        <div className="skeleton text subtitle" />
      </div>
      <div className="skeleton tabs" />
      <div className="skeleton content" />
    </div>
  );
}
```

---

## 7. Incremental Delivery Plan

### Phase 0: Foundation (Days 1-2)

**Deliverables:**
- [ ] Enhanced `/cats/{id}/profile` endpoint with stats
- [ ] `CatProfilePage` component with basic layout
- [ ] `CatHeader` component
- [ ] Navigation: click cat → open profile page
- [ ] Back button to return to main view

**Definition of Done:**
- Can navigate to a cat profile and see name + stats
- Can return to main view
- Backend tests passing for profile endpoint

### Phase 1: Core Features (Days 3-5)

**Deliverables:**
- [ ] `GET /cats/{id}/sightings` with pagination
- [ ] `SightingsTimeline` component with pagination
- [ ] `LocationHistory` component (list view)
- [ ] Tab navigation between Overview/Sightings
- [ ] Loading states and skeletons

**Definition of Done:**
- Can browse paginated sightings
- Can see location summary
- All pagination edge cases handled
- Frontend and backend tests passing

### Phase 2: Rich Content (Days 6-8)

**Deliverables:**
- [ ] `PhotoGallery` component (extract from sightings)
- [ ] `InsightsPanel` integration (use existing endpoints)
- [ ] Photos tab
- [ ] Insights tab with generate/refresh
- [ ] Mobile responsive adjustments

**Definition of Done:**
- Can view all photos for a cat
- Can generate and view AI insights
- Works well on mobile devices

### Phase 3: Polish & Edge Cases (Days 9-10)

**Deliverables:**
- [ ] Empty states for all sections
- [ ] Error boundaries and retry UI
- [ ] Performance optimization (lazy loading images)
- [ ] Accessibility review (keyboard nav, screen readers)
- [ ] Documentation update

**Definition of Done:**
- All error scenarios handled gracefully
- Performance acceptable on slow connections
- Passes basic accessibility check
- Documentation updated

---

## 8. API Contracts

### 8.1 GET /cats/{id}/profile (Enhanced)

**Request:**
```http
GET /cats/1/profile HTTP/1.1
Host: api.catatlas.com
```

**Success Response (200):**
```json
{
  "cat": {
    "id": 1,
    "name": "Whiskers",
    "createdAt": "2024-01-15T10:30:00Z",
    "primaryPhoto": "https://cdn.bunny.net/cats/1/primary.jpg"
  },
  "stats": {
    "totalSightings": 47,
    "uniqueLocations": 12,
    "photoCount": 23,
    "firstSeen": "2024-01-15T10:30:00Z",
    "lastSeen": "2024-03-20T14:45:00Z",
    "mostFrequentLocation": "Maple Street Park"
  },
  "recentSightings": [
    {
      "id": 123,
      "text": "Spotted near the fountain",
      "createdAt": "2024-03-20T14:45:00Z",
      "location": "Maple Street Park",
      "photo_url": "https://cdn.bunny.net/sightings/123.jpg"
    }
  ],
  "locationSummary": [
    {
      "location": "Maple Street Park",
      "normalizedLocation": "Maple Street Park, Downtown, Springfield",
      "count": 15,
      "lastSeen": "2024-03-20T14:45:00Z",
      "lat": 40.7128,
      "lon": -74.0060
    },
    {
      "location": "Oak Avenue",
      "normalizedLocation": "Oak Avenue, Midtown, Springfield",
      "count": 8,
      "lastSeen": "2024-03-18T10:30:00Z",
      "lat": 40.7150,
      "lon": -74.0080
    }
  ],
  "insightStatus": {
    "hasProfile": true,
    "hasCare": false,
    "hasUpdate": true,
    "hasRisk": false,
    "lastUpdated": "2024-03-19T12:00:00Z"
  }
}
```

**Error Response (404):**
```json
{
  "detail": {
    "code": "CAT_NOT_FOUND",
    "message": "Cat with ID 999 not found",
    "retryable": false
  }
}
```

### 8.2 GET /cats/{id}/sightings

**Request:**
```http
GET /cats/1/sightings?page=1&limit=10&sort=desc&has_photo=true HTTP/1.1
Host: api.catatlas.com
```

**Success Response (200):**
```json
{
  "items": [
    {
      "id": 123,
      "text": "Spotted near the fountain, looking healthy",
      "createdAt": "2024-03-20T14:45:00Z",
      "isFavorite": true,
      "location": "Maple Street Park",
      "location_normalized": "Maple Street Park, Downtown, Springfield",
      "location_lat": 40.7128,
      "location_lon": -74.0060,
      "location_street": "Maple Street",
      "location_city": "Springfield",
      "photo_url": "https://cdn.bunny.net/sightings/123.jpg",
      "analysis": {
        "summary": "Healthy cat sighting in park area",
        "sentiment": "positive",
        "tags": ["healthy", "park", "daytime"]
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "totalItems": 47,
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

**Error Response (400 - Invalid Parameters):**
```json
{
  "detail": {
    "code": "INVALID_PAGE",
    "message": "Page must be >= 1",
    "retryable": false
  }
}
```

### 8.3 TypeScript Types

```typescript
// types/catProfile.ts

export interface CatProfile {
  cat: Cat;
  stats: CatStats;
  recentSightings: Entry[];
  locationSummary: LocationSummary[];
  insightStatus: InsightStatus;
}

export interface Cat {
  id: number;
  name: string;
  createdAt: string;
  primaryPhoto?: string;
}

export interface CatStats {
  totalSightings: number;
  uniqueLocations: number;
  photoCount: number;
  firstSeen: string;
  lastSeen: string;
  mostFrequentLocation: string;
}

export interface LocationSummary {
  location: string;
  normalizedLocation?: string;
  count: number;
  lastSeen: string;
  lat?: number;
  lon?: number;
}

export interface InsightStatus {
  hasProfile: boolean;
  hasCare: boolean;
  hasUpdate: boolean;
  hasRisk: boolean;
  lastUpdated?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}
```

---

## 9. Summary & Next Steps

### Recommended Approach Summary

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **Architecture** | Hybrid (Option C) | Balance of simplicity and performance |
| **State Management** | Custom hooks | Consistent with existing codebase |
| **Pagination** | Offset-based | Simple, supports jump-to-page |
| **Testing** | Unit + integration | High coverage without E2E overhead |
| **Delivery** | 4 phases over 10 days | Ship incrementally, get feedback |

### Immediate Next Steps

1. **Review & approve this plan** with stakeholders
2. **Create branch** for cat profile feature
3. **Start Phase 0** with backend endpoint enhancement
4. **Set up test fixtures** for cat profile scenarios

### Open Questions

1. **URL routing:** Should we add proper client-side routing (react-router) or keep state-based navigation?
2. **Sharing:** Should cat profiles have shareable URLs in v0?
3. **Edit capability:** Can users edit cat name from profile page?
4. **Comments:** Is community comments feature in scope for v0 or v1?

---

*Document created: 2024-03-20*
*Last updated: 2024-03-20*
*Author: Claude (AI Assistant)*
