# Cat Sighting Area Deduplication - Implementation Plan

## Overview

When a user enters a location for a cat sighting, the system should:
1. **Check** for existing sightings in the same area
2. **Identify** potential matches that could be the same cat
3. **Validate** and link confirmed sightings to a single cat profile

## Current State Analysis

### Existing Features (in `backend/main.py`)

| Feature | Location | Description |
|---------|----------|-------------|
| `GET /entries/{entry_id}/matches` | Lines 901-970 | Find similar sightings using text/location similarity |
| `compute_match_score()` | Lines 505-541 | 70% text + 30% location weighted scoring |
| `location_similarity()` | Lines 493-502 | Jaccard similarity on tokenized location strings |
| `POST /entries/{entry_id}/assign/{cat_id}` | Lines 874-899 | Link a sighting to an existing cat |

### Current Limitations

1. **Reactive matching only** - Must create entry first, then check for matches
2. **No proactive location check** - No way to preview matches before submission
3. **Weak location matching** - Simple tokenization misses semantic similarity (e.g., "Central Park" vs "the park downtown")
4. **No validation workflow** - No confirmation step to mark sightings as "same cat"
5. **No area-based clustering** - Cannot view all sightings grouped by area

---

## Proposed Implementation

### Phase 1: Proactive Location Check (MVP)

**Goal**: Check for similar sightings *before* creating an entry, based on location input.

#### 1.1 New Endpoint: Preview Matches by Location

```python
GET /entries/preview-matches
```

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `location` | string | Yes | Location to search for similar sightings |
| `text` | string | No | Optional description text for better matching |
| `top_k` | int | No | Max results (default: 10) |
| `min_score` | float | No | Minimum location similarity (default: 0.3) |

**Response Model:**
```python
class LocationMatchPreview(BaseModel):
    entry_id: int
    location: str
    location_similarity: float
    text_preview: str  # First 100 chars
    nickname: Optional[str]
    cat_id: Optional[int]
    cat_name: Optional[str]
    created_at: str
    photo_url: Optional[str]
```

**Implementation Notes:**
- Filter entries WHERE location IS NOT NULL
- Calculate location_similarity for each
- Sort by similarity descending
- If `text` provided, include combined score for better ranking

#### 1.2 Enhanced Location Normalization

Add preprocessing to improve location matching:

```python
def normalize_location(loc: str) -> str:
    """
    Normalize location strings for better matching.
    - Lowercase
    - Remove common filler words ("the", "near", "by", "at")
    - Standardize abbreviations (st->street, ave->avenue, etc.)
    - Strip extra whitespace
    """
```

**Location-Specific Stopwords to Add:**
```python
LOCATION_STOPWORDS = {
    "the", "near", "by", "at", "on", "in", "behind", "front",
    "next", "across", "from", "street", "road", "avenue", "lane",
    "st", "rd", "ave", "ln", "dr", "drive", "way"
}
```

---

### Phase 2: Validation Workflow

**Goal**: Allow users to confirm that multiple sightings are the same cat.

#### 2.1 New Endpoint: Bulk Link Sightings to Cat

```python
POST /cats/{cat_id}/link-sightings
```

**Request Body:**
```python
class LinkSightingsRequest(BaseModel):
    entry_ids: List[int]  # List of entry IDs to link to this cat
```

**Response:**
```python
class LinkSightingsResponse(BaseModel):
    cat_id: int
    linked_count: int
    already_linked: List[int]  # Entry IDs already linked to this cat
    newly_linked: List[int]    # Entry IDs newly linked
    failed: List[int]          # Entry IDs that failed (not found)
```

**Behavior:**
- Validate all entry_ids exist
- Update `cat_id` field for each entry
- Return summary of changes

#### 2.2 New Endpoint: Create Cat from Matched Sightings

```python
POST /cats/from-sightings
```

**Request Body:**
```python
class CreateCatFromSightingsRequest(BaseModel):
    entry_ids: List[int]       # Sightings to group as same cat
    name: Optional[str] = None # Optional cat name
```

**Behavior:**
1. Create new cat record
2. Link all provided entries to the new cat
3. Return the new cat with linked sightings count

---

### Phase 3: Area-Based Clustering (Advanced)

**Goal**: View and manage sightings grouped by geographic area.

#### 3.1 New Endpoint: Get Sightings by Area

