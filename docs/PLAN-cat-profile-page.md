# Cat Profile Page - Implementation Plan

**Document Version:** 2.0
**Target Timeline:** 2 weeks (5 phases, incremental delivery)
**Status:** Planning

**Key Features:**
- React Router with shareable URLs
- Edit cat name from profile
- Community comments system

---

## Executive Summary

This document outlines the implementation plan for a dedicated "Cat Profile" page in the CatAtlas application. Each tracked cat will have its own page displaying aggregated sightings, location history, photos, community updates, and AI-generated insights.

---

## Table of Contents

1. [High-Level Architecture Options](#1-high-level-architecture-options)
2. [Recommended Approach](#2-recommended-approach)
3. [Backend Implementation](#3-backend-implementation)
4. [Frontend Implementation](#4-frontend-implementation)
5. [React Router & Shareable URLs](#5-react-router--shareable-urls)
6. [Edit Cat Name Feature](#6-edit-cat-name-feature)
7. [Community Comments Feature](#7-community-comments-feature)
8. [Testing Strategy](#8-testing-strategy)
9. [Resiliency & Robustness](#9-resiliency--robustness)
10. [Incremental Delivery Plan](#10-incremental-delivery-plan)
11. [API Contracts](#11-api-contracts)

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

See [Section 5: React Router & Shareable URLs](#5-react-router--shareable-urls) for full routing implementation.

---

## 5. React Router & Shareable URLs

### 5.1 Overview

The app will use **React Router v6** (BrowserRouter) to enable:
- Shareable cat profile URLs: `https://catatlas.com/cats/123`
- Browser back/forward navigation
- Bookmarkable pages
- Deep linking from external sources

### 5.2 Installation

```bash
npm install react-router-dom
```

### 5.3 Route Structure

```
/                       → Main view (sightings list/map)
/cats                   → All cats list
/cats/:catId            → Cat profile page (shareable!)
/cats/:catId/sightings  → Cat sightings (optional deep link)
/cats/:catId/photos     → Cat photos (optional deep link)
```

### 5.4 Implementation

#### Router Setup

```typescript
// main.tsx
import { BrowserRouter } from 'react-router-dom';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
```

#### Route Configuration

```typescript
// App.tsx
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';

function App() {
  return (
    <DarkModeProvider>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<MainView />} />
          <Route path="/cats" element={<CatsListView />} />
          <Route path="/cats/:catId" element={<CatProfilePage />} />
        </Routes>
      </ToastProvider>
    </DarkModeProvider>
  );
}
```

#### CatProfilePage with URL Params

```typescript
// pages/CatProfilePage.tsx
import { useParams, useNavigate } from 'react-router-dom';

function CatProfilePage() {
  const { catId } = useParams<{ catId: string }>();
  const navigate = useNavigate();

  const numericCatId = parseInt(catId || '0', 10);

  // Handle invalid cat ID in URL
  if (isNaN(numericCatId) || numericCatId <= 0) {
    return <NotFoundPage message="Invalid cat ID" />;
  }

  const { profile, loading, error } = useCatProfile(numericCatId);

  const handleBack = () => navigate(-1);
  const handleGoHome = () => navigate('/');

  // ... rest of component
}
```

#### Navigation from Cat List

```typescript
// In any component that links to a cat profile
import { Link, useNavigate } from 'react-router-dom';

// Option 1: Link component (preferred for accessibility)
<Link to={`/cats/${cat.id}`} className="cat-card">
  {cat.name}
</Link>

// Option 2: Programmatic navigation
const navigate = useNavigate();
const handleCatClick = (catId: number) => {
  navigate(`/cats/${catId}`);
};
```

### 5.5 Share Button Implementation

```typescript
// components/cat-profile/ShareButton.tsx
interface ShareButtonProps {
  catId: number;
  catName: string;
}

function ShareButton({ catId, catName }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  const shareUrl = `${window.location.origin}/cats/${catId}`;

  const handleShare = async () => {
    // Try native share API first (mobile)
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${catName} - CatAtlas`,
          text: `Check out ${catName} on CatAtlas!`,
          url: shareUrl,
        });
        return;
      } catch (err) {
        // User cancelled or API failed, fall back to clipboard
      }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = shareUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button onClick={handleShare} className="share-button">
      {copied ? 'Copied!' : 'Share'}
    </button>
  );
}
```

### 5.6 Server Configuration (Production)

For BrowserRouter to work in production, the server must serve `index.html` for all routes:

#### Nginx
```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

#### Vercel (vercel.json)
```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

#### Netlify (_redirects)
```
/*    /index.html   200
```

### 5.7 SEO & Social Sharing (Optional Enhancement)

For better social media previews, consider adding Open Graph meta tags:

```typescript
// hooks/useDocumentMeta.ts
import { useEffect } from 'react';

export function useDocumentMeta(title: string, description?: string) {
  useEffect(() => {
    document.title = title;

    // Update meta description
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription && description) {
      metaDescription.setAttribute('content', description);
    }
  }, [title, description]);
}

// Usage in CatProfilePage
useDocumentMeta(
  `${profile?.cat.name || 'Cat'} - CatAtlas`,
  `View ${profile?.stats.totalSightings || 0} sightings of ${profile?.cat.name}`
);
```

---

## 6. Edit Cat Name Feature

### 6.1 Overview

Users can edit a cat's name directly from the profile page. This provides a simple, inline editing experience.

### 6.2 UI Design

```
┌─────────────────────────────────────────────────────────────────┐
│  ┌──────────┐                                                   │
│  │          │  WHISKERS                          [Edit] [Share] │
│  │  [Photo] │  First seen: Jan 15, 2024                         │
│  │          │  ────────────────────────────────                 │
│  └──────────┘  47 sightings · 12 locations                      │
└─────────────────────────────────────────────────────────────────┘

                        ↓ Click Edit ↓

┌─────────────────────────────────────────────────────────────────┐
│  ┌──────────┐                                                   │
│  │          │  ┌─────────────────────────────┐                  │
│  │  [Photo] │  │ Whiskers                    │ [Save] [Cancel]  │
│  │          │  └─────────────────────────────┘                  │
│  └──────────┘  47 sightings · 12 locations                      │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Backend Endpoint

**Endpoint:** `PATCH /cats/{id}`
**Status:** New endpoint

**Request:**
```json
{
  "name": "Mr. Whiskers"
}
```

**Response (200):**
```json
{
  "cat": {
    "id": 1,
    "name": "Mr. Whiskers",
    "createdAt": "2024-01-15T10:30:00Z"
  },
  "message": "Cat updated successfully"
}
```

**Error Responses:**

| HTTP Code | Error Code | Scenario |
|-----------|------------|----------|
| 400 | `INVALID_NAME` | Name empty or too long (>100 chars) |
| 404 | `CAT_NOT_FOUND` | Cat doesn't exist |
| 409 | `NAME_CONFLICT` | Another cat has this name (optional) |

**Backend Implementation:**

```python
# backend/main.py

class CatUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)

@app.patch("/cats/{cat_id}")
async def update_cat(cat_id: int, update: CatUpdate):
    """Update cat details (currently only name)."""
    db = get_db()
    cursor = db.cursor()

    # Check cat exists
    cursor.execute("SELECT id FROM cats WHERE id = ?", (cat_id,))
    if not cursor.fetchone():
        raise HTTPException(
            status_code=404,
            detail={"code": "CAT_NOT_FOUND", "message": f"Cat {cat_id} not found"}
        )

    # Validate name not empty after trimming
    clean_name = update.name.strip()
    if not clean_name:
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_NAME", "message": "Name cannot be empty"}
        )

    # Update cat
    cursor.execute(
        "UPDATE cats SET name = ? WHERE id = ?",
        (clean_name, cat_id)
    )
    db.commit()

    # Return updated cat
    cursor.execute("SELECT id, name, createdAt FROM cats WHERE id = ?", (cat_id,))
    row = cursor.fetchone()

    return {
        "cat": {"id": row[0], "name": row[1], "createdAt": row[2]},
        "message": "Cat updated successfully"
    }
```

### 6.4 Frontend Implementation

#### EditableCatName Component

```typescript
// components/cat-profile/EditableCatName.tsx
interface EditableCatNameProps {
  catId: number;
  initialName: string;
  onNameUpdated: (newName: string) => void;
}

function EditableCatName({ catId, initialName, onNameUpdated }: EditableCatNameProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { mutate, loading } = useMutation<{ cat: Cat }, { name: string }>({
    mutationFn: (data) => updateCat(catId, data),
    onSuccess: (data) => {
      onNameUpdated(data.cat.name);
      setIsEditing(false);
      setError(null);
    },
    onError: (err) => {
      setError(err.message || 'Failed to update name');
    },
  });

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name cannot be empty');
      return;
    }
    if (trimmed.length > 100) {
      setError('Name too long (max 100 characters)');
      return;
    }
    mutate({ name: trimmed });
  };

  const handleCancel = () => {
    setName(initialName);
    setIsEditing(false);
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') handleCancel();
  };

  if (!isEditing) {
    return (
      <div className="cat-name-display">
        <h1>{initialName}</h1>
        <button
          onClick={() => setIsEditing(true)}
          className="edit-button"
          aria-label="Edit cat name"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="cat-name-edit">
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={loading}
        maxLength={100}
        aria-label="Cat name"
      />
      <div className="edit-actions">
        <button onClick={handleSave} disabled={loading}>
          {loading ? 'Saving...' : 'Save'}
        </button>
        <button onClick={handleCancel} disabled={loading}>
          Cancel
        </button>
      </div>
      {error && <p className="error-message">{error}</p>}
    </div>
  );
}
```

#### API Function

```typescript
// api/endpoints.ts
export async function updateCat(
  catId: number,
  data: { name: string }
): Promise<{ cat: Cat; message: string }> {
  return request(`/cats/${catId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
```

### 6.5 Optimistic Updates (Optional Enhancement)

For better UX, update the UI immediately and rollback on error:

```typescript
const handleSave = () => {
  const trimmed = name.trim();
  const previousName = initialName;

  // Optimistic update
  onNameUpdated(trimmed);
  setIsEditing(false);

  mutate({ name: trimmed }, {
    onError: () => {
      // Rollback on failure
      onNameUpdated(previousName);
      setName(previousName);
      toast.error('Failed to update name. Please try again.');
    }
  });
};
```

---

## 7. Community Comments Feature

### 7.1 Overview

Community members can leave comments on cat profiles to share updates, tips, or observations. This fosters community engagement around tracked cats.

### 7.2 Data Model

#### New Database Table: `comments`

```sql
CREATE TABLE comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cat_id INTEGER NOT NULL,
    author_name TEXT NOT NULL,           -- Simple name input (no auth required)
    content TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT,
    is_pinned INTEGER DEFAULT 0,         -- For important updates
    FOREIGN KEY(cat_id) REFERENCES cats(id) ON DELETE CASCADE
);

CREATE INDEX idx_comments_cat_id ON comments(cat_id);
CREATE INDEX idx_comments_created ON comments(createdAt DESC);
```

### 7.3 UI Design

```
┌────────────────────────────────────────────────────────────────┐
│  [Overview]  [Sightings]  [Photos]  [Comments]  [Insights]    │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  COMMENTS TAB:                                                 │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Add a comment                                            │ │
│  │  ┌────────────────────────────────────────────────────┐  │ │
│  │  │ Your name                                          │  │ │
│  │  └────────────────────────────────────────────────────┘  │ │
│  │  ┌────────────────────────────────────────────────────┐  │ │
│  │  │ Share an update about this cat...                  │  │ │
│  │  │                                                    │  │ │
│  │  └────────────────────────────────────────────────────┘  │ │
│  │                                           [Post Comment]  │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  📌 Sarah M. · 2 hours ago                    [Pinned]   │ │
│  │  "Whiskers has been visiting the park fountain daily     │ │
│  │   around 3pm. Great time to spot him!"                   │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  John D. · yesterday                                      │ │
│  │  "Saw him near the coffee shop on Oak Ave. Looked        │ │
│  │   healthy and was playing with another tabby."           │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  CatLover42 · 3 days ago                                  │ │
│  │  "Such a friendly cat! Let me pet him for a while."       │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  [Load more comments...]                                       │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 7.4 Backend Endpoints

#### 7.4.1 List Comments

**Endpoint:** `GET /cats/{id}/comments`

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | int | 1 | Page number |
| `limit` | int | 20 | Items per page (max 50) |

**Response (200):**
```json
{
  "items": [
    {
      "id": 1,
      "cat_id": 123,
      "author_name": "Sarah M.",
      "content": "Whiskers has been visiting the park fountain daily around 3pm.",
      "createdAt": "2024-03-20T14:00:00Z",
      "is_pinned": true
    },
    {
      "id": 2,
      "cat_id": 123,
      "author_name": "John D.",
      "content": "Saw him near the coffee shop on Oak Ave.",
      "createdAt": "2024-03-19T10:30:00Z",
      "is_pinned": false
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "totalItems": 45,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  }
}
```

#### 7.4.2 Create Comment

**Endpoint:** `POST /cats/{id}/comments`

**Request:**
```json
{
  "author_name": "Sarah M.",
  "content": "Spotted Whiskers near the fountain today!"
}
```

**Response (201):**
```json
{
  "comment": {
    "id": 46,
    "cat_id": 123,
    "author_name": "Sarah M.",
    "content": "Spotted Whiskers near the fountain today!",
    "createdAt": "2024-03-20T15:30:00Z",
    "is_pinned": false
  }
}
```

**Error Responses:**

| HTTP Code | Error Code | Scenario |
|-----------|------------|----------|
| 400 | `INVALID_CONTENT` | Content empty or too long (>1000 chars) |
| 400 | `INVALID_AUTHOR` | Author name empty or too long (>50 chars) |
| 404 | `CAT_NOT_FOUND` | Cat doesn't exist |
| 429 | `RATE_LIMITED` | Too many comments from same IP |

#### 7.4.3 Delete Comment (Admin/Author)

**Endpoint:** `DELETE /cats/{cat_id}/comments/{comment_id}`

**Response (200):**
```json
{
  "message": "Comment deleted successfully"
}
```

### 7.5 Backend Implementation

```python
# backend/main.py

class CommentCreate(BaseModel):
    author_name: str = Field(..., min_length=1, max_length=50)
    content: str = Field(..., min_length=1, max_length=1000)

class Comment(BaseModel):
    id: int
    cat_id: int
    author_name: str
    content: str
    createdAt: str
    is_pinned: bool = False

@app.get("/cats/{cat_id}/comments")
async def get_cat_comments(
    cat_id: int,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
):
    """Get paginated comments for a cat."""
    db = get_db()
    cursor = db.cursor()

    # Check cat exists
    cursor.execute("SELECT id FROM cats WHERE id = ?", (cat_id,))
    if not cursor.fetchone():
        raise HTTPException(status_code=404, detail={"code": "CAT_NOT_FOUND"})

    # Get total count
    cursor.execute("SELECT COUNT(*) FROM comments WHERE cat_id = ?", (cat_id,))
    total = cursor.fetchone()[0]

    # Get paginated comments (pinned first, then by date)
    offset = (page - 1) * limit
    cursor.execute("""
        SELECT id, cat_id, author_name, content, createdAt, is_pinned
        FROM comments
        WHERE cat_id = ?
        ORDER BY is_pinned DESC, createdAt DESC
        LIMIT ? OFFSET ?
    """, (cat_id, limit, offset))

    rows = cursor.fetchall()
    items = [
        {
            "id": r[0],
            "cat_id": r[1],
            "author_name": r[2],
            "content": r[3],
            "createdAt": r[4],
            "is_pinned": bool(r[5])
        }
        for r in rows
    ]

    total_pages = (total + limit - 1) // limit

    return {
        "items": items,
        "pagination": {
            "page": page,
            "limit": limit,
            "totalItems": total,
            "totalPages": total_pages,
            "hasNext": page < total_pages,
            "hasPrev": page > 1
        }
    }

@app.post("/cats/{cat_id}/comments", status_code=201)
async def create_comment(cat_id: int, comment: CommentCreate):
    """Add a comment to a cat profile."""
    db = get_db()
    cursor = db.cursor()

    # Check cat exists
    cursor.execute("SELECT id FROM cats WHERE id = ?", (cat_id,))
    if not cursor.fetchone():
        raise HTTPException(status_code=404, detail={"code": "CAT_NOT_FOUND"})

    # Validate and sanitize input
    author = comment.author_name.strip()
    content = comment.content.strip()

    if not author:
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_AUTHOR", "message": "Author name required"}
        )
    if not content:
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_CONTENT", "message": "Content required"}
        )

    # Insert comment
    now = datetime.utcnow().isoformat() + "Z"
    cursor.execute("""
        INSERT INTO comments (cat_id, author_name, content, createdAt, is_pinned)
        VALUES (?, ?, ?, ?, 0)
    """, (cat_id, author, content, now))

    comment_id = cursor.lastrowid
    db.commit()

    return {
        "comment": {
            "id": comment_id,
            "cat_id": cat_id,
            "author_name": author,
            "content": content,
            "createdAt": now,
            "is_pinned": False
        }
    }

@app.delete("/cats/{cat_id}/comments/{comment_id}")
async def delete_comment(cat_id: int, comment_id: int):
    """Delete a comment."""
    db = get_db()
    cursor = db.cursor()

    # Check comment exists and belongs to this cat
    cursor.execute(
        "SELECT id FROM comments WHERE id = ? AND cat_id = ?",
        (comment_id, cat_id)
    )
    if not cursor.fetchone():
        raise HTTPException(status_code=404, detail={"code": "COMMENT_NOT_FOUND"})

    cursor.execute("DELETE FROM comments WHERE id = ?", (comment_id,))
    db.commit()

    return {"message": "Comment deleted successfully"}
```

### 7.6 Frontend Implementation

#### CommentsPanel Component

```typescript
// components/cat-profile/CommentsPanel.tsx
interface CommentsPanelProps {
  catId: number;
}

function CommentsPanel({ catId }: CommentsPanelProps) {
  const [authorName, setAuthorName] = useState(() =>
    localStorage.getItem('comment_author') || ''
  );
  const [content, setContent] = useState('');

  const {
    items: comments,
    loading,
    error,
    pagination,
    nextPage,
    refresh
  } = usePagination({
    fetchFn: (page, limit) => getCatComments(catId, page, limit),
    limit: 20,
  });

  const { mutate: postComment, loading: posting } = useMutation({
    mutationFn: (data: { author_name: string; content: string }) =>
      createComment(catId, data),
    onSuccess: () => {
      setContent('');
      localStorage.setItem('comment_author', authorName);
      refresh();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!authorName.trim() || !content.trim()) return;
    postComment({ author_name: authorName.trim(), content: content.trim() });
  };

  return (
    <div className="comments-panel">
      {/* Comment Form */}
      <form onSubmit={handleSubmit} className="comment-form">
        <h3>Add a comment</h3>
        <input
          type="text"
          placeholder="Your name"
          value={authorName}
          onChange={(e) => setAuthorName(e.target.value)}
          maxLength={50}
          required
        />
        <textarea
          placeholder="Share an update about this cat..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={1000}
          rows={3}
          required
        />
        <button type="submit" disabled={posting}>
          {posting ? 'Posting...' : 'Post Comment'}
        </button>
      </form>

      {/* Comments List */}
      <div className="comments-list">
        {loading && comments.length === 0 ? (
          <CommentsSkeleton />
        ) : error ? (
          <div className="error">
            Failed to load comments
            <button onClick={refresh}>Retry</button>
          </div>
        ) : comments.length === 0 ? (
          <EmptyState message="No comments yet. Be the first!" />
        ) : (
          <>
            {comments.map((comment) => (
              <CommentCard key={comment.id} comment={comment} />
            ))}
            {pagination.hasNext && (
              <button onClick={nextPage} disabled={loading}>
                {loading ? 'Loading...' : 'Load more comments'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

#### CommentCard Component

```typescript
// components/cat-profile/CommentCard.tsx
interface CommentCardProps {
  comment: Comment;
}

function CommentCard({ comment }: CommentCardProps) {
  const timeAgo = formatTimeAgo(comment.createdAt);

  return (
    <div className={`comment-card ${comment.is_pinned ? 'pinned' : ''}`}>
      <div className="comment-header">
        {comment.is_pinned && <span className="pin-badge">Pinned</span>}
        <span className="author">{comment.author_name}</span>
        <span className="separator">·</span>
        <span className="time">{timeAgo}</span>
      </div>
      <p className="comment-content">{comment.content}</p>
    </div>
  );
}
```

#### API Functions

```typescript
// api/endpoints.ts

export interface Comment {
  id: number;
  cat_id: number;
  author_name: string;
  content: string;
  createdAt: string;
  is_pinned: boolean;
}

export async function getCatComments(
  catId: number,
  page: number = 1,
  limit: number = 20
): Promise<PaginatedResponse<Comment>> {
  return request(`/cats/${catId}/comments?page=${page}&limit=${limit}`);
}

export async function createComment(
  catId: number,
  data: { author_name: string; content: string }
): Promise<{ comment: Comment }> {
  return request(`/cats/${catId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteComment(
  catId: number,
  commentId: number
): Promise<{ message: string }> {
  return request(`/cats/${catId}/comments/${commentId}`, {
    method: 'DELETE',
  });
}
```

### 7.7 Content Moderation (Future Enhancement)

For production, consider adding:

1. **Rate limiting** - Max 5 comments per IP per hour
2. **Basic profanity filter** - Block obvious offensive content
3. **Report button** - Let users flag inappropriate comments
4. **Admin panel** - Review and moderate flagged content

```python
# Simple rate limiting example (add to create_comment)
from collections import defaultdict
import time

comment_timestamps = defaultdict(list)
RATE_LIMIT_WINDOW = 3600  # 1 hour
MAX_COMMENTS_PER_WINDOW = 5

def check_rate_limit(client_ip: str) -> bool:
    now = time.time()
    timestamps = comment_timestamps[client_ip]
    # Remove old timestamps
    timestamps[:] = [t for t in timestamps if now - t < RATE_LIMIT_WINDOW]
    if len(timestamps) >= MAX_COMMENTS_PER_WINDOW:
        return False
    timestamps.append(now)
    return True
```

---

## 8. Testing Strategy

### 8.1 Backend Tests

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

### 8.2 Frontend Tests

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

### 8.3 Test Fixtures

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

## 9. Resiliency & Robustness

### 9.1 Graceful Handling of Missing Data

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

### 9.2 Partial Failure Handling

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

### 9.3 Retry & Fallback Strategies

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

### 9.4 Loading States

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

## 10. Incremental Delivery Plan

### Phase 0: Foundation (Days 1-2)

**Deliverables:**
- [ ] Install and configure React Router v6
- [ ] Set up route structure (`/`, `/cats`, `/cats/:catId`)
- [ ] Enhanced `/cats/{id}/profile` endpoint with stats
- [ ] `CatProfilePage` component with basic layout
- [ ] `CatHeader` component with name display
- [ ] Shareable URLs working (can share link to cat profile)

**Definition of Done:**
- Can navigate to `/cats/123` and see profile
- Shareable URLs work (paste in new tab loads correct cat)
- Browser back/forward works
- Backend tests passing for profile endpoint

### Phase 1: Core Features (Days 3-5)

**Deliverables:**
- [ ] `GET /cats/{id}/sightings` with pagination
- [ ] `PATCH /cats/{id}` endpoint for editing name
- [ ] `SightingsTimeline` component with pagination
- [ ] `EditableCatName` component (inline editing)
- [ ] `LocationHistory` component (list view)
- [ ] Tab navigation between Overview/Sightings/Locations
- [ ] Loading states and skeletons
- [ ] Share button with clipboard + native share API

**Definition of Done:**
- Can browse paginated sightings
- Can edit cat name inline with Save/Cancel
- Can share cat profile URL
- All pagination edge cases handled
- Frontend and backend tests passing

### Phase 2: Rich Content & Comments (Days 6-8)

**Deliverables:**
- [ ] `comments` database table migration
- [ ] `GET /cats/{id}/comments` endpoint with pagination
- [ ] `POST /cats/{id}/comments` endpoint
- [ ] `DELETE /cats/{id}/comments/{id}` endpoint
- [ ] `CommentsPanel` component with form + list
- [ ] `PhotoGallery` component (extract from sightings)
- [ ] `InsightsPanel` integration (use existing endpoints)
- [ ] Photos tab, Comments tab, Insights tab
- [ ] Mobile responsive adjustments

**Definition of Done:**
- Can post and view comments
- Author name persisted in localStorage
- Can view all photos for a cat
- Can generate and view AI insights
- Works well on mobile devices

### Phase 3: Polish & Edge Cases (Days 9-10)

**Deliverables:**
- [ ] Empty states for all sections
- [ ] Error boundaries and retry UI
- [ ] 404 page for invalid cat IDs
- [ ] Performance optimization (lazy loading images)
- [ ] Server config for SPA routing (Nginx/Vercel/Netlify)
- [ ] Accessibility review (keyboard nav, screen readers)
- [ ] Document meta tags for social sharing
- [ ] Documentation update

**Definition of Done:**
- All error scenarios handled gracefully
- Invalid URLs show friendly 404 page
- Performance acceptable on slow connections
- Social media link previews work
- Passes basic accessibility check
- Documentation updated

### Phase 4: Hardening (Days 11-12, Optional)

**Deliverables:**
- [ ] Comment rate limiting (5/hour per IP)
- [ ] Basic profanity filter
- [ ] Report comment button
- [ ] Pinned comments support
- [ ] SEO meta tags (Open Graph)

**Definition of Done:**
- Spam protection working
- Can pin important comments
- Social media previews show cat name and stats

---

## 11. API Contracts

### 11.1 GET /cats/{id}/profile (Enhanced)

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

### 11.2 GET /cats/{id}/sightings

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

### 11.3 TypeScript Types

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

## 12. Summary & Next Steps

### Recommended Approach Summary

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **Architecture** | Hybrid (Option C) | Balance of simplicity and performance |
| **Routing** | React Router v6 (BrowserRouter) | Shareable URLs, browser nav, deep linking |
| **State Management** | Custom hooks | Consistent with existing codebase |
| **Pagination** | Offset-based | Simple, supports jump-to-page |
| **Comments** | No auth required | Low friction, author name via localStorage |
| **Testing** | Unit + integration | High coverage without E2E overhead |
| **Delivery** | 5 phases over 12 days | Ship incrementally, get feedback |

### Immediate Next Steps

1. **Review & approve this plan** with stakeholders
2. **Create branch** for cat profile feature
3. **Start Phase 0** with backend endpoint enhancement
4. **Set up test fixtures** for cat profile scenarios

### Resolved Decisions

| Question | Decision | Section |
|----------|----------|---------|
| **URL routing** | React Router v6 (BrowserRouter) | [Section 5](#5-react-router--shareable-urls) |
| **Sharing** | Yes - shareable URLs with Share button | [Section 5.5](#55-share-button-implementation) |
| **Edit capability** | Yes - inline editing from profile | [Section 6](#6-edit-cat-name-feature) |
| **Comments** | Yes - community comments included | [Section 7](#7-community-comments-feature) |

---

*Document created: 2024-03-20*
*Last updated: 2026-01-28*
*Author: Claude (AI Assistant)*

---

## Appendix: New API Endpoints Summary

| Method | Endpoint | Description | Section |
|--------|----------|-------------|---------|
| `GET` | `/cats/{id}/profile` | Enhanced profile with stats | [11.1](#111-get-catsidprofile-enhanced) |
| `GET` | `/cats/{id}/sightings` | Paginated sightings | [11.2](#112-get-catsidsightings) |
| `PATCH` | `/cats/{id}` | Update cat name | [6.3](#63-backend-endpoint) |
| `GET` | `/cats/{id}/comments` | List comments | [7.4.1](#741-list-comments) |
| `POST` | `/cats/{id}/comments` | Create comment | [7.4.2](#742-create-comment) |
| `DELETE` | `/cats/{id}/comments/{id}` | Delete comment | [7.4.3](#743-delete-comment-adminauthor) |
