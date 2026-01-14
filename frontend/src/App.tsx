import { useEffect, useMemo, useState } from "react";
import "./App.css";

/**
 * CatAtlas v0
 * - Sightings stored in backend (SQLite)
 * - AI enrichment stored/cached in backend (SQLite)
 * - Frontend calls backend to create sightings and enrich them
 */

/** A single cat sighting coming from the backend */
type Entry = {
  id: number;
  text: string; // notes / description
  createdAt: string; // ISO string
  isFavorite: boolean;

  // CatAtlas-specific optional fields
  nickname?: string | null;
  location?: string | null;
    // NEW: optional photo URL for the sighting
  photo_url?: string | null;

  // NEW (Week 8): optional link to a Cat identity
  cat_id?: number | null;
};

/** Payload when creating a new cat sighting */
type EntryCreatePayload = {
  text: string;
  nickname?: string | null;
  location?: string | null;
  photo_url?: string | null;
};

/**
 * Stored analysis result returned by:
 * - POST /entries/{id}/analyze
 * - GET  /entries/{id}/analysis
 */
type EntryAnalysis = {
  entry_id: number;
  summary: string;
  tags: string[];
  sentiment: "positive" | "neutral" | "negative";
  updatedAt: string;
};

type CatInsightResponse = {
  cat_id: number;
  mode: string;
  prompt_version: string;
  confidence: number;
  headline: string;
  summary: string;
  flags: string[];
  suggested_actions: string[];
  citations: { entry_id: number; quote: string; location?: string | null; createdAt: string }[];
  generatedAt: string;
};




/** A candidate match returned by GET /matches */
type MatchCandidate = {
  entry_id: number;
  candidate_id: number;
  score: number;
  reasons: string[];
  candidate_nickname?: string | null;
  candidate_location?: string | null;
  candidate_text: string;
  candidate_createdAt: string;
};


/**
 * IMPORTANT:
 * In Codespaces, your backend is NOT localhost for your browser.
 * Use VITE_API_BASE in frontend/.env:
 *   VITE_API_BASE=https://<your>-8000.app.github.dev
 */
const API_BASE = import.meta.env.VITE_API_BASE;
if (!API_BASE) throw new Error("VITE_API_BASE is not set");



