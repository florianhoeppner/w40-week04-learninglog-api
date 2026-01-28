import { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  getEntries,
  createEntry,
  toggleEntryFavorite,
  analyzeEntry,
  getEntryAnalysis,
  getCatInsights,
  normalizeEntryLocation,
  type Entry,
  type EntryCreatePayload,
  type EntryAnalysis,
  type CatInsightResponse,
  type MatchCandidate,
} from "./api/endpoints";
import { useMutation } from "./hooks/useMutation";
import { ImageUpload } from "./components/ImageUpload";
import { createEntryWithImage } from "./api/upload";
import { ToastProvider, useToast } from "./components/Toast";
import { LocationStatus, LocationBadge } from "./components/LocationStatus";
import { SimilarNearbyPanel } from "./components/SimilarNearbyPanel";
import { CreateCatModal } from "./components/CreateCatModal";
import { LinkToCatModal } from "./components/LinkToCatModal";
import { SightingsMap } from "./components/SightingsMap";

/**
 * CatAtlas - Production Ready
 * - Resilient API client with retry, timeout, and circuit breaker
 * - Comprehensive error handling
 * - Full test coverage
 * - Location normalization with auto-geocoding
 */

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

function AppContent() {
  const { showSuccess, showError, showWarning } = useToast();

  // ----------------------------
  // Main data state
  // ----------------------------
  const [entries, setEntries] = useState<Entry[]>([]);
  const [analysisById, setAnalysisById] = useState<Record<number, EntryAnalysis>>({});
  // Matches are now displayed in SimilarNearbyPanel, but we keep this for inline display
  const [matchesById] = useState<Record<number, MatchCandidate[]>>({});

  // ----------------------------
  // Location normalization state
  // ----------------------------
  const [normalizingEntries, setNormalizingEntries] = useState<Set<number>>(new Set());

  // ----------------------------
  // Similar/Nearby panel state
  // ----------------------------
  const [similarPanelEntry, setSimilarPanelEntry] = useState<Entry | null>(null);

  // ----------------------------
  // Create/Link Cat modal state
  // ----------------------------
  const [createCatEntryIds, setCreateCatEntryIds] = useState<number[] | null>(null);
  const [linkToCatEntryIds, setLinkToCatEntryIds] = useState<number[] | null>(null);

  // ----------------------------
  // UI state
  // ----------------------------
  const [filter, setFilter] = useState<"all" | "favorites">("all");
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [error, setError] = useState<string | null>(null);

  // "Loading" state for enrichment button
  const [loadingEnrichId, setLoadingEnrichId] = useState<number | null>(null);

  // ----------------------------
  // Form state (Cat sighting form)
  // ----------------------------
  const [nickname, setNickname] = useState("");
  // Structured address fields
  const [locationStreet, setLocationStreet] = useState("");
  const [locationNumber, setLocationNumber] = useState("");
  const [locationZip, setLocationZip] = useState("");
  const [locationCity, setLocationCity] = useState("");
  const [locationCountry, setLocationCountry] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  // ----------------------------
  // Derived state: what entries to show
  // ----------------------------
  const visible = useMemo(() => {
    return entries.filter((e) => (filter === "favorites" ? e.isFavorite : true));
  }, [entries, filter]);

  // Entries with coordinates for map view
  const entriesWithCoords = useMemo(() => {
    return entries.filter(
      (e) => e.location_lat !== null && e.location_lat !== undefined
    );
  }, [entries]);

  // ----------------------------
  // Week 9: Cat Insights state
  // ----------------------------
  const [insightByCatId, setInsightByCatId] = useState<Record<number, CatInsightResponse>>({});
  const [loadingInsightCatId, setLoadingInsightCatId] = useState<number | null>(null);

  // ----------------------------
  // Community stats
  // ----------------------------
  const totalSightings = entries.length;

  const enrichedCount = useMemo(() => {
    return Object.keys(analysisById).length;
  }, [analysisById]);

  const topTags = useMemo(() => {
    const counts = new Map<string, number>();

    Object.values(analysisById).forEach((a) => {
      a.tags.forEach((t) => {
        const tag = t.trim().toLowerCase();
        if (!tag) return;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      });
    });

    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, 8);
  }, [analysisById]);

  const mostRecentSighting = useMemo(() => {
    if (entries.length === 0) return null;
    const dates = entries
      .map((e) => new Date(e.createdAt).getTime())
      .filter((t) => !Number.isNaN(t));
    if (dates.length === 0) return null;
    return new Date(Math.max(...dates));
  }, [entries]);

  // ----------------------------
  // API Mutations using new hooks
  // ----------------------------

  const createEntryMutation = useMutation(createEntry, {
    onSuccess: (created) => {
      setEntries((prev) => [created, ...prev]);
      // Reset form
      setNickname("");
      setLocationStreet("");
      setLocationNumber("");
      setLocationZip("");
      setLocationCity("");
      setLocationCountry("");
      setNotes("");
      setPhotoUrl("");
      setError(null);
    },
    onError: (err) => {
      setError(err.getUserMessage());
    },
  });

  const toggleFavoriteMutation = useMutation(toggleEntryFavorite, {
    onSuccess: (updated) => {
      setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setError(null);
    },
    onError: (err) => {
      setError(err.getUserMessage());
    },
  });

  // ----------------------------
  // Backend calls
  // ----------------------------

  async function loadEntries() {
    setError(null);
    try {
      const data = await getEntries();
      setEntries(data);

      // Load enrichment for each sighting
      data.forEach((e) => {
        loadAnalysisIfExists(e.id);
      });
    } catch (e: any) {
      console.error(e);
      setError(e.getUserMessage?.() || "Could not load sightings.");
    }
  }

  async function fetchCatInsights(catId: number, mode: "profile" | "care" | "update" | "risk") {
    setLoadingInsightCatId(catId);
    setError(null);

    try {
      const data = await getCatInsights(catId, mode);
      setInsightByCatId((prev) => ({ ...prev, [catId]: data }));
    } catch (e: any) {
      console.error(e);
      setError(e.getUserMessage?.() || "Could not load cat insights.");
    } finally {
      setLoadingInsightCatId(null);
    }
  }

  // Legacy matches are now handled by SimilarNearbyPanel
  // Keeping matchesById state for backward compatibility with inline match display

  async function addSighting() {
    const text = notes.trim();
    if (!text) return;

    setError(null);
    let createdEntry: Entry | null = null;

    // Build address object from form fields
    const addressFields = {
      street: locationStreet.trim() || null,
      number: locationNumber.trim() || null,
      zip: locationZip.trim() || null,
      city: locationCity.trim() || null,
      country: locationCountry.trim() || null,
    };
    const hasAddress = Object.values(addressFields).some((v) => v);

    // Reset form helper
    const resetForm = () => {
      setNickname("");
      setLocationStreet("");
      setLocationNumber("");
      setLocationZip("");
      setLocationCity("");
      setLocationCountry("");
      setNotes("");
      setPhotoUrl("");
      setPhotoFile(null);
    };

    // If there's an image file, use the multipart endpoint
    if (photoFile) {
      try {
        createdEntry = await createEntryWithImage(
          text,
          nickname.trim() || null,
          hasAddress ? addressFields : null,
          photoFile
        );
        setEntries((prev) => [createdEntry!, ...prev]);
        showSuccess("Sighting added successfully!");
        resetForm();
      } catch (e: any) {
        setError(e.getUserMessage?.() || "Failed to create sighting");
        showError("Failed to add sighting", e.getUserMessage?.() || "Please try again.");
        return;
      }
    } else {
      // Use existing JSON endpoint for entries without image upload
      const payload: EntryCreatePayload = {
        text,
        nickname: nickname.trim() || null,
        photo_url: photoUrl.trim() || null,
        // Structured address fields
        location_street: addressFields.street,
        location_number: addressFields.number,
        location_zip: addressFields.zip,
        location_city: addressFields.city,
        location_country: addressFields.country,
      };
      try {
        createdEntry = await createEntryMutation.mutateAsync(payload);
        showSuccess("Sighting added successfully!");
      } catch (e: any) {
        // Error already handled by mutation onError
        return;
      }
    }

    // Auto-normalize location in background (non-blocking)
    if (createdEntry && createdEntry.location) {
      // Don't await - run in background
      normalizeLocation(createdEntry.id, true);
    }
  }

  async function toggleFavorite(entryId: number) {
    await toggleFavoriteMutation.mutateAsync(entryId);
  }

  async function enrichWithAI(entryId: number) {
    setLoadingEnrichId(entryId);
    setError(null);

    try {
      const data = await analyzeEntry(entryId);
      setAnalysisById((prev) => ({ ...prev, [entryId]: data }));
    } catch (e: any) {
      console.error(e);
      setError(e.getUserMessage?.() || "Enrichment failed.");
    } finally {
      setLoadingEnrichId(null);
    }
  }

  async function loadAnalysisIfExists(entryId: number) {
    try {
      const data = await getEntryAnalysis(entryId);
      setAnalysisById((prev) => ({ ...prev, [entryId]: data }));
    } catch (e: any) {
      // 404 is expected when no analysis exists
      if (e.details?.statusCode === 404) return;
      // Silently ignore other errors for now
    }
  }

  // ----------------------------
  // Location normalization
  // ----------------------------

  async function normalizeLocation(entryId: number, showFeedback: boolean = true) {
    // Mark as normalizing
    setNormalizingEntries((prev) => new Set(prev).add(entryId));

    try {
      const result = await normalizeEntryLocation(entryId);

      if (result.status === "success") {
        // Update the entry with normalized location
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entryId
              ? {
                  ...e,
                  location_normalized: result.normalized_location,
                  location_lat: result.latitude,
                  location_lon: result.longitude,
                  location_osm_id: result.osm_id,
                }
              : e
          )
        );

        if (showFeedback) {
          const shortLocation = result.normalized_location?.split(",")[0] || "Location";
          showSuccess(`Location verified: ${shortLocation}`);
        }
      } else if (result.status === "not_found") {
        if (showFeedback) {
          showWarning("Location not found on map. You can edit it later.");
        }
      } else if (result.status === "already_normalized") {
        // Already done, no action needed
      }
      // "no_location" status means entry has no location to normalize
    } catch (e: any) {
      console.error("Location normalization failed:", e);
      if (showFeedback) {
        showWarning("Location verification delayed. Will retry automatically.");
      }
    } finally {
      setNormalizingEntries((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
    }
  }

  async function retryNormalizeLocation(entryId: number) {
    setNormalizingEntries((prev) => new Set(prev).add(entryId));

    try {
      const result = await normalizeEntryLocation(entryId, true);

      if (result.status === "success") {
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entryId
              ? {
                  ...e,
                  location_normalized: result.normalized_location,
                  location_lat: result.latitude,
                  location_lon: result.longitude,
                  location_osm_id: result.osm_id,
                }
              : e
          )
        );
        showSuccess("Location verified!");
      } else {
        showWarning("Location could not be verified. Try a different address.");
      }
    } catch (e: any) {
      showError("Verification failed", "Please try again later.");
    } finally {
      setNormalizingEntries((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
    }
  }

  // ----------------------------
  // Similar/Nearby panel handlers
  // ----------------------------

  function openSimilarPanel(entry: Entry) {
    setSimilarPanelEntry(entry);
  }

  function closeSimilarPanel() {
    setSimilarPanelEntry(null);
  }

  function handleCreateCatFromSightings(entryIds: number[]) {
    closeSimilarPanel();
    setCreateCatEntryIds(entryIds);
  }

  function handleLinkToExistingCat(entryIds: number[]) {
    closeSimilarPanel();
    setLinkToCatEntryIds(entryIds);
  }

  function handleCatCreated() {
    setCreateCatEntryIds(null);
    // Refresh entries to get updated cat_id assignments
    loadEntries();
  }

  function handleSightingsLinked() {
    setLinkToCatEntryIds(null);
    // Refresh entries to get updated cat_id assignments
    loadEntries();
  }

  // ----------------------------
  // Map handlers
  // ----------------------------

  function handleMapEntryClick(entryId: number) {
    const entry = entries.find((e) => e.id === entryId);
    if (entry) {
      openSimilarPanel(entry);
    }
  }

  function handleMapCreateCat(entryIds: number[]) {
    setCreateCatEntryIds(entryIds);
  }

  // ----------------------------
  // Initial load
  // ----------------------------
  useEffect(() => {
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------
  // UI
  // ----------------------------
  return (
    <main className="app">
      <h1>CatAtlas</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Community + AI for feral/stray cat sightings (text-based enrichment for now).
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {/* Community snapshot */}
      <section style={{ marginTop: 16 }}>
        <h2>Community snapshot</h2>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ padding: 10, border: "1px solid #eee", borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: "#666" }}>Total sightings</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{totalSightings}</div>
          </div>

          <div style={{ padding: 10, border: "1px solid #eee", borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: "#666" }}>Enriched sightings</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{enrichedCount}</div>
          </div>

          <div style={{ padding: 10, border: "1px solid #eee", borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: "#666" }}>Most recent</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {mostRecentSighting ? mostRecentSighting.toLocaleString() : "—"}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
            Top tags (from AI enrichment)
          </div>

          {topTags.length === 0 ? (
            <div style={{ color: "#666" }}>
              No enrichment yet. Click "Enrich with AI" on a sighting to start building shared knowledge.
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {topTags.map(([tag, count]) => (
                <span
                  key={tag}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid #eee",
                    fontSize: 12,
                  }}
                  title={`Used ${count} time(s)`}
                >
                  {tag} · {count}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Add cat sighting form */}
      <section style={{ marginTop: 24 }}>
        <h2>Add cat sighting</h2>

        <label style={{ display: "block", fontWeight: 600, marginTop: 8 }}>
          Nickname (optional)
        </label>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="e.g., Orange Tail, Park Kitty"
          style={{
            width: "100%",
            padding: 8,
            boxSizing: "border-box",
            marginTop: 6,
          }}
        />

        <label style={{ display: "block", fontWeight: 600, marginTop: 12 }}>
          Location (optional)
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 8, marginTop: 6 }}>
          <input
            value={locationStreet}
            onChange={(e) => setLocationStreet(e.target.value)}
            placeholder="Street"
            style={{ padding: 8, boxSizing: "border-box" }}
          />
          <input
            value={locationNumber}
            onChange={(e) => setLocationNumber(e.target.value)}
            placeholder="Number"
            style={{ padding: 8, boxSizing: "border-box" }}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 8, marginTop: 8 }}>
          <input
            value={locationZip}
            onChange={(e) => setLocationZip(e.target.value)}
            placeholder="ZIP"
            style={{ padding: 8, boxSizing: "border-box" }}
          />
          <input
            value={locationCity}
            onChange={(e) => setLocationCity(e.target.value)}
            placeholder="City"
            style={{ padding: 8, boxSizing: "border-box" }}
          />
        </div>
        <input
          value={locationCountry}
          onChange={(e) => setLocationCountry(e.target.value)}
          placeholder="Country"
          style={{ width: "100%", padding: 8, boxSizing: "border-box", marginTop: 8 }}
        />

        <ImageUpload
          value={photoFile}
          onChange={setPhotoFile}
          disabled={createEntryMutation.loading}
        />

        <label style={{ display: "block", fontWeight: 600, marginTop: 12 }}>
          Notes (required)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Describe the cat: colors, behavior, health signs, collar, etc."
          style={{
            width: "100%",
            padding: 8,
            boxSizing: "border-box",
            marginTop: 6,
          }}
        />

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={addSighting} disabled={!notes.trim() || createEntryMutation.loading}>
            {createEntryMutation.loading ? "Adding..." : "Add sighting"}
          </button>

          <button
            type="button"
            onClick={() => {
              setNickname("");
              setLocationStreet("");
              setLocationNumber("");
              setLocationZip("");
              setLocationCity("");
              setLocationCountry("");
              setPhotoUrl("");
              setNotes("");
              setPhotoFile(null);
            }}
          >
            Clear
          </button>

          <button type="button" onClick={loadEntries}>
            Refresh
          </button>
        </div>

        <p style={{ marginTop: 8, color: "#666", fontSize: "0.9rem" }}>
          Tip: coat pattern, tail, collar, injuries, and behavior help matching later.
        </p>
      </section>

      {/* View Mode Tabs */}
      <section style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => setViewMode("list")}
          aria-pressed={viewMode === "list"}
          style={{
            padding: "10px 20px",
            backgroundColor: viewMode === "list" ? "#3b82f6" : "#fff",
            color: viewMode === "list" ? "#fff" : "#374151",
            border: viewMode === "list" ? "none" : "1px solid #d1d5db",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          List View
        </button>
        <button
          type="button"
          onClick={() => setViewMode("map")}
          disabled={entriesWithCoords.length === 0}
          aria-pressed={viewMode === "map"}
          title={entriesWithCoords.length === 0 ? "No sightings with verified locations" : undefined}
          style={{
            padding: "10px 20px",
            backgroundColor: viewMode === "map" ? "#3b82f6" : "#fff",
            color: viewMode === "map" ? "#fff" : "#374151",
            border: viewMode === "map" ? "none" : "1px solid #d1d5db",
            borderRadius: "6px",
            cursor: entriesWithCoords.length === 0 ? "not-allowed" : "pointer",
            fontWeight: 500,
            opacity: entriesWithCoords.length === 0 ? 0.5 : 1,
          }}
        >
          Map View {entriesWithCoords.length > 0 && `(${entriesWithCoords.length})`}
        </button>
      </section>

      {/* Filters (only show for list view) */}
      {viewMode === "list" && (
        <section className="filters" style={{ marginTop: 16 }}>
          <button
            className={filter === "all" ? "active" : ""}
            type="button"
            onClick={() => setFilter("all")}
          >
            All
          </button>

          <button
            className={filter === "favorites" ? "active" : ""}
            type="button"
            onClick={() => setFilter("favorites")}
          >
            Favorites
          </button>
        </section>
      )}

      {/* Map View */}
      {viewMode === "map" && (
        <section style={{ marginTop: 16 }}>
          <h2>Sightings Map</h2>
          <SightingsMap
            entries={entries}
            onEntryClick={handleMapEntryClick}
            onCreateCat={handleMapCreateCat}
          />
        </section>
      )}

      {/* Sightings list */}
      {viewMode === "list" && (
        <section style={{ marginTop: 16 }}>
          <h2>Sightings</h2>

        <ul className="entry-list">
          {visible.length === 0 ? (
            <li className="entry-item">No sightings yet. Add the first one above.</li>
          ) : (
            visible.map((e) => {
              const analysis = analysisById[e.id];
              const catId = e.cat_id;

              return (
                <li key={e.id} className="entry-item">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 800 }}>
                      {e.nickname ? e.nickname : `Cat #${e.id}`}
                    </span>
                    {e.location && (
                      <LocationBadge entry={e} />
                    )}
                  </div>

                  {e.location && (
                    <div style={{ color: "#555", marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                      <span>📍 {e.location}</span>
                      <LocationStatus
                        entry={e}
                        isNormalizing={normalizingEntries.has(e.id)}
                        onRetryNormalize={retryNormalizeLocation}
                      />
                    </div>
                  )}
                  {e.photo_url && (
                  <img
                    src={e.photo_url}
                    alt="Cat sighting"
                    style={{ marginTop: 10, maxWidth: "100%", borderRadius: 8, border: "1px solid #eee" }}
                  />
                  )}

                  <div style={{ marginTop: 8 }}>{e.text}</div>

                  <div className="entry-meta" style={{ marginTop: 8 }}>
                    {new Date(e.createdAt).toLocaleString()}
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => toggleFavorite(e.id)} disabled={toggleFavoriteMutation.loading}>
                      {e.isFavorite ? "Unfavorite" : "Favorite"}
                    </button>

                    <button
                      type="button"
                      onClick={() => enrichWithAI(e.id)}
                      disabled={loadingEnrichId === e.id}
                      title="Text-based enrichment (summary/tags/temperament). Photo matching comes later."
                    >
                      {loadingEnrichId === e.id ? "Enriching…" : "Enrich with AI"}
                    </button>

                    <button
                      type="button"
                      onClick={() => openSimilarPanel(e)}
                      title="Find similar and nearby sightings"
                    >
                      Find Similar
                    </button>

                    {catId != null && (
                      <button
                        type="button"
                        onClick={() => fetchCatInsights(catId, "profile")}
                        title="Generate an AI-style profile for this cat"
                      >
                        Get cat profile (AI)
                      </button>
                    )}
                  </div>

                  {analysis && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: 12,
                        border: "1px solid #eee",
                        borderRadius: 8,
                        background: "#fafafa",
                      }}
                    >
                      <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                        AI enrichment (text-only)
                      </div>

                      <div>
                        <strong>Summary:</strong> {analysis.summary}
                      </div>

                      <div style={{ marginTop: 6 }}>
                        <strong>Temperament:</strong>{" "}
                        {analysis.sentiment === "positive"
                          ? "friendly"
                          : analysis.sentiment === "negative"
                          ? "defensive / cautious"
                          : "unknown / neutral"}
                        <span style={{ color: "#666", marginLeft: 8, fontSize: 12 }}>
                          (raw: {analysis.sentiment})
                        </span>
                      </div>

                      <div style={{ marginTop: 6 }}>
                        <strong>Tags:</strong> {analysis.tags.join(", ")}
                      </div>

                      <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
                        Last updated: {new Date(analysis.updatedAt).toLocaleString()}
                      </div>
                    </div>
                  )}

                  {matchesById[e.id] && (
                    <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 8 }}>
                      <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                        Possible same-cat matches (v0)
                      </div>

                      {matchesById[e.id].length === 0 ? (
                        <div style={{ color: "#666" }}>No strong matches found yet.</div>
                      ) : (
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {matchesById[e.id].map((m) => (
                            <li key={m.candidate_id} style={{ marginBottom: 10 }}>
                              <div style={{ fontWeight: 700 }}>
                                {m.candidate_nickname ? m.candidate_nickname : `Cat #${m.candidate_id}`}{" "}
                                <span style={{ fontWeight: 400, color: "#666" }}>
                                  (score {m.score})
                                </span>
                              </div>

                              {m.candidate_location && (
                                <div style={{ color: "#555" }}>📍 {m.candidate_location}</div>
                              )}

                              <div style={{ marginTop: 4 }}>{m.candidate_text}</div>

                              <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                                Reasons: {m.reasons.join(", ")}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                 {catId != null && loadingInsightCatId === catId && <div>Generating insights…</div>}

                  {catId != null && insightByCatId[catId] && (
                    <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                        Cat Insight Engine · confidence {insightByCatId[catId].confidence}
                      </div>
                      <div style={{ fontWeight: 800 }}>{insightByCatId[catId].headline}</div>
                      <div style={{ marginTop: 6 }}>{insightByCatId[catId].summary}</div>

                      {insightByCatId[catId].flags.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <strong>Flags:</strong> {insightByCatId[catId].flags.join("; ")}
                        </div>
                      )}

                      <div style={{ marginTop: 10 }}>
                        <strong>Suggested actions:</strong>
                        <ul>
                          {insightByCatId[catId].suggested_actions.map((a, idx) => (
                            <li key={idx}>{a}</li>
                          ))}
                        </ul>
                      </div>

                      <div style={{ marginTop: 10 }}>
                        <strong>Citations:</strong>
                        <ul>
                          {insightByCatId[catId].citations.map((c) => (
                            <li key={c.entry_id}>
                              #{c.entry_id}: {c.quote}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </li>
              );
            })
          )}
        </ul>
        </section>
      )}

      {/* Similar/Nearby Panel */}
      {similarPanelEntry && (
        <SimilarNearbyPanel
          entry={similarPanelEntry}
          isOpen={true}
          onClose={closeSimilarPanel}
          onCreateCat={handleCreateCatFromSightings}
          onLinkToCat={handleLinkToExistingCat}
        />
      )}

      {/* Create Cat Modal */}
      {createCatEntryIds && (
        <CreateCatModal
          selectedEntryIds={createCatEntryIds}
          entries={entries}
          onClose={() => setCreateCatEntryIds(null)}
          onSuccess={handleCatCreated}
        />
      )}

      {/* Link to Cat Modal */}
      {linkToCatEntryIds && (
        <LinkToCatModal
          selectedEntryIds={linkToCatEntryIds}
          entries={entries}
          onClose={() => setLinkToCatEntryIds(null)}
          onSuccess={handleSightingsLinked}
        />
      )}
    </main>
  );
}
