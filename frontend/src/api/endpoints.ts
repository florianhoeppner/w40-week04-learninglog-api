/**
 * API Endpoints for CatAtlas
 * Type-safe API endpoint definitions
 */

import { get, post } from "./client";

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
};

/** Payload for creating a new cat sighting */
export type EntryCreatePayload = {
  text: string;
  nickname?: string | null;
  location?: string | null;
  photo_url?: string | null;
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
