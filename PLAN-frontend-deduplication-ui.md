# Frontend: Cat Deduplication UI Implementation Plan

## Overview

Add frontend UI components to expose the cat sighting deduplication features implemented in the backend. This enables users to:
1. Automatically normalize locations when creating entries
2. Find similar/nearby sightings for any entry
3. Create cats from grouped sightings
4. Visualize sightings on a map with clustering

## Current Frontend Architecture

- **Framework**: React 19 + TypeScript + Vite
- **State**: Local component state + custom hooks (`useApi`, `useMutation`)
- **API**: Typed client with resilience patterns (retry, timeout, circuit breaker)
- **Styling**: CSS variables + inline styles (no framework)
- **Structure**: Monolithic `App.tsx` - opportunity for refactoring

---

## Phase 1: Auto-Normalize Location on Entry Creation

### Goal
Automatically geocode the location field after an entry is created.

### Changes

#### 1.1 Add API Endpoint (`frontend/src/api/endpoints.ts`)
```typescript
export async function normalizeEntryLocation(entryId: number, force = false) {
  return post<LocationNormalizationResult>(
    `/entries/${entryId}/normalize-location?force=${force}`
  );
}
```

#### 1.2 Add Type Definition (`frontend/src/types/api.ts`)
```typescript
export interface LocationNormalizationResult {
  entry_id: number;
  original_location: string;
  normalized_location?: string;
  latitude?: number;
  longitude?: number;
  osm_id?: string;
  status: 'success' | 'not_found' | 'already_normalized' | 'no_location' | 'error';
  message?: string;
}
```

#### 1.3 Update Entry Creation Flow (`frontend/src/App.tsx`)
After creating an entry with a location, automatically call normalize:

```typescript
const handleAddEntry = async () => {
  // ... existing entry creation logic ...
  const newEntry = await createEntry(payload);

  // Auto-normalize if location provided
  if (newEntry.location) {
    try {
      await normalizeEntryLocation(newEntry.id);
      // Refresh entries to get updated coordinates
      await refetchEntries();
    } catch (err) {
      console.warn('Location normalization failed:', err);
      // Non-blocking - entry still created
    }
  }
};
```

#### 1.4 Show Normalization Status
Add visual indicator on entries showing:
- Location normalized (green checkmark + coordinates)
- Pending normalization (spinner)
- Failed to normalize (yellow warning)

### Tests
- Entry with location triggers normalization
- Entry without location skips normalization
- Normalization failure doesn't block entry creation
- UI shows correct status indicators

---

## Phase 2: Find Similar/Nearby Panel

### Goal
Allow users to view similar sightings and nearby sightings for any entry.

### Changes

#### 2.1 Add API Endpoints (`frontend/src/api/endpoints.ts`)
```typescript
export async function getNearbySightings(
  entryId: number,
  radiusMeters = 500,
  topK = 10,
  includeAssigned = true
) {
  const params = new URLSearchParams({
    radius_meters: radiusMeters.toString(),
    top_k: topK.toString(),
    include_assigned: includeAssigned.toString(),
  });
  return get<NearbySighting[]>(`/entries/${entryId}/nearby?${params}`);
}
```

#### 2.2 Add Types (`frontend/src/types/api.ts`)
```typescript
export interface NearbySighting {
  entry_id: number;
  distance_meters: number;
  location?: string;
  location_normalized?: string;
  text_preview: string;
  cat_id?: number;
  cat_name?: string;
  created_at: string;
  match_score: number;
  reasons: string[];
}
```

#### 2.3 Create `SimilarNearbyPanel` Component
New file: `frontend/src/components/SimilarNearbyPanel.tsx`

```typescript
interface Props {
  entryId: number;
  entryHasCoordinates: boolean;
  onSelectEntries: (entryIds: number[]) => void;
}

export function SimilarNearbyPanel({ entryId, entryHasCoordinates, onSelectEntries }: Props) {
  // Tabs: "Similar" (text-based) | "Nearby" (location-based)
  // List of matches with checkboxes for selection
  // "Create Cat from Selected" button
}
```

#### 2.4 UI Features
- **Tabs**: Switch between "Similar" (text matching) and "Nearby" (geographic)
- **Match cards** showing:
  - Text preview
  - Location
  - Distance (for nearby)
  - Match score with reasons
  - Existing cat assignment (if any)
- **Checkbox selection** for bulk operations
- **Radius slider** for nearby search (100m - 2km)
- **Action buttons**: "Create Cat from Selected", "Link to Existing Cat"

