/**
 * API Endpoints for CatAtlas
 * Type-safe API endpoint definitions
 */

import { get, post, patch } from "./client";

// ===========================
// Type Definitions
// ===========================

/** A single cat sighting from the backend */
export type Entry = {
  id: number;
  text: string;
  createdAt: string;
  isFavorite: boolean;
  nickname?: string | null;
  location?: string | null;
  photo_url?: string | null;
  cat_id?: number | null;
  // Location normalization fields (Phase 1)
  location_normalized?: string | null;
  location_lat?: number | null;
  location_lon?: number | null;
  location_osm_id?: string | null;
  // Structured address fields
  location_street?: string | null;
  location_number?: string | null;
  location_zip?: string | null;
  location_city?: string | null;
  location_country?: string | null;
};

/** Payload for creating a new cat sighting */
export type EntryCreatePayload = {
  text: string;
  nickname?: string | null;
  location?: string | null;  // Legacy single field
  photo_url?: string | null;
  // Structured address fields
  location_street?: string | null;
  location_number?: string | null;
  location_zip?: string | null;
  location_city?: string | null;
  location_country?: string | null;
};

/** Analysis result from AI enrichment */
export type EntryAnalysis = {
  entry_id: number;
  summary: string;
  tags: string[];
  sentiment: "positive" | "neutral" | "negative";
  updatedAt: string;
};

/** Cat insight response */
export type CatInsightResponse = {
  cat_id: number;
  mode: string;
  prompt_version: string;
  confidence: number;
  headline: string;
  summary: string;
  flags: string[];
  suggested_actions: string[];
  citations: {
    entry_id: number;
    quote: string;
    location?: string | null;
    createdAt: string;
  }[];
  generatedAt: string;
};

/** Match candidate for duplicate detection */
export type MatchCandidate = {
  entry_id: number;
  candidate_id: number;
  score: number;
  reasons: string[];
  candidate_nickname?: string | null;
  candidate_location?: string | null;
  candidate_text: string;
  candidate_createdAt: string;
};

// ===========================
// Location Normalization Types (Phase 1)
// ===========================

/** Result from location normalization */
export type LocationNormalizationResult = {
  entry_id: number;
  original_location: string | null;
  normalized_location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  osm_id?: string | null;
  status: "success" | "not_found" | "already_normalized" | "no_location" | "error";
  message?: string | null;
};

/** Geocoding service health status */
export type GeocodingHealthResponse = {
  service: string;
  circuit_state: "closed" | "open" | "half_open";
  failure_count: number;
  last_failure?: string | null;
  status: "healthy" | "degraded" | "unavailable";
};

// ===========================
// Nearby Sightings Types (Phase 2)
// ===========================

/** A nearby sighting result */
export type NearbySighting = {
  entry_id: number;
  distance_meters: number;
  location?: string | null;
  location_normalized?: string | null;
  text_preview: string;
  cat_id?: number | null;
  cat_name?: string | null;
  created_at: string;
  match_score: number;
  reasons: string[];
};

// ===========================
// Cat Management Types (Phase 3)
// ===========================

/** A cat profile */
export type Cat = {
  id: number;
  name?: string | null;
  createdAt: string;
};

// ===========================
// Enhanced Cat Profile Types (Cat Profile Page)
// ===========================

/** Basic cat information for profile header */
export type CatBasicInfo = {
  id: number;
  name?: string | null;
  createdAt: string;
  primaryPhoto?: string | null;
};

/** Aggregated statistics for a cat */
export type CatStats = {
  totalSightings: number;
  uniqueLocations: number;
  photoCount: number;
  firstSeen?: string | null;
  lastSeen?: string | null;
  mostFrequentLocation?: string | null;
};

/** Summary of sightings at a specific location */
export type LocationSummary = {
  location: string;
  normalizedLocation?: string | null;
  count: number;
  lastSeen: string;
  lat?: number | null;
  lon?: number | null;
};

/** Status of AI-generated insights for a cat */
export type InsightStatus = {
  hasProfile: boolean;
  hasCare: boolean;
  hasUpdate: boolean;
  hasRisk: boolean;
  lastUpdated?: string | null;
};

/** Simplified sighting for profile preview */
export type RecentSighting = {
  id: number;
  text: string;
  createdAt: string;
  location?: string | null;
  photo_url?: string | null;
};

/** Enhanced cat profile with stats for dedicated profile page */
export type EnhancedCatProfile = {
  cat: CatBasicInfo;
  stats: CatStats;
  recentSightings: RecentSighting[];
  locationSummary: LocationSummary[];
  insightStatus: InsightStatus;
  top_tags: string[];
  temperament_guess: string;
  profile_text: string;
};

