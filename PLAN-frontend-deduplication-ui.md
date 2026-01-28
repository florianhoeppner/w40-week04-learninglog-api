# Frontend: Cat Deduplication UI Implementation Plan

## Overview

Add frontend UI components to expose the cat sighting deduplication features implemented in the backend. This enables users to:
1. Automatically normalize locations when creating entries
2. Find similar/nearby sightings for any entry
3. Create cats from grouped sightings
4. Visualize sightings on a map with clustering

## Design Principles

### Usability First
- **Progressive disclosure**: Show simple actions first, advanced options on demand
- **Immediate feedback**: Every action gets visual confirmation within 200ms
- **Error recovery**: Clear error messages with actionable next steps
- **Undo support**: Allow reverting accidental actions where possible

### User Feedback Patterns
- **Toast notifications**: Success/error messages that auto-dismiss
- **Loading states**: Skeleton screens and spinners for async operations
- **Progress indicators**: For multi-step workflows
- **Inline validation**: Real-time feedback on form inputs
- **Empty states**: Helpful guidance when no data exists

## Current Frontend Architecture

- **Framework**: React 19 + TypeScript + Vite
- **State**: Local component state + custom hooks (`useApi`, `useMutation`)
- **API**: Typed client with resilience patterns (retry, timeout, circuit breaker)
- **Styling**: CSS variables + inline styles (no framework)
- **Structure**: Monolithic `App.tsx` - opportunity for refactoring
- **Testing**: Vitest + React Testing Library

---

## Shared Components (Phase 0)

### 0.1 Toast Notification System
New file: `frontend/src/components/Toast.tsx`

```typescript
interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  onClose: () => void;
  action?: { label: string; onClick: () => void }; // Optional undo button
}

// Toast context for app-wide notifications
export const ToastProvider: React.FC<{ children: React.ReactNode }>;
export const useToast: () => {
  showSuccess: (message: string, action?: ToastAction) => void;
  showError: (message: string, details?: string) => void;
  showWarning: (message: string) => void;
  showInfo: (message: string) => void;
};
```

**User-friendly error messages mapping:**
```typescript
const ERROR_MESSAGES: Record<string, string> = {
  'NETWORK_ERROR': 'Unable to connect. Please check your internet connection.',
  'TIMEOUT_ERROR': 'Request took too long. Please try again.',
  'NOT_FOUND': 'The item you requested could not be found.',
  'SERVER_ERROR': 'Something went wrong on our end. Please try again later.',
  'CIRCUIT_BREAKER_OPEN': 'Service temporarily unavailable. Please wait a moment.',
  'VALIDATION_ERROR': 'Please check your input and try again.',
};
```

### 0.2 Loading States
New file: `frontend/src/components/LoadingStates.tsx`

```typescript
// Skeleton loaders for different content types
export const EntrySkeleton: React.FC;
export const MapSkeleton: React.FC;
export const ListSkeleton: React.FC<{ count: number }>;

// Spinner with optional message
export const Spinner: React.FC<{ message?: string; size?: 'sm' | 'md' | 'lg' }>;

// Button with loading state
export const LoadingButton: React.FC<{
  loading: boolean;
  loadingText?: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}>;
```

### 0.3 Confirmation Dialog
New file: `frontend/src/components/ConfirmDialog.tsx`

```typescript
interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}
```

### Tests for Shared Components
```typescript
// frontend/src/components/__tests__/Toast.test.tsx
describe('Toast', () => {
  it('renders success toast with correct styling');
  it('renders error toast with details');
  it('auto-dismisses after duration');
  it('shows undo button when action provided');
  it('calls action callback when undo clicked');
});

describe('LoadingButton', () => {
  it('shows spinner when loading');
  it('disables button when loading');
  it('shows loadingText when provided');
});

describe('ConfirmDialog', () => {
  it('renders title and message');
  it('calls onConfirm when confirmed');
  it('calls onCancel when cancelled');
  it('closes on escape key');
});
```

---

## Phase 1: Auto-Normalize Location on Entry Creation

### Goal
Automatically geocode the location field after an entry is created, with clear feedback to the user.

### User Experience Flow
1. User enters location text (e.g., "Central Park, NYC")
2. User submits entry → Entry created immediately with success toast
3. Background: Location normalization starts → Small spinner on entry
4. Success: Green checkmark appears, tooltip shows normalized address
5. Failure: Yellow warning icon, tooltip explains issue with retry option

### Changes

#### 1.1 Add API Endpoint (`frontend/src/api/endpoints.ts`)
```typescript
export async function normalizeEntryLocation(entryId: number, force = false) {
  return post<LocationNormalizationResult>(
    `/entries/${entryId}/normalize-location?force=${force}`
  );
}

export async function getGeocodingHealth() {
  return get<GeocodingHealthResponse>('/health/geocoding');
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

export interface GeocodingHealthResponse {
  service: string;
  circuit_state: 'closed' | 'open' | 'half_open';
  failure_count: number;
  last_failure?: string;
  status: 'healthy' | 'degraded' | 'unavailable';
}
```

#### 1.3 Create `LocationStatus` Component
New file: `frontend/src/components/LocationStatus.tsx`

```typescript
interface LocationStatusProps {
  entry: Entry;
  onRetryNormalize: (entryId: number) => void;
}

export function LocationStatus({ entry, onRetryNormalize }: LocationStatusProps) {
  // States: normalizing, normalized, failed, no_location

  // Normalized: Green checkmark with tooltip showing full address
  // Failed: Yellow warning with "Retry" button
  // Normalizing: Small spinner
  // No location: Gray dash
}
```

**Status messages for users:**
```typescript
const LOCATION_STATUS_MESSAGES = {
  success: 'Location verified',
  not_found: 'Location not found on map. Check spelling or try a nearby landmark.',
  error: 'Could not verify location. Click to retry.',
  no_location: 'No location provided',
  already_normalized: 'Location already verified',
};
```

#### 1.4 Update Entry Creation Flow (`frontend/src/App.tsx`)
```typescript
const handleAddEntry = async () => {
  try {
    setIsCreating(true);
    const newEntry = await createEntry(payload);

    // Show immediate success feedback
    showSuccess('Sighting added successfully!');

    // Clear form
    resetForm();

    // Auto-normalize in background (non-blocking)
    if (newEntry.location) {
      setNormalizingEntries(prev => [...prev, newEntry.id]);

      try {
        const result = await normalizeEntryLocation(newEntry.id);

        if (result.status === 'success') {
          showSuccess(`Location verified: ${result.normalized_location?.split(',')[0]}`);
        } else if (result.status === 'not_found') {
          showWarning('Location not found on map. You can edit it later.');
        }

        // Refresh to get updated coordinates
        await refetchEntries();
      } catch (err) {
        // Normalization failed, but entry exists
        showWarning('Location verification delayed. Will retry automatically.');
      } finally {
        setNormalizingEntries(prev => prev.filter(id => id !== newEntry.id));
      }
    }
  } catch (err) {
    showError(
      'Failed to add sighting',
      err instanceof ApiError ? err.getUserMessage() : 'Please try again.'
    );
  } finally {
    setIsCreating(false);
  }
};
```

#### 1.5 Manual Retry for Failed Normalizations
```typescript
const handleRetryNormalize = async (entryId: number) => {
  try {
    setNormalizingEntries(prev => [...prev, entryId]);
    const result = await normalizeEntryLocation(entryId, true);

    if (result.status === 'success') {
      showSuccess('Location verified!');
      await refetchEntries();
    } else {
      showWarning(LOCATION_STATUS_MESSAGES[result.status]);
    }
  } catch (err) {
    showError('Verification failed', 'Please try again later.');
  } finally {
    setNormalizingEntries(prev => prev.filter(id => id !== entryId));
  }
};
```

### Automated Tests