#### 2.5 Integration Point
Add "Find Similar" button to each entry card in the list.

### Tests
- Panel loads matches correctly
- Tab switching works
- Checkbox selection state management
- Radius slider updates results
- Action buttons trigger correct flows

---

## Phase 3: Create Cat from Sightings Workflow

### Goal
Allow users to create a new cat profile from selected sightings.

### Changes

#### 3.1 Add API Endpoints (`frontend/src/api/endpoints.ts`)
```typescript
export async function createCatFromSightings(entryIds: number[], name?: string) {
  return post<Cat>('/cats/from-sightings', { entry_ids: entryIds, name });
}

export async function linkSightingsToCat(catId: number, entryIds: number[]) {
  return post<LinkSightingsResponse>(`/cats/${catId}/link-sightings`, { entry_ids: entryIds });
}
```

#### 3.2 Add Types
```typescript
export interface LinkSightingsResponse {
  cat_id: number;
  linked_count: number;
  already_linked: number[];
  newly_linked: number[];
  failed: number[];
}
```

#### 3.3 Create `CreateCatModal` Component
New file: `frontend/src/components/CreateCatModal.tsx`

```typescript
interface Props {
  selectedEntryIds: number[];
  onClose: () => void;
  onSuccess: (cat: Cat) => void;
}

export function CreateCatModal({ selectedEntryIds, onClose, onSuccess }: Props) {
  // Show selected entries preview
  // Name input field (optional)
  // Suggested name based on location
  // Create button
}
```

#### 3.4 Create `LinkToCatModal` Component
New file: `frontend/src/components/LinkToCatModal.tsx`

```typescript
interface Props {
  selectedEntryIds: number[];
  onClose: () => void;
  onSuccess: (response: LinkSightingsResponse) => void;
}

export function LinkToCatModal({ selectedEntryIds, onClose, onSuccess }: Props) {
  // Searchable cat dropdown
  // Selected entries preview
  // Link button
  // Result summary (newly linked, already linked, failed)
}
```

#### 3.5 Workflow Steps
1. User selects entries from Similar/Nearby panel
2. Clicks "Create Cat" or "Link to Cat"
3. Modal opens with preview
4. User optionally enters name
5. Submit creates cat and links entries
6. Success message with link to cat profile

### Tests
- Modal opens with correct entries
- Name field updates state
- Create API called with correct payload
- Success callback triggers refresh
- Error handling shows user message

---

## Phase 4: Map View with Clustering

### Goal
Visual map display of sightings with clustering for nearby points.

### Changes

#### 4.1 Add Map Library
```bash
npm install leaflet react-leaflet @types/leaflet
```

Update `package.json`:
```json
{
  "dependencies": {
    "leaflet": "^1.9.4",
    "react-leaflet": "^4.2.1"
  },
  "devDependencies": {
    "@types/leaflet": "^1.9.8"
  }
}
```

#### 4.2 Add API Endpoints
```typescript
export async function getEntriesByArea(
  lat: number,
  lon: number,
  radiusMeters = 500,
  includeAssigned = true
) {
  const params = new URLSearchParams({
    lat: lat.toString(),
    lon: lon.toString(),
    radius: radiusMeters.toString(),
    include_assigned: includeAssigned.toString(),
  });
  return get<AreaQueryResponse>(`/entries/by-area?${params}`);
}

export async function getSuggestedGroupings(
  lat: number,
  lon: number,
  radiusMeters = 500,
  clusterRadius = 100,
  minSightings = 2
) {
  const params = new URLSearchParams({
    lat: lat.toString(),
    lon: lon.toString(),
    radius: radiusMeters.toString(),
    cluster_radius: clusterRadius.toString(),
    min_sightings: minSightings.toString(),
  });
  return get<SuggestedGroupingsResponse>(`/entries/by-area/suggested-groups?${params}`);
}
```

#### 4.3 Add Types
```typescript
export interface AreaSighting {
  entry_id: number;
  text_preview: string;
  location?: string;
  location_normalized?: string;
  latitude: number;
  longitude: number;
  cat_id?: number;
  cat_name?: string;
  created_at: string;
}

export interface AreaQueryResponse {
  center_lat: number;
  center_lon: number;
  radius_meters: number;
  total_count: number;
  unassigned_count: number;
  sightings: AreaSighting[];
}

export interface SuggestedGroup {
  group_id: number;
  confidence: number;
  center_lat: number;
  center_lon: number;
  radius_meters: number;
  entry_ids: number[];
  reasons: string[];
  suggested_name?: string;
}

export interface SuggestedGroupingsResponse {
  area_center_lat: number;
  area_center_lon: number;
  area_radius_meters: number;
  total_unassigned: number;
  groups: SuggestedGroup[];
}
```