export default function App() {
  // ----------------------------
  // Main data state
  // ----------------------------
  const [entries, setEntries] = useState<Entry[]>([]);
  const [analysisById, setAnalysisById] = useState<Record<number, EntryAnalysis>>({});
  const [matchesById, setMatchesById] = useState<Record<number, MatchCandidate[]>>({});
  const [loadingMatchId, setLoadingMatchId] = useState<number | null>(null);

  // ----------------------------
  // UI state
  // ----------------------------
  const [filter, setFilter] = useState<"all" | "favorites">("all");
  const [error, setError] = useState<string | null>(null);

  // "Loading" state for enrichment button: we track which entry is currently being enriched
  const [loadingEnrichId, setLoadingEnrichId] = useState<number | null>(null);

  // ----------------------------
  // Form state (Cat sighting form)
  // ----------------------------
  const [nickname, setNickname] = useState("");
  const [location, setLocation] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [notes, setNotes] = useState("");

  // ----------------------------
  // Derived state: what entries to show
  // ----------------------------
  const visible = useMemo(() => {
    return entries.filter((e) => (filter === "favorites" ? e.isFavorite : true));
  }, [entries, filter]);


  // ----------------------------
  // Week 9: Cat Insights state
  // ----------------------------
  const [insightByCatId, setInsightByCatId] = useState<Record<number, CatInsightResponse>>({});
  const [loadingInsightCatId, setLoadingInsightCatId] = useState<number | null>(null);

  // ----------------------------
  // Community stats (Step 5)
  // ----------------------------

  // Total number of sightings contributed
  const totalSightings = entries.length;

  // How many sightings already have enrichment stored/loaded
  const enrichedCount = useMemo(() => {
    return Object.keys(analysisById).length;
  }, [analysisById]);

  // Compute top tags across all analyses we currently have in memory
  const topTags = useMemo(() => {
    const counts = new Map<string, number>();

    Object.values(analysisById).forEach((a) => {
      a.tags.forEach((t) => {
        const tag = t.trim().toLowerCase();
        if (!tag) return;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      });
    });

    // Convert map -> array -> sort by frequency desc
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

    // Take top 8 tags (small + readable)
    return sorted.slice(0, 8);
  }, [analysisById]);

  // Most recent sighting date (optional nice touch)
  const mostRecentSighting = useMemo(() => {
    if (entries.length === 0) return null;
    const dates = entries
      .map((e) => new Date(e.createdAt).getTime())
      .filter((t) => !Number.isNaN(t));
    if (dates.length === 0) return null;
    return new Date(Math.max(...dates));
  }, [entries]);

  // ----------------------------
  // Backend calls
  // ----------------------------

  async function loadEntries() {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/entries`);
      if (!res.ok) throw new Error(`GET /entries failed: ${res.status}`);
      const data = (await res.json()) as Entry[];
      setEntries(data);

      // Step 4/5: After loading sightings, try to load enrichment for each sighting.
      // If the backend returns 404 (no analysis yet), we just ignore it.
      data.forEach((e) => {
        loadAnalysisIfExists(e.id);
      });
    } catch (e) {
      console.error(e);
      setError("Could not load sightings. Is the backend running?");
    }
  }


  async function fetchCatInsights(catId: number, mode: "profile" | "care" | "update" | "risk") {
  setLoadingInsightCatId(catId);
  setError(null);

  try {
    const res = await fetch(`${API_BASE}/cats/${catId}/insights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });

    if (!res.ok) throw new Error(`Insights failed: ${res.status}`);

    const data = (await res.json()) as CatInsightResponse;

    setInsightByCatId((prev) => ({
      ...prev,
      [catId]: data,
    }));
  } catch (e) {
    console.error(e);
    setError("Could not load cat insights. Is the backend running?");
  } finally {
    setLoadingInsightCatId(null);
  }
}


  async function findMatches(entryId: number) {
  setLoadingMatchId(entryId);
  setError(null);

  try {
    const res = await fetch(`${API_BASE}/entries/${entryId}/matches?top_k=5&min_score=0.15`);
    if (!res.ok) {
      throw new Error(`Matches failed: ${res.status}`);
    }

    const data = (await res.json()) as MatchCandidate[];

    setMatchesById((prev) => ({
      ...prev,
      [entryId]: data,
    }));
  } catch (e) {
    console.error(e);
    setError("Could not load matches. Is the backend running?");
  } finally {
    setLoadingMatchId(null);
  }
}


  async function addSighting() {
    const text = notes.trim();
    if (!text) return;

    const payload: EntryCreatePayload = {
      text,
      nickname: nickname.trim() ? nickname.trim() : null,
      location: location.trim() ? location.trim() : null,
      photo_url: photoUrl.trim() ? photoUrl.trim() : null,
    };

    setError(null);

    try {
      const res = await fetch(`${API_BASE}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`POST /entries failed: ${res.status}`);

      const created = (await res.json()) as Entry;
      setEntries((prev) => [created, ...prev]);

      // Reset form for fast, repeated sightings
      setNickname("");
      setLocation("");
      setNotes("");
      setPhotoUrl("");
    } catch (e) {
      console.error(e);
      setError("Could not create sighting. Is the backend running?");
    }
  }

  async function toggleFavorite(entryId: number) {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/entries/${entryId}/favorite`, {
        method: "POST",
      });

      if (!res.ok) throw new Error(`POST /favorite failed: ${res.status}`);

      const updated = (await res.json()) as Entry;
      setEntries((prev) => prev.map((e) => (e.id === entryId ? updated : e)));
    } catch (e) {
      console.error(e);
      setError("Could not toggle favorite. Is the backend running?");
    }
  }

  /**
   * Step 4: Reframed AI analysis:
   * - In CatAtlas we call this "Enrich with AI" (same behavior as analyze)
   * - We store results in SQLite on the backend (Week 6 pattern)
   */
  async function enrichWithAI(entryId: number) {
    setLoadingEnrichId(entryId);
    setError(null);

    try {
      // This endpoint computes analysis IF needed and persists it in SQLite.
      // If cached and up-to-date, it returns the cached result quickly.
      const res = await fetch(`${API_BASE}/entries/${entryId}/analyze`, {
        method: "POST",
      });

      if (!res.ok) throw new Error(`POST /entries/${entryId}/analyze failed`);

      const data = (await res.json()) as EntryAnalysis;

      setAnalysisById((prev) => ({
        ...prev,
        [entryId]: data,
      }));
    } catch (e) {
      console.error(e);
      setError("Enrichment failed. Is the backend running?");
    } finally {
      setLoadingEnrichId(null);
    }
  }

  /**
   * Load analysis from backend if it already exists.
   * - 200 => store it
   * - 404 => not enriched yet (normal)
   */
  async function loadAnalysisIfExists(entryId: number) {
    try {
      const res = await fetch(`${API_BASE}/entries/${entryId}/analysis`);
      if (res.status === 404) return; // no analysis yet is fine
      if (!res.ok) return;

      const data = (await res.json()) as EntryAnalysis;

      setAnalysisById((prev) => ({
        ...prev,
        [entryId]: data,
      }));
    } catch {
      // Ignore for now (this is an optional enhancement)
    }
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

      {/* ------------------------------------------------------------
          Step 5 — "Community feeling" dashboard
          ------------------------------------------------------------ */}
      <section style={{ marginTop: 16 }}>
        <h2>Community snapshot</h2>

        {/* Simple numbers create an immediate sense of progress/community */}
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

        {/* Show most common tags across enriched sightings */}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
            Top tags (from AI enrichment)
          </div>

          {topTags.length === 0 ? (
            <div style={{ color: "#666" }}>
              No enrichment yet. Click “Enrich with AI” on a sighting to start building shared knowledge.
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

      {/* ------------------------------------------------------------
          Add cat sighting form (you already built this in Step 3)
          ------------------------------------------------------------ */}
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
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g., 5th Ave & Pine, Central Park north entrance"
          style={{
            width: "100%",
            padding: 8,
            boxSizing: "border-box",
            marginTop: 6,
          }}
        />

        <label style={{ display: "block", fontWeight: 600, marginTop: 12 }}>
        Photo URL (optional)
        </label>
        <input
          value={photoUrl}
          onChange={(e) => setPhotoUrl(e.target.value)}
          placeholder="https://... (later: real upload)"
          style={{ width: "100%", padding: 8, boxSizing: "border-box", marginTop: 6 }}
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
          <button type="button" onClick={addSighting} disabled={!notes.trim()}>
            Add sighting
          </button>

          <button
            type="button"
            onClick={() => {
              setNickname("");
              setLocation("");
              setPhotoUrl("");
              setNotes("");
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

      {/* ------------------------------------------------------------
          Filters (same as Week 4)
          ------------------------------------------------------------ */}
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

      {/* ------------------------------------------------------------
          Sightings list + Step 4: "Enrich with AI" button + output
          ------------------------------------------------------------ */}
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
                  {/* Title line: nickname if available */}
                  <div style={{ fontWeight: 800 }}>
                    {e.nickname ? e.nickname : `Cat #${e.id}`}
                  </div>

                  {/* Optional location */}
                  {e.location && (
                    <div style={{ color: "#555", marginTop: 4 }}>
                      📍 {e.location}
                    </div>
                  )}
                  {e.photo_url && (
                  <img
                    src={e.photo_url}
                    alt="Cat sighting"
                    style={{ marginTop: 10, maxWidth: "100%", borderRadius: 8, border: "1px solid #eee" }}
                  />
                  )}

                  {/* Notes/description */}
                  <div style={{ marginTop: 8 }}>{e.text}</div>

                  {/* Timestamp */}
                  <div className="entry-meta" style={{ marginTop: 8 }}>
                    {new Date(e.createdAt).toLocaleString()}
                  </div>

                  {/* Action buttons */}
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => toggleFavorite(e.id)}>
                      {e.isFavorite ? "Unfavorite" : "Favorite"}
                    </button>

                    {/* Step 4: reframe "Analyze" => "Enrich with AI" */}
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
                      onClick={() => findMatches(e.id)}
                      disabled={loadingMatchId === e.id}
                      title="Suggest similar cats based on notes + location (text-only)"
                    >
                      {loadingMatchId === e.id ? "Matching…" : "Find matches"}
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

                  {/* Step 4: show the enriched result under the sighting */}
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

                      {/* We intentionally label sentiment as temperament to fit CatAtlas domain */}
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
    </main>
  );
}