#### Unit Tests (`frontend/src/components/__tests__/LocationStatus.test.tsx`)
```typescript
describe('LocationStatus', () => {
  it('shows green checkmark for normalized locations', () => {
    const entry = { ...mockEntry, location_normalized: 'Central Park, NYC', location_lat: 40.78 };
    render(<LocationStatus entry={entry} onRetryNormalize={jest.fn()} />);
    expect(screen.getByTestId('status-success')).toBeInTheDocument();
  });

  it('shows spinner while normalizing', () => {
    const entry = { ...mockEntry, location: 'Test', location_lat: null };
    render(<LocationStatus entry={entry} onRetryNormalize={jest.fn()} isNormalizing={true} />);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('shows warning with retry button for failed normalization', () => {
    const entry = { ...mockEntry, location: 'Invalid Location XYZ', location_lat: null };
    const onRetry = jest.fn();
    render(<LocationStatus entry={entry} onRetryNormalize={onRetry} />);
    expect(screen.getByText('Retry')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledWith(entry.id);
  });

  it('shows tooltip with full normalized address on hover', async () => {
    const entry = { ...mockEntry, location_normalized: 'Central Park, New York, NY 10024, USA' };
    render(<LocationStatus entry={entry} onRetryNormalize={jest.fn()} />);
    fireEvent.mouseEnter(screen.getByTestId('status-success'));
    await waitFor(() => {
      expect(screen.getByText(/Central Park, New York/)).toBeInTheDocument();
    });
  });
});
```

#### Integration Tests (`frontend/src/App.test.tsx`)
```typescript
describe('Entry Creation with Location Normalization', () => {
  it('creates entry and normalizes location in background', async () => {
    // Mock API calls
    server.use(
      rest.post('/entries', (req, res, ctx) => res(ctx.json(mockEntry))),
      rest.post('/entries/1/normalize-location', (req, res, ctx) =>
        res(ctx.json({ status: 'success', normalized_location: 'Central Park, NYC' }))
      )
    );

    render(<App />);

    // Fill form
    await userEvent.type(screen.getByLabelText(/notes/i), 'Spotted a cat');
    await userEvent.type(screen.getByLabelText(/location/i), 'Central Park');
    await userEvent.click(screen.getByRole('button', { name: /add sighting/i }));

    // Check success toast
    await waitFor(() => {
      expect(screen.getByText(/sighting added/i)).toBeInTheDocument();
    });

    // Check normalization success
    await waitFor(() => {
      expect(screen.getByText(/location verified/i)).toBeInTheDocument();
    });
  });

  it('shows warning when location not found', async () => {
    server.use(
      rest.post('/entries', (req, res, ctx) => res(ctx.json(mockEntry))),
      rest.post('/entries/1/normalize-location', (req, res, ctx) =>
        res(ctx.json({ status: 'not_found', message: 'Location not found' }))
      )
    );

    render(<App />);
    await submitEntryForm('Invalid Location XYZ');

    await waitFor(() => {
      expect(screen.getByText(/not found on map/i)).toBeInTheDocument();
    });
  });

  it('entry creation succeeds even if normalization fails', async () => {
    server.use(
      rest.post('/entries', (req, res, ctx) => res(ctx.json(mockEntry))),
      rest.post('/entries/1/normalize-location', (req, res, ctx) =>
        res(ctx.status(500), ctx.json({ detail: 'Service unavailable' }))
      )
    );

    render(<App />);
    await submitEntryForm('Some Location');

    // Entry should still appear
    await waitFor(() => {
      expect(screen.getByText(/spotted a cat/i)).toBeInTheDocument();
    });

    // Warning about delayed verification
    expect(screen.getByText(/verification delayed/i)).toBeInTheDocument();
  });
});
```

### Error Handling

| Error | User Message | Recovery Action |
|-------|--------------|-----------------|
| Network error during normalization | "Location verification delayed. Will retry automatically." | Auto-retry on next app load |
| Location not found | "Location not found on map. Check spelling or try a nearby landmark." | Show edit button |
| Service unavailable (circuit open) | "Location service temporarily busy. Will verify shortly." | Auto-retry when circuit closes |
| Invalid location format | "Please enter a valid address or landmark name." | Focus input for correction |

---

## Phase 2: Find Similar/Nearby Panel

### Goal
Allow users to discover potentially duplicate sightings with an intuitive, guided interface.

### User Experience Flow
1. User clicks "Find Similar" on an entry → Panel slides in from right
2. Two tabs: "Similar Text" (always available) and "Nearby" (if location normalized)
3. Matches shown as cards with match score badges and reasons
4. User selects matches with checkboxes
5. Action bar appears: "Create New Cat (3 selected)" or "Add to Existing Cat"
6. Confirmation before action → Success with undo option

### Changes

#### 2.1 Add API Endpoints (`frontend/src/api/endpoints.ts`)
```typescript
export async function getMatchesForEntry(
  entryId: number,
  topK = 10,
  minScore = 0.15
) {
  const params = new URLSearchParams({
    top_k: topK.toString(),
    min_score: minScore.toString(),
  });
  return get<MatchCandidate[]>(`/entries/${entryId}/matches?${params}`);
}

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
export interface MatchCandidate {
  entry_id: number;
  candidate_id: number;
  score: number;
  reasons: string[];
  candidate_nickname?: string;
  candidate_location?: string;
  candidate_text: string;
  candidate_createdAt: string;
}

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
  entry: Entry;
  isOpen: boolean;
  onClose: () => void;
  onCreateCat: (entryIds: number[]) => void;
  onLinkToCat: (entryIds: number[], catId: number) => void;
}

export function SimilarNearbyPanel({ entry, isOpen, onClose, onCreateCat, onLinkToCat }: Props) {
  const [activeTab, setActiveTab] = useState<'similar' | 'nearby'>('similar');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set([entry.id]));
  const [radius, setRadius] = useState(500);

  // Fetch data
  const { data: matches, loading: matchesLoading, error: matchesError } = useApi(
    () => getMatchesForEntry(entry.id),
    [entry.id]
  );

  const canShowNearby = entry.location_lat !== null;
  const { data: nearby, loading: nearbyLoading, error: nearbyError } = useApi(
    () => canShowNearby ? getNearbySightings(entry.id, radius) : Promise.resolve([]),
    [entry.id, radius, canShowNearby]
  );

  // Selection handlers
  const toggleSelection = (id: number) => { ... };
  const selectAll = () => { ... };
  const deselectAll = () => { ... };

  return (
    <SlidePanel isOpen={isOpen} onClose={onClose} title="Find Similar Sightings">
      {/* Tab Navigation */}
      <TabBar>
        <Tab active={activeTab === 'similar'} onClick={() => setActiveTab('similar')}>
          Similar Text {matches?.length ? `(${matches.length})` : ''}
        </Tab>
        <Tab
          active={activeTab === 'nearby'}
          onClick={() => setActiveTab('nearby')}
          disabled={!canShowNearby}
          tooltip={!canShowNearby ? 'Location not verified yet' : undefined}
        >
          Nearby {nearby?.length ? `(${nearby.length})` : ''}
        </Tab>
      </TabBar>

      {/* Radius Slider (for nearby tab) */}
      {activeTab === 'nearby' && (
        <RadiusSlider value={radius} onChange={setRadius} min={100} max={2000} step={100} />
      )}

      {/* Match List */}
      <MatchList>
        {activeTab === 'similar' && (
          matchesLoading ? <ListSkeleton count={3} /> :
          matchesError ? <ErrorState message="Couldn't load matches" onRetry={refetchMatches} /> :
          matches?.length === 0 ? <EmptyState message="No similar sightings found" /> :
          matches?.map(match => (
            <MatchCard
              key={match.candidate_id}
              match={match}
              selected={selectedIds.has(match.candidate_id)}
              onToggle={() => toggleSelection(match.candidate_id)}
            />
          ))
        )}
        {/* Similar for nearby tab */}
      </MatchList>

      {/* Selection Action Bar */}
      {selectedIds.size > 1 && (
        <ActionBar>
          <span>{selectedIds.size} sightings selected</span>
          <Button onClick={() => onCreateCat(Array.from(selectedIds))}>
            Create New Cat
          </Button>
          <Button variant="secondary" onClick={() => setShowLinkModal(true)}>
            Add to Existing Cat
          </Button>
        </ActionBar>
      )}
    </SlidePanel>
  );
}
```