#### 4.4 Create `SightingsMap` Component
New file: `frontend/src/components/SightingsMap.tsx`

```typescript
interface Props {
  entries: Entry[];
  suggestedGroups?: SuggestedGroup[];
  onEntryClick: (entryId: number) => void;
  onGroupClick: (group: SuggestedGroup) => void;
  onAreaSelect: (lat: number, lon: number, radius: number) => void;
}

export function SightingsMap({ entries, suggestedGroups, onEntryClick, onGroupClick }: Props) {
  // Leaflet map with OpenStreetMap tiles
  // Markers for each entry with coordinates
  // Cluster markers for suggested groups
  // Popup on marker click showing entry preview
  // Click on cluster to select all entries in group
}
```

#### 4.5 Map Features
- **Base map**: OpenStreetMap tiles (free, no API key)
- **Entry markers**:
  - Blue: Unassigned sightings
  - Green: Assigned to a cat
  - Icon shows cat silhouette
- **Cluster visualization**:
  - Circle showing cluster radius
  - Number badge showing entry count
  - Confidence-based color (green = high, yellow = medium)
- **Interactions**:
  - Click marker: Show popup with entry details
  - Click cluster: Select all entries, show "Create Cat" option
  - Pan/zoom: Load entries in visible area
- **Controls**:
  - Toggle assigned/unassigned filter
  - Radius selector for clustering
  - "Show Suggested Groups" toggle

#### 4.6 Add Map Tab to App
Update `App.tsx` to include map view:

```typescript
// Add tab navigation
const [viewMode, setViewMode] = useState<'list' | 'map'>('list');

// Render based on mode
{viewMode === 'list' ? (
  <EntryList entries={entries} ... />
) : (
  <SightingsMap entries={entriesWithCoords} ... />
)}
```

#### 4.7 Leaflet CSS
Import in `main.tsx` or component:
```typescript
import 'leaflet/dist/leaflet.css';
```

### Tests
- Map renders with correct tiles
- Markers placed at correct coordinates
- Popup shows on marker click
- Cluster visualization renders
- Filter toggles work
- Area selection triggers API call

---

## Implementation Order

| Phase | Priority | Effort | Dependencies |
|-------|----------|--------|--------------|
| 1. Auto-normalize | High | Small | None |
| 2. Similar/Nearby Panel | High | Medium | Phase 1 |
| 3. Create Cat Workflow | High | Medium | Phase 2 |
| 4. Map View | Medium | Large | Phase 1 |

**Recommended order**: 1 → 2 → 3 → 4

---

## File Structure After Implementation

```
frontend/src/
├── api/
│   ├── endpoints.ts        # + new deduplication endpoints
│   └── client.ts
├── components/
│   ├── ImageUpload.tsx     # existing
│   ├── SimilarNearbyPanel.tsx   # NEW
│   ├── CreateCatModal.tsx       # NEW
│   ├── LinkToCatModal.tsx       # NEW
│   ├── SightingsMap.tsx         # NEW
│   ├── EntryCard.tsx            # NEW (refactor from App.tsx)
│   └── LocationStatus.tsx       # NEW
├── types/
│   ├── api.ts              # + new response types
│   └── errors.ts
├── hooks/
│   ├── useApi.ts
│   ├── useMutation.ts
│   └── useMapEntries.ts    # NEW
├── App.tsx                 # Updated with tabs, modals
└── main.tsx
```

---

## Dependencies to Add

```json
{
  "dependencies": {
    "leaflet": "^1.9.4",
    "react-leaflet": "^4.2.1"
  },
  "devDependencies": {
    "@types/leaflet": "^1.9.8"
  }
}
```

---

## Estimated Effort

| Phase | Components | Estimated Time |
|-------|------------|----------------|
| Phase 1 | 2 small changes | 2-3 hours |
| Phase 2 | 1 new component | 4-6 hours |
| Phase 3 | 2 new components | 4-6 hours |
| Phase 4 | 1 complex component | 6-8 hours |

**Total**: ~16-23 hours of development

---

## Success Criteria

1. **Phase 1**: Entries with locations get auto-normalized, UI shows status
2. **Phase 2**: Users can find and select similar/nearby sightings
3. **Phase 3**: Users can create cats from selected sightings in 3 clicks
4. **Phase 4**: Map shows all sightings with clustering, users can create cats from map