```python
GET /entries/by-area
```

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `location` | string | Yes | Area to search |
| `radius` | float | No | Similarity threshold (0.0-1.0, default: 0.5) |

**Response:**
```python
class AreaSightingsResponse(BaseModel):
    area_query: str
    sightings: List[Entry]
    unique_cats: int           # Count of distinct cat_ids
    unassigned_count: int      # Sightings with no cat_id
    suggested_groups: List[SuggestedGroup]  # AI-suggested groupings
```

#### 3.2 Suggested Groupings Model

```python
class SuggestedGroup(BaseModel):
    confidence: float          # 0.0-1.0 likelihood same cat
    entry_ids: List[int]       # Entries in this group
    reason: str                # e.g., "Similar description: orange tabby"
    existing_cat_id: Optional[int]  # If matches existing cat
```

---

## Database Changes

### No Schema Changes Required for Phase 1-2

The existing schema supports all Phase 1 and Phase 2 features:
- `entries.location` - Already stores location data
- `entries.cat_id` - Already supports linking to cats
- `cats` table - Already exists for cat profiles

### Optional Enhancement: Location Index

For better performance with larger datasets:

```sql
CREATE INDEX idx_entries_location ON entries(location);
```

---

## Implementation Priority

| Phase | Feature | Complexity | Impact |
|-------|---------|------------|--------|
| 1.1 | Preview matches by location | Low | High |
| 1.2 | Location normalization | Low | Medium |
| 2.1 | Bulk link sightings | Low | High |
| 2.2 | Create cat from sightings | Medium | High |
| 3.1 | Area-based clustering | Medium | Medium |
| 3.2 | Suggested groupings | High | Medium |

---

## API Flow Example

### User Story: "I spotted a cat at Central Park"

```
1. User types location "Central Park" in the app

2. App calls: GET /entries/preview-matches?location=Central%20Park

   Response:
   [
     {
       "entry_id": 42,
       "location": "Central Park entrance",
       "location_similarity": 0.85,
       "text_preview": "Orange tabby with white paws, very friendly...",
       "cat_id": 5,
       "cat_name": "Marmalade"
     },
     {
       "entry_id": 38,
       "location": "Near Central Park bench",
       "location_similarity": 0.72,
       "text_preview": "Tabby cat with orange fur, came up to me...",
       "cat_id": null,
       "cat_name": null
     }
   ]

3. App shows: "Found 2 sightings near this location!"
   - "Marmalade" at Central Park entrance (85% match)
   - Unassigned sighting near Central Park bench (72% match)

4. User creates their sighting:
   POST /entries
   {
     "text": "Orange tabby cat at the fountain, very friendly",
     "location": "Central Park fountain"
   }
   Returns entry_id: 55

5. User confirms it's the same cat as entry 42:
   POST /entries/55/assign/5

   Now entry 55 is linked to cat "Marmalade" (cat_id: 5)

6. User also thinks entry 38 is the same cat:
   POST /cats/5/link-sightings
   {
     "entry_ids": [38]
   }

   Now all 3 sightings are linked to "Marmalade"
```

---

## Testing Requirements

### Unit Tests

1. **Location normalization tests**
   - Common abbreviations (st, ave, rd)
   - Filler word removal
   - Case insensitivity

2. **Preview matches tests**
   - Empty location returns empty results
   - Matching locations return sorted by similarity
   - Min_score filtering works correctly

3. **Bulk linking tests**
   - Valid entry IDs are linked
   - Invalid entry IDs return in `failed` list
   - Already-linked entries return in `already_linked`

### Integration Tests

1. **Full workflow test**
   - Create 3 sightings in same area
   - Preview matches for new location
   - Create new sighting
   - Link all to same cat
   - Verify cat profile shows all sightings

---

## Files to Modify

| File | Changes |
|------|---------|
| `backend/main.py` | Add new endpoints, location normalization |
| `backend/tests/test_api.py` | Add unit tests for new functions |
| `backend/tests/test_integration.py` | Add workflow tests |

---

## Success Metrics

1. **Deduplication rate** - % of sightings successfully linked to existing cats
2. **False positive rate** - Incorrectly suggested matches
3. **User confirmation rate** - % of suggested matches that users confirm

---

## Future Enhancements (Out of Scope)

- Geolocation coordinates (lat/lng) for precise area matching
- Image-based cat recognition for visual matching
- Machine learning model for better similarity scoring
- Push notifications for new sightings in watched areas