#### 2.4 Create `MatchCard` Component
New file: `frontend/src/components/MatchCard.tsx`

```typescript
interface MatchCardProps {
  match: MatchCandidate | NearbySighting;
  selected: boolean;
  onToggle: () => void;
}

export function MatchCard({ match, selected, onToggle }: MatchCardProps) {
  const score = 'score' in match ? match.score : match.match_score;
  const scoreLabel = score > 0.7 ? 'High' : score > 0.4 ? 'Medium' : 'Low';
  const scoreColor = score > 0.7 ? 'green' : score > 0.4 ? 'yellow' : 'gray';

  return (
    <Card selected={selected} onClick={onToggle}>
      <Checkbox checked={selected} onChange={onToggle} aria-label="Select sighting" />

      <CardContent>
        <TextPreview>{match.candidate_text || match.text_preview}</TextPreview>

        {'distance_meters' in match && (
          <Distance>{formatDistance(match.distance_meters)} away</Distance>
        )}

        {match.cat_name && (
          <CatBadge>Linked to: {match.cat_name}</CatBadge>
        )}
      </CardContent>

      <ScoreBadge color={scoreColor} title={`Match score: ${(score * 100).toFixed(0)}%`}>
        {scoreLabel} match
      </ScoreBadge>

      <Tooltip content={match.reasons.join(', ')}>
        <InfoIcon />
      </Tooltip>
    </Card>
  );
}
```

#### 2.5 Empty and Error States
```typescript
// Empty state messages
const EMPTY_STATES = {
  similar: {
    title: 'No similar sightings found',
    description: 'This sighting appears to be unique. Try adding more sightings to find patterns.',
  },
  nearby: {
    title: 'No sightings nearby',
    description: 'No other sightings within the selected radius. Try increasing the search area.',
  },
  noLocation: {
    title: 'Location not available',
    description: 'This sighting\'s location hasn\'t been verified yet. The "Nearby" search requires a verified location.',
    action: { label: 'Verify Location', onClick: () => retryNormalize(entry.id) },
  },
};

// Error recovery
const ERROR_STATES = {
  loadFailed: {
    title: 'Couldn\'t load matches',
    description: 'There was a problem loading similar sightings.',
    action: { label: 'Try Again', onClick: refetch },
  },
};
```

### Automated Tests

#### Unit Tests (`frontend/src/components/__tests__/SimilarNearbyPanel.test.tsx`)
```typescript
describe('SimilarNearbyPanel', () => {
  it('renders similar tab by default', () => {
    render(<SimilarNearbyPanel entry={mockEntry} isOpen={true} ... />);
    expect(screen.getByRole('tab', { name: /similar/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('disables nearby tab when entry has no coordinates', () => {
    const entryNoCoords = { ...mockEntry, location_lat: null };
    render(<SimilarNearbyPanel entry={entryNoCoords} isOpen={true} ... />);
    expect(screen.getByRole('tab', { name: /nearby/i })).toBeDisabled();
  });

  it('shows loading skeleton while fetching matches', () => {
    server.use(rest.get('/entries/1/matches', delayedResponse(1000)));
    render(<SimilarNearbyPanel entry={mockEntry} isOpen={true} ... />);
    expect(screen.getByTestId('list-skeleton')).toBeInTheDocument();
  });

  it('shows empty state when no matches found', async () => {
    server.use(rest.get('/entries/1/matches', (req, res, ctx) => res(ctx.json([]))));
    render(<SimilarNearbyPanel entry={mockEntry} isOpen={true} ... />);
    await waitFor(() => {
      expect(screen.getByText(/no similar sightings/i)).toBeInTheDocument();
    });
  });

  it('shows error state with retry button on failure', async () => {
    server.use(rest.get('/entries/1/matches', (req, res, ctx) => res(ctx.status(500))));
    render(<SimilarNearbyPanel entry={mockEntry} isOpen={true} ... />);
    await waitFor(() => {
      expect(screen.getByText(/couldn't load matches/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
  });
});

describe('MatchCard selection', () => {
  it('toggles selection on click', async () => {
    const onToggle = jest.fn();
    render(<MatchCard match={mockMatch} selected={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalled();
  });

  it('shows score badge with correct color', () => {
    const highMatch = { ...mockMatch, score: 0.85 };
    render(<MatchCard match={highMatch} selected={false} onToggle={jest.fn()} />);
    expect(screen.getByText('High match')).toHaveStyle({ backgroundColor: 'green' });
  });

  it('shows cat badge when sighting is linked', () => {
    const linkedMatch = { ...mockMatch, cat_name: 'Whiskers' };
    render(<MatchCard match={linkedMatch} selected={false} onToggle={jest.fn()} />);
    expect(screen.getByText(/linked to: whiskers/i)).toBeInTheDocument();
  });
});

describe('Action bar', () => {
  it('appears when multiple items selected', async () => {
    render(<SimilarNearbyPanel entry={mockEntry} isOpen={true} ... />);
    await selectMultipleMatches([1, 2, 3]);
    expect(screen.getByText(/3 sightings selected/i)).toBeInTheDocument();
  });

  it('calls onCreateCat with selected IDs', async () => {
    const onCreateCat = jest.fn();
    render(<SimilarNearbyPanel ... onCreateCat={onCreateCat} />);
    await selectMultipleMatches([1, 2]);
    await userEvent.click(screen.getByRole('button', { name: /create new cat/i }));
    expect(onCreateCat).toHaveBeenCalledWith([mockEntry.id, 1, 2]);
  });
});

describe('Radius slider', () => {
  it('updates nearby results when radius changes', async () => {
    render(<SimilarNearbyPanel entry={entryWithCoords} isOpen={true} ... />);
    await userEvent.click(screen.getByRole('tab', { name: /nearby/i }));

    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: 1000 } });

    // Should refetch with new radius
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('radius_meters=1000'));
    });
  });
});
```

### Accessibility
- Tab navigation with arrow keys
- Checkbox selection with space bar
- Screen reader announcements for match count
- Focus management when panel opens/closes
- Keyboard shortcut: Escape to close panel

---

## Phase 3: Create Cat from Sightings Workflow

### Goal
Allow users to create a new cat profile from selected sightings with a smooth, guided experience.

### User Experience Flow

#### Create New Cat Flow
1. User selects 2+ sightings in Similar/Nearby panel → Action bar appears
2. User clicks "Create New Cat" → Modal slides up with animation
3. Modal shows:
   - Preview of selected sightings (thumbnails, locations, dates)
   - Auto-suggested name based on common location (e.g., "Central Park Cat")
   - Optional name input field with character counter
   - Count summary: "Creating cat from 3 sightings"
4. User clicks "Create Cat" → Button shows loading spinner
5. Success → Toast: "Created Whiskers with 3 sightings" + "View Cat" button
6. Modal closes, entries update to show cat assignment

#### Link to Existing Cat Flow
1. User selects sightings → Clicks "Add to Existing Cat"
2. Modal opens with searchable cat dropdown
3. User types to filter cats, sees recent/nearby cats first
4. Selects cat → Preview updates showing cat info
5. Clicks "Link Sightings" → Loading state
6. Success → Toast with summary: "Linked 2 new sightings to Whiskers (1 was already linked)"

### Changes