/** Response from bulk linking sightings to a cat */
export type LinkSightingsResponse = {
  cat_id: number;
  linked_count: number;
  already_linked: number[];
  newly_linked: number[];
  failed: number[];
};

// ===========================
// Paginated Sightings Types (Cat Profile Page)
// ===========================

/** A sighting in paginated response */
export type PaginatedSighting = {
  id: number;
  text: string;
  createdAt: string;
  location?: string | null;
  location_normalized?: string | null;
  location_lat?: number | null;
  location_lon?: number | null;
  photo_url?: string | null;
  nickname?: string | null;
  isFavorite: boolean;
};

/** Paginated sightings response with metadata */
export type PaginatedSightingsResponse = {
  sightings: PaginatedSighting[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
};

// ===========================
// Cat Update Types (Cat Profile Page)
// ===========================

/** Payload for updating a cat */
export type CatUpdatePayload = {
  name?: string | null;
};

/** Response after updating a cat */
export type CatUpdateResponse = {
  id: number;
  name?: string | null;
  updatedAt: string;
};

// ===========================
// Area-Based Query Types (Phase 4)
// ===========================

/** A sighting within a geographic area */
export type AreaSighting = {
  entry_id: number;
  text_preview: string;
  location?: string | null;
  location_normalized?: string | null;
  latitude: number;
  longitude: number;
  cat_id?: number | null;
  cat_name?: string | null;
  created_at: string;
};

/** Response from area-based sighting query */
export type AreaQueryResponse = {
  center_lat: number;
  center_lon: number;
  radius_meters: number;
  total_count: number;
  unassigned_count: number;
  sightings: AreaSighting[];
};

/** A suggested grouping of sightings */
export type SuggestedGroup = {
  group_id: number;
  confidence: number;
  center_lat: number;
  center_lon: number;
  radius_meters: number;
  entry_ids: number[];
  reasons: string[];
  suggested_name?: string | null;
};

/** Response containing suggested sighting groupings */
export type SuggestedGroupingsResponse = {
  area_center_lat: number;
  area_center_lon: number;
  area_radius_meters: number;
  total_unassigned: number;
  groups: SuggestedGroup[];
};

// ===========================
// Entry Endpoints
// ===========================

/**
 * Get all cat sightings
 */
export function getEntries(): Promise<Entry[]> {
  return get<Entry[]>("/entries");
}

/**
 * Create a new cat sighting
 */
export function createEntry(payload: EntryCreatePayload): Promise<Entry> {
  return post<Entry>("/entries", payload);
}

/**
 * Toggle favorite status for a sighting
 */
export function toggleEntryFavorite(entryId: number): Promise<Entry> {
  return post<Entry>(`/entries/${entryId}/favorite`);
}

// ===========================
// Analysis Endpoints
// ===========================

/**
 * Enrich entry with AI analysis
 */
export function analyzeEntry(entryId: number): Promise<EntryAnalysis> {
  return post<EntryAnalysis>(`/entries/${entryId}/analyze`);
}

/**
 * Get existing analysis for an entry (returns 404 if none exists)
 */
export function getEntryAnalysis(entryId: number): Promise<EntryAnalysis> {
  return get<EntryAnalysis>(`/entries/${entryId}/analysis`, {
    // Don't retry on 404 - it's expected when no analysis exists
    retry: {
      maxAttempts: 2,
      shouldRetry: (error) => {
        if (error.details.statusCode === 404) return false;
        return error.isRetryable();
      },
    },
  });
}

// ===========================
// Matching Endpoints
// ===========================

/**
 * Find potential duplicate cat sightings
 */
export function findMatches(
  entryId: number,
  topK: number = 5,
  minScore: number = 0.15
): Promise<MatchCandidate[]> {
  return get<MatchCandidate[]>(
    `/entries/${entryId}/matches?top_k=${topK}&min_score=${minScore}`
  );
}

// ===========================
// Cat Insights Endpoints
// ===========================

/**
 * Generate AI insights for a cat
 */
export function getCatInsights(
  catId: number,
  mode: "profile" | "care" | "update" | "risk"
): Promise<CatInsightResponse> {
  return post<CatInsightResponse>(`/cats/${catId}/insights`, { mode });
}

// ===========================
// Location Normalization Endpoints (Phase 1)
// ===========================

/**
 * Normalize the location for an entry using geocoding
 * @param entryId The entry ID to normalize
 * @param force If true, re-normalize even if already normalized
 */
export function normalizeEntryLocation(
  entryId: number,
  force: boolean = false
): Promise<LocationNormalizationResult> {
  return post<LocationNormalizationResult>(
    `/entries/${entryId}/normalize-location?force=${force}`
  );
}

/**
 * Get geocoding service health status
 */
export function getGeocodingHealth(): Promise<GeocodingHealthResponse> {
  return get<GeocodingHealthResponse>("/health/geocoding");
}

// ===========================
// Nearby/Similar Sightings Endpoints (Phase 2)
// ===========================

/**
 * Get nearby sightings for an entry with coordinates
 * @param entryId The entry ID to find nearby sightings for
 * @param radiusMeters Search radius in meters (default 500)
 * @param topK Maximum number of results (default 10)
 * @param includeAssigned Include sightings already assigned to cats
 */
export function getNearbySightings(
  entryId: number,
  radiusMeters: number = 500,
  topK: number = 10,
  includeAssigned: boolean = true
): Promise<NearbySighting[]> {
  const params = new URLSearchParams({
    radius_meters: radiusMeters.toString(),
    top_k: topK.toString(),
    include_assigned: includeAssigned.toString(),
  });
  return get<NearbySighting[]>(`/entries/${entryId}/nearby?${params}`);
}

// ===========================
// Cat Management Endpoints (Phase 3)
// ===========================

/**
 * Get all cats
 */
export function getCats(): Promise<Cat[]> {
  return get<Cat[]>("/cats");
}

/**
 * Create a new cat
 */
export function createCat(name?: string): Promise<Cat> {
  return post<Cat>("/cats", { name });
}

/**
 * Bulk link sightings to an existing cat
 * @param catId The cat ID to link sightings to
 * @param entryIds List of entry IDs to link
 */
export function linkSightingsToCat(
  catId: number,
  entryIds: number[]
): Promise<LinkSightingsResponse> {
  return post<LinkSightingsResponse>(`/cats/${catId}/link-sightings`, {
    entry_ids: entryIds,
  });
}

/**
 * Create a new cat from sightings
 * @param entryIds List of entry IDs to link to the new cat
 * @param name Optional name for the new cat
 */
export function createCatFromSightings(
  entryIds: number[],
  name?: string
): Promise<Cat> {
  return post<Cat>("/cats/from-sightings", {
    entry_ids: entryIds,
    name,
  });
}

/**
 * Get enhanced cat profile with aggregated stats for the Cat Profile page
 * @param catId The cat ID to fetch profile for
 */
export function getEnhancedCatProfile(catId: number): Promise<EnhancedCatProfile> {
  return get<EnhancedCatProfile>(`/cats/${catId}/profile/enhanced`);
}

/**
 * Get paginated sightings for a specific cat
 * @param catId The cat ID to fetch sightings for
 * @param page Page number (1-indexed)
 * @param limit Items per page (default 20, max 100)
 */
export function getCatSightings(
  catId: number,
  page: number = 1,
  limit: number = 20
): Promise<PaginatedSightingsResponse> {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  return get<PaginatedSightingsResponse>(`/cats/${catId}/sightings?${params}`);
}

/**
 * Update a cat's details (currently only name)
 * @param catId The cat ID to update
 * @param payload The update payload
 */
export function updateCat(
  catId: number,
  payload: CatUpdatePayload
): Promise<CatUpdateResponse> {
  return patch<CatUpdateResponse>(`/cats/${catId}`, payload);
}

// ===========================
// Area-Based Query Endpoints (Phase 4)
// ===========================

/**
 * Query sightings within a geographic area
 * @param lat Center latitude
 * @param lon Center longitude
 * @param radiusMeters Search radius in meters (default 500)
 * @param includeAssigned Include sightings already assigned to cats
 */
export function getEntriesByArea(
  lat: number,
  lon: number,
  radiusMeters: number = 500,
  includeAssigned: boolean = true
): Promise<AreaQueryResponse> {
  const params = new URLSearchParams({
    lat: lat.toString(),
    lon: lon.toString(),
    radius: radiusMeters.toString(),
    include_assigned: includeAssigned.toString(),
  });
  return get<AreaQueryResponse>(`/entries/by-area?${params}`);
}

/**
 * Get suggested groupings of unassigned sightings in an area
 * @param lat Center latitude
 * @param lon Center longitude
 * @param radiusMeters Search radius in meters (default 500)
 * @param clusterRadius Clustering radius in meters (default 100)
 * @param minSightings Minimum sightings per group (default 2)
 */
export function getSuggestedGroupings(
  lat: number,
  lon: number,
  radiusMeters: number = 500,
  clusterRadius: number = 100,
  minSightings: number = 2
): Promise<SuggestedGroupingsResponse> {
  const params = new URLSearchParams({
    lat: lat.toString(),
    lon: lon.toString(),
    radius: radiusMeters.toString(),
    cluster_radius: clusterRadius.toString(),
    min_sightings: minSightings.toString(),
  });
  return get<SuggestedGroupingsResponse>(
    `/entries/by-area/suggested-groups?${params}`
  );
}