#### 3.1 Add API Endpoints (`frontend/src/api/endpoints.ts`)
```typescript
export async function createCatFromSightings(entryIds: number[], name?: string) {
  return post<CreateCatResponse>('/cats/from-sightings', { entry_ids: entryIds, name });
}

export async function linkSightingsToCat(catId: number, entryIds: number[]) {
  return post<LinkSightingsResponse>(`/cats/${catId}/link-sightings`, { entry_ids: entryIds });
}

export async function searchCats(query: string, limit = 10) {
  const params = new URLSearchParams({ q: query, limit: limit.toString() });
  return get<Cat[]>(`/cats/search?${params}`);
}
```

#### 3.2 Add Types (`frontend/src/types/api.ts`)
```typescript
export interface CreateCatResponse {
  cat: Cat;
  linked_entries: number[];
  suggested_name_used: boolean;
}

export interface LinkSightingsResponse {
  cat_id: number;
  cat_name: string;
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
  entries: Entry[];
  onClose: () => void;
  onSuccess: (cat: Cat) => void;
}

export function CreateCatModal({ selectedEntryIds, entries, onClose, onSuccess }: Props) {
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const { showSuccess, showError } = useToast();

  // Filter selected entries for preview
  const selectedEntries = entries.filter(e => selectedEntryIds.includes(e.id));

  // Generate suggested name from common location
  const suggestedName = useMemo(() => {
    const locations = selectedEntries
      .map(e => e.location_normalized?.split(',')[0])
      .filter(Boolean);
    const mostCommon = getMostFrequent(locations);
    return mostCommon ? `${mostCommon} Cat` : '';
  }, [selectedEntries]);

  const handleCreate = async () => {
    try {
      setIsCreating(true);
      const catName = name.trim() || suggestedName || undefined;
      const result = await createCatFromSightings(selectedEntryIds, catName);

      showSuccess(
        `Created ${result.cat.nickname || 'new cat'} with ${result.linked_entries.length} sightings`,
        { label: 'View Cat', onClick: () => navigateToCat(result.cat.id) }
      );

      onSuccess(result.cat);
      onClose();
    } catch (err) {
      showError(
        'Failed to create cat',
        err instanceof ApiError ? err.getUserMessage() : 'Please try again.'
      );
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Create New Cat">
      {/* Sightings Preview */}
      <SightingsPreview entries={selectedEntries} maxVisible={3} />

      <p className="modal-summary">
        Creating cat from <strong>{selectedEntryIds.length} sightings</strong>
      </p>

      {/* Name Input */}
      <div className="form-group">
        <label htmlFor="cat-name">Cat Name (optional)</label>
        <input
          id="cat-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={suggestedName || 'Enter a name...'}
          maxLength={100}
          autoFocus
        />
        <span className="char-count">{name.length}/100</span>
        {suggestedName && !name && (
          <span className="suggested-name">
            Suggested: {suggestedName}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={isCreating}>
          Cancel
        </Button>
        <LoadingButton
          loading={isCreating}
          loadingText="Creating..."
          onClick={handleCreate}
        >
          Create Cat
        </LoadingButton>
      </div>
    </Modal>
  );
}
```

#### 3.4 Create `LinkToCatModal` Component
New file: `frontend/src/components/LinkToCatModal.tsx`

```typescript
interface Props {
  selectedEntryIds: number[];
  entries: Entry[];
  onClose: () => void;
  onSuccess: (response: LinkSightingsResponse) => void;
}

export function LinkToCatModal({ selectedEntryIds, entries, onClose, onSuccess }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCat, setSelectedCat] = useState<Cat | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  const { showSuccess, showError, showWarning } = useToast();

  // Fetch cats based on search
  const { data: cats, loading: catsLoading } = useApi(
    () => searchCats(searchQuery),
    [searchQuery],
    { debounce: 300 }
  );

  const selectedEntries = entries.filter(e => selectedEntryIds.includes(e.id));

  const handleLink = async () => {
    if (!selectedCat) return;

    try {
      setIsLinking(true);
      const result = await linkSightingsToCat(selectedCat.id, selectedEntryIds);

      // Build informative message
      const messages: string[] = [];
      if (result.newly_linked.length > 0) {
        messages.push(`Linked ${result.newly_linked.length} new sighting(s)`);
      }
      if (result.already_linked.length > 0) {
        messages.push(`${result.already_linked.length} already linked`);
      }
      if (result.failed.length > 0) {
        messages.push(`${result.failed.length} failed`);
      }

      if (result.newly_linked.length > 0) {
        showSuccess(
          `${messages.join(', ')} to ${result.cat_name}`,
          { label: 'View Cat', onClick: () => navigateToCat(result.cat_id) }
        );
      } else if (result.already_linked.length === selectedEntryIds.length) {
        showWarning('All selected sightings were already linked to this cat.');
      }

      if (result.failed.length > 0) {
        showWarning(`${result.failed.length} sighting(s) could not be linked.`);
      }

      onSuccess(result);
      onClose();
    } catch (err) {
      showError(
        'Failed to link sightings',
        err instanceof ApiError ? err.getUserMessage() : 'Please try again.'
      );
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Add to Existing Cat">
      {/* Sightings Preview */}
      <SightingsPreview entries={selectedEntries} maxVisible={3} />

      <p className="modal-summary">
        Linking <strong>{selectedEntryIds.length} sightings</strong> to a cat
      </p>

      {/* Cat Search */}
      <div className="form-group">
        <label htmlFor="cat-search">Search for a cat</label>
        <SearchInput
          id="cat-search"
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Type to search cats..."
          autoFocus
        />
      </div>

      {/* Cat Results */}
      <div className="cat-list">
        {catsLoading ? (
          <ListSkeleton count={3} />
        ) : cats?.length === 0 ? (
          <EmptyState
            message={searchQuery ? 'No cats found' : 'Start typing to search'}
            icon="search"
          />
        ) : (
          cats?.map(cat => (
            <CatOption
              key={cat.id}
              cat={cat}
              selected={selectedCat?.id === cat.id}
              onClick={() => setSelectedCat(cat)}
            />
          ))
        )}
      </div>

      {/* Selected Cat Preview */}
      {selectedCat && (
        <div className="selected-cat-preview">
          <strong>Selected:</strong> {selectedCat.nickname || `Cat #${selectedCat.id}`}
          <span className="sighting-count">
            ({selectedCat.sighting_count || 0} existing sightings)
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={isLinking}>
          Cancel
        </Button>
        <LoadingButton
          loading={isLinking}
          loadingText="Linking..."
          onClick={handleLink}
          disabled={!selectedCat}
        >
          Link Sightings
        </LoadingButton>
      </div>
    </Modal>
  );
}
```

#### 3.5 Create `SightingsPreview` Component
New file: `frontend/src/components/SightingsPreview.tsx`

```typescript
interface Props {
  entries: Entry[];
  maxVisible?: number;
}

export function SightingsPreview({ entries, maxVisible = 3 }: Props) {
  const visibleEntries = entries.slice(0, maxVisible);
  const hiddenCount = entries.length - maxVisible;

  return (
    <div className="sightings-preview">
      <div className="preview-grid">
        {visibleEntries.map(entry => (
          <div key={entry.id} className="preview-item">
            {entry.imageUrl ? (
              <img src={entry.imageUrl} alt="Sighting" className="preview-image" />
            ) : (
              <div className="preview-placeholder">No image</div>
            )}
            <span className="preview-location">
              {entry.location_normalized?.split(',')[0] || entry.location || 'Unknown'}
            </span>
          </div>
        ))}
        {hiddenCount > 0 && (
          <div className="preview-more">
            +{hiddenCount} more
          </div>
        )}
      </div>
    </div>
  );
}
```

### Error Handling

| Error | User Message | Recovery Action |
|-------|--------------|-----------------|
| No sightings selected | "Please select at least one sighting." | Disable button until selection |
| Create fails (network) | "Couldn't create cat. Please check your connection." | Show retry button |
| Create fails (server) | "Something went wrong. Please try again." | Close modal, preserve selection |
| Cat search fails | "Couldn't load cats. Please try again." | Show inline retry |
| Link fails (partial) | "Linked X sightings. Y could not be linked." | Show which failed |
| All already linked | "All sightings were already linked to this cat." | Close modal |

### Automated Tests

#### Unit Tests (`frontend/src/components/__tests__/CreateCatModal.test.tsx`)
```typescript
describe('CreateCatModal', () => {
  it('renders selected entries preview', () => {
    render(<CreateCatModal selectedEntryIds={[1, 2, 3]} entries={mockEntries} ... />);
    expect(screen.getByText(/3 sightings/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('preview-item')).toHaveLength(3);
  });

  it('shows suggested name based on location', () => {
    const entries = [
      { ...mockEntry, id: 1, location_normalized: 'Central Park, NYC' },
      { ...mockEntry, id: 2, location_normalized: 'Central Park, NYC' },
    ];
    render(<CreateCatModal selectedEntryIds={[1, 2]} entries={entries} ... />);
    expect(screen.getByText(/suggested: central park cat/i)).toBeInTheDocument();
  });

  it('allows custom name input with character limit', async () => {
    render(<CreateCatModal ... />);
    const input = screen.getByLabelText(/cat name/i);
    await userEvent.type(input, 'My Custom Cat Name');
    expect(input).toHaveValue('My Custom Cat Name');
    expect(screen.getByText('18/100')).toBeInTheDocument();
  });

  it('shows loading state while creating', async () => {
    server.use(
      rest.post('/cats/from-sightings', delayedResponse(1000, { cat: mockCat }))
    );
    render(<CreateCatModal ... />);
    await userEvent.click(screen.getByRole('button', { name: /create cat/i }));
    expect(screen.getByText(/creating.../i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });

  it('calls onSuccess with new cat on success', async () => {
    const onSuccess = jest.fn();
    server.use(
      rest.post('/cats/from-sightings', (req, res, ctx) =>
        res(ctx.json({ cat: mockCat, linked_entries: [1, 2] }))
      )
    );
    render(<CreateCatModal onSuccess={onSuccess} ... />);
    await userEvent.click(screen.getByRole('button', { name: /create cat/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(mockCat);
    });
  });

  it('shows error toast on failure', async () => {
    server.use(
      rest.post('/cats/from-sightings', (req, res, ctx) =>
        res(ctx.status(500), ctx.json({ detail: 'Server error' }))
      )
    );
    render(<CreateCatModal ... />);
    await userEvent.click(screen.getByRole('button', { name: /create cat/i }));
    await waitFor(() => {
      expect(screen.getByText(/failed to create cat/i)).toBeInTheDocument();
    });
  });

  it('closes modal on cancel', async () => {
    const onClose = jest.fn();
    render(<CreateCatModal onClose={onClose} ... />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on escape key', async () => {
    const onClose = jest.fn();
    render(<CreateCatModal onClose={onClose} ... />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
```

#### Unit Tests (`frontend/src/components/__tests__/LinkToCatModal.test.tsx`)
```typescript
describe('LinkToCatModal', () => {
  it('renders search input and empty state initially', () => {
    render(<LinkToCatModal selectedEntryIds={[1, 2]} entries={mockEntries} ... />);
    expect(screen.getByPlaceholderText(/type to search/i)).toBeInTheDocument();
    expect(screen.getByText(/start typing to search/i)).toBeInTheDocument();
  });

  it('searches cats with debounce', async () => {
    const fetchSpy = jest.fn();
    server.use(
      rest.get('/cats/search', (req, res, ctx) => {
        fetchSpy(req.url.searchParams.get('q'));
        return res(ctx.json([mockCat]));
      })
    );
    render(<LinkToCatModal ... />);

    await userEvent.type(screen.getByPlaceholderText(/search/i), 'Whiskers');

    // Should debounce
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('Whiskers');
    }, { timeout: 500 });
  });

  it('disables link button until cat selected', () => {
    render(<LinkToCatModal ... />);
    expect(screen.getByRole('button', { name: /link sightings/i })).toBeDisabled();
  });

  it('enables link button when cat selected', async () => {
    server.use(rest.get('/cats/search', (req, res, ctx) => res(ctx.json([mockCat]))));
    render(<LinkToCatModal ... />);

    await userEvent.type(screen.getByPlaceholderText(/search/i), 'W');
    await userEvent.click(await screen.findByText(mockCat.nickname));

    expect(screen.getByRole('button', { name: /link sightings/i })).not.toBeDisabled();
  });

  it('shows success message with summary', async () => {
    server.use(
      rest.get('/cats/search', (req, res, ctx) => res(ctx.json([mockCat]))),
      rest.post('/cats/1/link-sightings', (req, res, ctx) =>
        res(ctx.json({
          cat_id: 1,
          cat_name: 'Whiskers',
          linked_count: 2,
          newly_linked: [1, 2],
          already_linked: [],
          failed: [],
        }))
      )
    );
    render(<LinkToCatModal ... />);

    await selectCat('Whiskers');
    await userEvent.click(screen.getByRole('button', { name: /link sightings/i }));

    await waitFor(() => {
      expect(screen.getByText(/linked 2 new sighting/i)).toBeInTheDocument();
    });
  });

  it('shows warning when all already linked', async () => {
    server.use(
      rest.post('/cats/1/link-sightings', (req, res, ctx) =>
        res(ctx.json({
          cat_id: 1,
          cat_name: 'Whiskers',
          linked_count: 0,
          newly_linked: [],
          already_linked: [1, 2],
          failed: [],
        }))
      )
    );
    render(<LinkToCatModal selectedEntryIds={[1, 2]} ... />);

    await selectCat('Whiskers');
    await userEvent.click(screen.getByRole('button', { name: /link sightings/i }));

    await waitFor(() => {
      expect(screen.getByText(/already linked/i)).toBeInTheDocument();
    });
  });

  it('shows warning for failed entries', async () => {
    server.use(
      rest.post('/cats/1/link-sightings', (req, res, ctx) =>
        res(ctx.json({
          cat_id: 1,
          cat_name: 'Whiskers',
          linked_count: 1,
          newly_linked: [1],
          already_linked: [],
          failed: [2],
        }))
      )
    );
    render(<LinkToCatModal selectedEntryIds={[1, 2]} ... />);

    await selectCat('Whiskers');
    await userEvent.click(screen.getByRole('button', { name: /link sightings/i }));

    await waitFor(() => {
      expect(screen.getByText(/1 sighting.*could not be linked/i)).toBeInTheDocument();
    });
  });
});
```

#### Integration Tests
```typescript
describe('Create Cat Workflow', () => {
  it('complete flow: select entries → create cat → view success', async () => {
    server.use(
      rest.get('/entries/1/matches', (req, res, ctx) => res(ctx.json(mockMatches))),
      rest.post('/cats/from-sightings', (req, res, ctx) =>
        res(ctx.json({ cat: mockCat, linked_entries: [1, 2, 3] }))
      )
    );

    render(<App />);

    // Open similar panel
    await userEvent.click(screen.getByRole('button', { name: /find similar/i }));

    // Select matches
    await selectMultipleMatches([1, 2]);

    // Click create cat
    await userEvent.click(screen.getByRole('button', { name: /create new cat/i }));

    // Verify modal opened
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/3 sightings/i)).toBeInTheDocument();

    // Enter name and create
    await userEvent.type(screen.getByLabelText(/cat name/i), 'Mittens');
    await userEvent.click(screen.getByRole('button', { name: /create cat/i }));

    // Verify success
    await waitFor(() => {
      expect(screen.getByText(/created mittens/i)).toBeInTheDocument();
    });
  });
});
```

### Accessibility
- Modal traps focus while open
- Close on Escape key
- Form labels properly associated
- Loading states announced to screen readers
- Action buttons have clear labels
- Focus returns to trigger element on close

---

## Phase 4: Map View with Clustering

### Goal
Visual map display of sightings with clustering for nearby points, enabling spatial discovery of potential duplicates.

### User Experience Flow

#### Initial Map Load
1. User clicks "Map" tab → Map skeleton shows while loading
2. Map centers on user's location (if permitted) or default location
3. All sightings with coordinates appear as markers
4. Unassigned = blue markers, Assigned = green with cat icon
5. Counter shows: "Showing 23 sightings (8 unassigned)"

#### Exploring Sightings
1. User pans/zooms map → Loading indicator in corner
2. Sightings in visible area load automatically (debounced)
3. Clicking marker → Popup with sighting preview + actions
4. Popup shows: image thumbnail, location, date, "View Details" / "Find Similar"

#### Discovering Clusters
1. User toggles "Show Suggested Groups" → Analysis starts
2. Cluster circles appear with confidence coloring
3. Clicking cluster → Panel shows group details + "Create Cat" button
4. Badge on cluster shows sighting count

#### Creating Cat from Map
1. User clicks cluster → Group details panel slides in
2. Shows list of sightings in group with reasons
3. User clicks "Create Cat from Group" → Same flow as Phase 3
4. Success → Markers turn green, cluster disappears

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

#### 4.2 Add API Endpoints (`frontend/src/api/endpoints.ts`)
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

#### 4.3 Add Types (`frontend/src/types/api.ts`)
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
  onEntryClick: (entryId: number) => void;
  onCreateCat: (entryIds: number[]) => void;
}

export function SightingsMap({ onEntryClick, onCreateCat }: Props) {
  const [center, setCenter] = useState<[number, number]>([40.7128, -74.006]); // NYC default
  const [zoom, setZoom] = useState(13);
  const [showAssigned, setShowAssigned] = useState(true);
  const [showGroups, setShowGroups] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<SuggestedGroup | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const { showError, showInfo } = useToast();

  // Fetch sightings for visible area
  const {
    data: areaData,
    loading: sightingsLoading,
    error: sightingsError,
    refetch: refetchSightings,
  } = useApi(
    () => getEntriesByArea(center[0], center[1], getRadiusFromZoom(zoom), showAssigned),
    [center[0], center[1], zoom, showAssigned],
    { debounce: 500 }
  );

  // Fetch suggested groups when enabled
  const {
    data: groupsData,
    loading: groupsLoading,
    error: groupsError,
  } = useApi(
    () => showGroups ? getSuggestedGroupings(center[0], center[1], getRadiusFromZoom(zoom)) : null,
    [center[0], center[1], zoom, showGroups]
  );

  // Request user location on mount
  useEffect(() => {
    if (navigator.geolocation) {
      setIsLoadingLocation(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCenter([position.coords.latitude, position.coords.longitude]);
          setIsLoadingLocation(false);
          showInfo('Centered on your location');
        },
        (error) => {
          setIsLoadingLocation(false);
          // Silently fail - use default location
          console.log('Geolocation denied, using default');
        }
      );
    }
  }, []);

  // Handle map move
  const handleMoveEnd = useCallback((map: L.Map) => {
    const newCenter = map.getCenter();
    setCenter([newCenter.lat, newCenter.lng]);
    setZoom(map.getZoom());
  }, []);

  // Handle group selection
  const handleGroupClick = (group: SuggestedGroup) => {
    setSelectedGroup(group);
  };

  // Handle create cat from group
  const handleCreateFromGroup = () => {
    if (selectedGroup) {
      onCreateCat(selectedGroup.entry_ids);
    }
  };

  return (
    <div className="map-container">
      {/* Loading overlay */}
      {(sightingsLoading || groupsLoading) && (
        <div className="map-loading-indicator">
          <Spinner size="sm" />
          Loading sightings...
        </div>
      )}

      {/* Error banner */}
      {sightingsError && (
        <div className="map-error-banner">
          <span>Couldn't load sightings.</span>
          <Button size="sm" onClick={refetchSightings}>Retry</Button>
        </div>
      )}

      {/* Map controls */}
      <div className="map-controls">
        <label className="control-toggle">
          <input
            type="checkbox"
            checked={showAssigned}
            onChange={(e) => setShowAssigned(e.target.checked)}
          />
          Show assigned sightings
        </label>
        <label className="control-toggle">
          <input
            type="checkbox"
            checked={showGroups}
            onChange={(e) => setShowGroups(e.target.checked)}
          />
          Show suggested groups
        </label>
        <Button
          size="sm"
          onClick={() => navigator.geolocation?.getCurrentPosition(
            (p) => setCenter([p.coords.latitude, p.coords.longitude])
          )}
          disabled={isLoadingLocation}
        >
          {isLoadingLocation ? <Spinner size="xs" /> : 'My Location'}
        </Button>
      </div>

      {/* Stats bar */}
      <div className="map-stats">
        {areaData && (
          <>
            <span>Showing {areaData.total_count} sightings</span>
            <span className="unassigned-count">
              ({areaData.unassigned_count} unassigned)
            </span>
            {groupsData && showGroups && (
              <span className="groups-count">
                • {groupsData.groups.length} suggested groups
              </span>
            )}
          </>
        )}
      </div>

      {/* Leaflet Map */}
      <MapContainer
        center={center}
        zoom={zoom}
        className="leaflet-map"
        whenReady={(map) => {
          map.target.on('moveend', () => handleMoveEnd(map.target));
        }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Sighting markers */}
        {areaData?.sightings.map((sighting) => (
          <SightingMarker
            key={sighting.entry_id}
            sighting={sighting}
            onClick={() => onEntryClick(sighting.entry_id)}
          />
        ))}

        {/* Cluster circles */}
        {showGroups && groupsData?.groups.map((group) => (
          <ClusterCircle
            key={group.group_id}
            group={group}
            selected={selectedGroup?.group_id === group.group_id}
            onClick={() => handleGroupClick(group)}
          />
        ))}
      </MapContainer>

      {/* Group details panel */}
      {selectedGroup && (
        <GroupDetailsPanel
          group={selectedGroup}
          sightings={areaData?.sightings.filter(s =>
            selectedGroup.entry_ids.includes(s.entry_id)
          ) || []}
          onClose={() => setSelectedGroup(null)}
          onCreateCat={handleCreateFromGroup}
        />
      )}
    </div>
  );
}

// Helper: Calculate radius from zoom level
function getRadiusFromZoom(zoom: number): number {
  // Approximate meters visible at each zoom level
  const radiusMap: Record<number, number> = {
    10: 10000,
    11: 5000,
    12: 2500,
    13: 1200,
    14: 600,
    15: 300,
    16: 150,
    17: 75,
  };
  return radiusMap[zoom] || 1000;
}
```

#### 4.5 Create `SightingMarker` Component
New file: `frontend/src/components/SightingMarker.tsx`

```typescript
interface Props {
  sighting: AreaSighting;
  onClick: () => void;
}

// Custom marker icons
const unassignedIcon = L.divIcon({
  className: 'sighting-marker unassigned',
  html: '<div class="marker-dot"></div>',
  iconSize: [20, 20],
});

const assignedIcon = L.divIcon({
  className: 'sighting-marker assigned',
  html: '<div class="marker-dot">🐱</div>',
  iconSize: [24, 24],
});

export function SightingMarker({ sighting, onClick }: Props) {
  const icon = sighting.cat_id ? assignedIcon : unassignedIcon;

  return (
    <Marker
      position={[sighting.latitude, sighting.longitude]}
      icon={icon}
      eventHandlers={{ click: onClick }}
    >
      <Popup>
        <div className="sighting-popup">
          <p className="popup-text">{sighting.text_preview}</p>
          <p className="popup-location">
            {sighting.location_normalized || sighting.location || 'Unknown location'}
          </p>
          <p className="popup-date">
            {formatDate(sighting.created_at)}
          </p>
          {sighting.cat_name && (
            <p className="popup-cat">
              Linked to: <strong>{sighting.cat_name}</strong>
            </p>
          )}
          <div className="popup-actions">
            <Button size="sm" onClick={onClick}>View Details</Button>
          </div>
        </div>
      </Popup>
    </Marker>
  );
}
```

#### 4.6 Create `ClusterCircle` Component
New file: `frontend/src/components/ClusterCircle.tsx`

```typescript
interface Props {
  group: SuggestedGroup;
  selected: boolean;
  onClick: () => void;
}

export function ClusterCircle({ group, selected, onClick }: Props) {
  // Color based on confidence
  const color = group.confidence > 0.7 ? '#22c55e' : // green
                group.confidence > 0.4 ? '#eab308' : // yellow
                '#9ca3af'; // gray

  return (
    <>
      {/* Circle showing cluster area */}
      <Circle
        center={[group.center_lat, group.center_lon]}
        radius={group.radius_meters}
        pathOptions={{
          color: selected ? '#3b82f6' : color,
          fillColor: color,
          fillOpacity: 0.2,
          weight: selected ? 3 : 2,
        }}
        eventHandlers={{ click: onClick }}
      />

      {/* Badge with count */}
      <Marker
        position={[group.center_lat, group.center_lon]}
        icon={L.divIcon({
          className: 'cluster-badge',
          html: `<div class="badge" style="background:${color}">${group.entry_ids.length}</div>`,
          iconSize: [30, 30],
        })}
        eventHandlers={{ click: onClick }}
      >
        <Tooltip permanent direction="top" offset={[0, -15]}>
          {group.suggested_name || `Group of ${group.entry_ids.length}`}
          <br />
          <small>{Math.round(group.confidence * 100)}% confidence</small>
        </Tooltip>
      </Marker>
    </>
  );
}
```

#### 4.7 Create `GroupDetailsPanel` Component
New file: `frontend/src/components/GroupDetailsPanel.tsx`

```typescript
interface Props {
  group: SuggestedGroup;
  sightings: AreaSighting[];
  onClose: () => void;
  onCreateCat: () => void;
}

export function GroupDetailsPanel({ group, sightings, onClose, onCreateCat }: Props) {
  return (
    <SlidePanel isOpen onClose={onClose} title="Suggested Group" position="right">
      {/* Group summary */}
      <div className="group-summary">
        <h3>{group.suggested_name || `Potential cat sighting cluster`}</h3>
        <ConfidenceBadge confidence={group.confidence} />
        <p>{group.entry_ids.length} sightings within {group.radius_meters}m</p>
      </div>

      {/* Reasons */}
      <div className="group-reasons">
        <h4>Why we think these are the same cat:</h4>
        <ul>
          {group.reasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      </div>

      {/* Sightings list */}
      <div className="group-sightings">
        <h4>Sightings in this group:</h4>
        {sightings.map(sighting => (
          <div key={sighting.entry_id} className="sighting-item">
            <p className="sighting-text">{sighting.text_preview}</p>
            <p className="sighting-meta">
              {sighting.location_normalized || sighting.location} •{' '}
              {formatDate(sighting.created_at)}
            </p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="panel-actions">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button onClick={onCreateCat}>
          Create Cat from Group
        </Button>
      </div>
    </SlidePanel>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const level = confidence > 0.7 ? 'high' : confidence > 0.4 ? 'medium' : 'low';
  const labels = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

  return (
    <span className={`confidence-badge ${level}`} title={`${Math.round(confidence * 100)}%`}>
      {labels[level]}
    </span>
  );
}
```

#### 4.8 Add Map Tab to App
Update `App.tsx`:

```typescript
// Add view mode state
const [viewMode, setViewMode] = useState<'list' | 'map'>('list');

// Add entries with coordinates for map
const entriesWithCoords = entries.filter(e => e.location_lat !== null);

return (
  <div className="app">
    {/* View mode tabs */}
    <div className="view-tabs">
      <button
        className={viewMode === 'list' ? 'active' : ''}
        onClick={() => setViewMode('list')}
        aria-pressed={viewMode === 'list'}
      >
        📋 List View
      </button>
      <button
        className={viewMode === 'map' ? 'active' : ''}
        onClick={() => setViewMode('map')}
        disabled={entriesWithCoords.length === 0}
        title={entriesWithCoords.length === 0 ? 'No sightings with locations' : undefined}
        aria-pressed={viewMode === 'map'}
      >
        🗺️ Map View {entriesWithCoords.length > 0 && `(${entriesWithCoords.length})`}
      </button>
    </div>

    {/* Content */}
    {viewMode === 'list' ? (
      <EntryList entries={entries} ... />
    ) : (
      <Suspense fallback={<MapSkeleton />}>
        <SightingsMap
          onEntryClick={handleEntryClick}
          onCreateCat={handleCreateCatFromEntries}
        />
      </Suspense>
    )}
  </div>
);
```

#### 4.9 Leaflet CSS
Import in `main.tsx`:
```typescript
import 'leaflet/dist/leaflet.css';
```

Add custom styles in `frontend/src/styles/map.css`:
```css
.map-container {
  position: relative;
  height: 600px;
}

.leaflet-map {
  height: 100%;
  border-radius: 8px;
}

.map-loading-indicator {
  position: absolute;
  top: 10px;
  right: 10px;
  background: white;
  padding: 8px 12px;
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 8px;
}

.map-error-banner {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: #fef2f2;
  color: #dc2626;
  padding: 8px 16px;
  border-radius: 4px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 12px;
}

.map-controls {
  position: absolute;
  top: 10px;
  left: 10px;
  background: white;
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.map-stats {
  position: absolute;
  bottom: 10px;
  left: 10px;
  background: white;
  padding: 8px 12px;
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  z-index: 1000;
  font-size: 14px;
}

.sighting-marker.unassigned .marker-dot {
  width: 16px;
  height: 16px;
  background: #3b82f6;
  border: 2px solid white;
  border-radius: 50%;
}

.sighting-marker.assigned .marker-dot {
  width: 20px;
  height: 20px;
  background: #22c55e;
  border: 2px solid white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.cluster-badge .badge {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 14px;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.sighting-popup {
  min-width: 200px;
}

.popup-text {
  font-size: 14px;
  margin-bottom: 8px;
}

.popup-location, .popup-date, .popup-cat {
  font-size: 12px;
  color: #666;
  margin: 4px 0;
}

.confidence-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.confidence-badge.high { background: #dcfce7; color: #166534; }
.confidence-badge.medium { background: #fef9c3; color: #854d0e; }
.confidence-badge.low { background: #f3f4f6; color: #4b5563; }
```

### Error Handling

| Error | User Message | Recovery Action |
|-------|--------------|-----------------|
| Geolocation denied | (Silent) Use default location | Show "My Location" button |
| Sightings load failed | "Couldn't load sightings." | Inline retry button |
| Groups load failed | "Couldn't analyze clusters." | Toggle shows error state |
| No sightings in area | "No sightings in this area. Try zooming out." | Show zoom out button |
| No sightings with coords | Map tab disabled | Tooltip explains why |

### Automated Tests

#### Unit Tests (`frontend/src/components/__tests__/SightingsMap.test.tsx`)
```typescript
// Mock Leaflet for testing
jest.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map">{children}</div>,
  TileLayer: () => <div data-testid="tile-layer" />,
  Marker: ({ children }: any) => <div data-testid="marker">{children}</div>,
  Popup: ({ children }: any) => <div data-testid="popup">{children}</div>,
  Circle: () => <div data-testid="circle" />,
  Tooltip: ({ children }: any) => <div data-testid="tooltip">{children}</div>,
}));

describe('SightingsMap', () => {
  it('renders map container', () => {
    render(<SightingsMap onEntryClick={jest.fn()} onCreateCat={jest.fn()} />);
    expect(screen.getByTestId('map')).toBeInTheDocument();
  });

  it('shows loading indicator while fetching sightings', () => {
    server.use(rest.get('/entries/by-area', delayedResponse(1000)));
    render(<SightingsMap ... />);
    expect(screen.getByText(/loading sightings/i)).toBeInTheDocument();
  });

  it('shows error banner when fetch fails', async () => {
    server.use(rest.get('/entries/by-area', (req, res, ctx) => res(ctx.status(500))));
    render(<SightingsMap ... />);
    await waitFor(() => {
      expect(screen.getByText(/couldn't load sightings/i)).toBeInTheDocument();
    });
  });

  it('shows retry button on error', async () => {
    server.use(rest.get('/entries/by-area', (req, res, ctx) => res(ctx.status(500))));
    render(<SightingsMap ... />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });

  it('renders markers for sightings', async () => {
    server.use(
      rest.get('/entries/by-area', (req, res, ctx) =>
        res(ctx.json({
          sightings: [mockSighting1, mockSighting2],
          total_count: 2,
          unassigned_count: 1,
        }))
      )
    );
    render(<SightingsMap ... />);
    await waitFor(() => {
      expect(screen.getAllByTestId('marker')).toHaveLength(2);
    });
  });

  it('shows stats bar with counts', async () => {
    server.use(
      rest.get('/entries/by-area', (req, res, ctx) =>
        res(ctx.json({
          sightings: mockSightings,
          total_count: 10,
          unassigned_count: 4,
        }))
      )
    );
    render(<SightingsMap ... />);
    await waitFor(() => {
      expect(screen.getByText(/showing 10 sightings/i)).toBeInTheDocument();
      expect(screen.getByText(/4 unassigned/i)).toBeInTheDocument();
    });
  });

  it('toggles assigned sightings filter', async () => {
    const fetchSpy = jest.fn();
    server.use(
      rest.get('/entries/by-area', (req, res, ctx) => {
        fetchSpy(req.url.searchParams.get('include_assigned'));
        return res(ctx.json({ sightings: [], total_count: 0, unassigned_count: 0 }));
      })
    );
    render(<SightingsMap ... />);

    await userEvent.click(screen.getByLabelText(/show assigned/i));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('false');
    });
  });
});

describe('Cluster visualization', () => {
  it('shows clusters when toggle enabled', async () => {
    server.use(
      rest.get('/entries/by-area', (req, res, ctx) =>
        res(ctx.json({ sightings: mockSightings, total_count: 5, unassigned_count: 3 }))
      ),
      rest.get('/entries/by-area/suggested-groups', (req, res, ctx) =>
        res(ctx.json({ groups: [mockGroup1, mockGroup2] }))
      )
    );
    render(<SightingsMap ... />);

    await userEvent.click(screen.getByLabelText(/show suggested groups/i));

    await waitFor(() => {
      expect(screen.getAllByTestId('circle')).toHaveLength(2);
    });
  });

  it('shows group count in stats when clusters enabled', async () => {
    server.use(
      rest.get('/entries/by-area', (req, res, ctx) =>
        res(ctx.json({ sightings: [], total_count: 0, unassigned_count: 0 }))
      ),
      rest.get('/entries/by-area/suggested-groups', (req, res, ctx) =>
        res(ctx.json({ groups: [mockGroup1, mockGroup2, mockGroup3] }))
      )
    );
    render(<SightingsMap ... />);

    await userEvent.click(screen.getByLabelText(/show suggested groups/i));

    await waitFor(() => {
      expect(screen.getByText(/3 suggested groups/i)).toBeInTheDocument();
    });
  });
});

describe('GroupDetailsPanel', () => {
  it('renders group info', () => {
    render(
      <GroupDetailsPanel
        group={mockGroup}
        sightings={mockSightings}
        onClose={jest.fn()}
        onCreateCat={jest.fn()}
      />
    );
    expect(screen.getByText(mockGroup.suggested_name)).toBeInTheDocument();
    expect(screen.getByText(/high confidence/i)).toBeInTheDocument();
  });

  it('shows reasons list', () => {
    render(<GroupDetailsPanel group={mockGroup} ... />);
    mockGroup.reasons.forEach(reason => {
      expect(screen.getByText(reason)).toBeInTheDocument();
    });
  });

  it('calls onCreateCat when button clicked', async () => {
    const onCreateCat = jest.fn();
    render(<GroupDetailsPanel onCreateCat={onCreateCat} ... />);
    await userEvent.click(screen.getByRole('button', { name: /create cat from group/i }));
    expect(onCreateCat).toHaveBeenCalled();
  });

  it('closes panel on close button', async () => {
    const onClose = jest.fn();
    render(<GroupDetailsPanel onClose={onClose} ... />);
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('SightingMarker', () => {
  it('renders unassigned marker as blue', () => {
    const unassigned = { ...mockSighting, cat_id: null };
    render(<SightingMarker sighting={unassigned} onClick={jest.fn()} />);
    expect(screen.getByTestId('marker')).toHaveClass('unassigned');
  });

  it('renders assigned marker as green with icon', () => {
    const assigned = { ...mockSighting, cat_id: 1, cat_name: 'Whiskers' };
    render(<SightingMarker sighting={assigned} onClick={jest.fn()} />);
    expect(screen.getByTestId('marker')).toHaveClass('assigned');
  });

  it('shows popup with sighting details', () => {
    render(<SightingMarker sighting={mockSighting} onClick={jest.fn()} />);
    expect(screen.getByText(mockSighting.text_preview)).toBeInTheDocument();
    expect(screen.getByText(mockSighting.location_normalized)).toBeInTheDocument();
  });

  it('calls onClick when marker clicked', async () => {
    const onClick = jest.fn();
    render(<SightingMarker sighting={mockSighting} onClick={onClick} />);
    await userEvent.click(screen.getByTestId('marker'));
    expect(onClick).toHaveBeenCalled();
  });
});
```

#### Integration Tests
```typescript
describe('Map View Integration', () => {
  it('complete flow: view map → select cluster → create cat', async () => {
    server.use(
      rest.get('/entries/by-area', (req, res, ctx) =>
        res(ctx.json({
          sightings: mockSightings,
          total_count: 5,
          unassigned_count: 3,
        }))
      ),
      rest.get('/entries/by-area/suggested-groups', (req, res, ctx) =>
        res(ctx.json({ groups: [mockGroup] }))
      ),
      rest.post('/cats/from-sightings', (req, res, ctx) =>
        res(ctx.json({ cat: mockCat, linked_entries: mockGroup.entry_ids }))
      )
    );

    render(<App />);

    // Switch to map view
    await userEvent.click(screen.getByRole('button', { name: /map view/i }));

    // Enable clusters
    await userEvent.click(screen.getByLabelText(/show suggested groups/i));

    // Wait for clusters to load
    await waitFor(() => {
      expect(screen.getByTestId('circle')).toBeInTheDocument();
    });

    // Click cluster
    await userEvent.click(screen.getByTestId('circle'));

    // Panel opens
    expect(screen.getByText(/create cat from group/i)).toBeInTheDocument();

    // Create cat
    await userEvent.click(screen.getByRole('button', { name: /create cat from group/i }));

    // Verify modal flow
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('map tab disabled when no entries have coordinates', () => {
    const entriesWithoutCoords = mockEntries.map(e => ({ ...e, location_lat: null }));
    render(<App initialEntries={entriesWithoutCoords} />);
    expect(screen.getByRole('button', { name: /map view/i })).toBeDisabled();
  });
});
```

### Accessibility
- Map has `role="application"` for AT navigation
- Markers are keyboard-focusable with Enter to open popup
- Controls have proper labels and ARIA attributes
- View tabs use `aria-pressed` for state
- Panel uses focus trap when open
- Color is not the only indicator (text labels accompany colors)
- Reduced motion preference respected for animations

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
