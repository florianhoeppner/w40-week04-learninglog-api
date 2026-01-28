/**
 * SimilarNearbyPanel Component
 * Allows users to discover similar and nearby sightings
 */

import { useState, useCallback, useEffect } from "react";
import {
  findMatches,
  getNearbySightings,
  type Entry,
  type MatchCandidate,
  type NearbySighting,
} from "../api/endpoints";

// ===========================
// Types
// ===========================

interface SimilarNearbyPanelProps {
  entry: Entry;
  isOpen: boolean;
  onClose: () => void;
  onCreateCat: (entryIds: number[]) => void;
  onLinkToCat: (entryIds: number[]) => void;
}

type TabType = "similar" | "nearby";

// ===========================
// Sub-Components
// ===========================

interface MatchCardProps {
  match: MatchCandidate | NearbySighting;
  selected: boolean;
  onToggle: () => void;
}

function MatchCard({ match, selected, onToggle }: MatchCardProps) {
  const isNearby = "distance_meters" in match;
  const score = isNearby ? match.match_score : match.score;
  const scoreLabel = score > 0.7 ? "High" : score > 0.4 ? "Medium" : "Low";
  const scoreColor = score > 0.7 ? "#22c55e" : score > 0.4 ? "#eab308" : "#9ca3af";

  const text = isNearby ? match.text_preview : match.candidate_text;
  const location = isNearby ? match.location_normalized || match.location : match.candidate_location;
  const catName = isNearby ? match.cat_name : null;
  const reasons = match.reasons;
  const id = isNearby ? match.entry_id : match.candidate_id;

  return (
    <div
      onClick={onToggle}
      style={{
        padding: "12px",
        border: selected ? "2px solid #3b82f6" : "1px solid #e5e7eb",
        borderRadius: "8px",
        marginBottom: "8px",
        cursor: "pointer",
        backgroundColor: selected ? "#eff6ff" : "#fff",
        transition: "all 0.15s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          style={{ marginTop: "4px" }}
          aria-label={`Select sighting #${id}`}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: "14px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {text}
          </p>

          {isNearby && (
            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#6b7280" }}>
              {match.distance_meters < 1000
                ? `${Math.round(match.distance_meters)}m away`
                : `${(match.distance_meters / 1000).toFixed(1)}km away`}
            </p>
          )}

          {location && (
            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#6b7280" }}>
              📍 {location}
            </p>
          )}

          {catName && (
            <span
              style={{
                display: "inline-block",
                marginTop: "4px",
                padding: "2px 8px",
                borderRadius: "12px",
                fontSize: "11px",
                backgroundColor: "#dcfce7",
                color: "#166534",
              }}
            >
              Linked to: {catName}
            </span>
          )}
        </div>

        <div
          style={{
            padding: "4px 8px",
            borderRadius: "4px",
            fontSize: "11px",
            fontWeight: 500,
            backgroundColor: `${scoreColor}20`,
            color: scoreColor,
          }}
          title={`Match score: ${(score * 100).toFixed(0)}%`}
        >
          {scoreLabel}
        </div>
      </div>

      {reasons.length > 0 && (
        <p
          style={{
            margin: "8px 0 0 28px",
            fontSize: "11px",
            color: "#9ca3af",
          }}
        >
          {reasons.join(", ")}
        </p>
      )}
    </div>
  );
}

interface RadiusSliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
}

function RadiusSlider({ value, onChange, min, max, step }: RadiusSliderProps) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <label
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "13px",
          marginBottom: "4px",
        }}
      >
        <span>Search radius</span>
        <span style={{ fontWeight: 600 }}>
          {value < 1000 ? `${value}m` : `${(value / 1000).toFixed(1)}km`}
        </span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%" }}
      />
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div
      style={{
        padding: "32px 16px",
        textAlign: "center",
        color: "#6b7280",
      }}
    >
      <p style={{ margin: 0, fontWeight: 500 }}>{title}</p>
      <p style={{ margin: "8px 0 0", fontSize: "13px" }}>{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: "12px",
            padding: "6px 12px",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div
      style={{
        padding: "16px",
        backgroundColor: "#fef2f2",
        borderRadius: "8px",
        textAlign: "center",
      }}
    >
      <p style={{ margin: 0, color: "#dc2626" }}>{message}</p>
      <button
        onClick={onRetry}
        style={{
          marginTop: "8px",
          padding: "6px 12px",
          fontSize: "13px",
          cursor: "pointer",
        }}
      >
        Try Again
      </button>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            padding: "12px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            marginBottom: "8px",
          }}
        >
          <div
            style={{
              height: "14px",
              backgroundColor: "#f3f4f6",
              borderRadius: "4px",
              width: "80%",
              animation: "pulse 1.5s infinite",
            }}
          />
          <div
            style={{
              height: "12px",
              backgroundColor: "#f3f4f6",
              borderRadius: "4px",
              width: "50%",
              marginTop: "8px",
              animation: "pulse 1.5s infinite",
            }}
          />
        </div>
      ))}
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}
      </style>
    </div>
  );
}

// ===========================
// Main Component
// ===========================

export function SimilarNearbyPanel({
  entry,
  isOpen,
  onClose,
  onCreateCat,
  onLinkToCat,
}: SimilarNearbyPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("similar");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set([entry.id]));
  const [radius, setRadius] = useState(500);

  // Data states
  const [matches, setMatches] = useState<MatchCandidate[]>([]);
  const [nearby, setNearby] = useState<NearbySighting[]>([]);

  // Loading states
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [nearbyLoading, setNearbyLoading] = useState(false);

  // Error states
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const [nearbyError, setNearbyError] = useState<string | null>(null);

  // Check if entry has coordinates
  const hasCoordinates = entry.location_lat !== null && entry.location_lat !== undefined;

  // Fetch matches
  const fetchMatches = useCallback(async () => {
    setMatchesLoading(true);
    setMatchesError(null);
    try {
      const data = await findMatches(entry.id, 10, 0.15);
      setMatches(data);
    } catch (e: any) {
      setMatchesError("Couldn't load similar sightings");
      console.error(e);
    } finally {
      setMatchesLoading(false);
    }
  }, [entry.id]);

  // Fetch nearby
  const fetchNearby = useCallback(async () => {
    if (!hasCoordinates) return;
    setNearbyLoading(true);
    setNearbyError(null);
    try {
      const data = await getNearbySightings(entry.id, radius, 10, true);
      setNearby(data);
    } catch (e: any) {
      setNearbyError("Couldn't load nearby sightings");
      console.error(e);
    } finally {
      setNearbyLoading(false);
    }
  }, [entry.id, radius, hasCoordinates]);

  // Load data when panel opens
  useEffect(() => {
    if (isOpen) {
      fetchMatches();
      if (hasCoordinates) {
        fetchNearby();
      }
    }
  }, [isOpen, fetchMatches, fetchNearby, hasCoordinates]);

  // Reload nearby when radius changes
  useEffect(() => {
    if (isOpen && activeTab === "nearby" && hasCoordinates) {
      fetchNearby();
    }
  }, [radius]);

  // Selection handlers
  const toggleSelection = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Don't allow deselecting the source entry
        if (id !== entry.id) {
          next.delete(id);
        }
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    const allIds = activeTab === "similar"
      ? matches.map((m) => m.candidate_id)
      : nearby.map((n) => n.entry_id);
    setSelectedIds(new Set([entry.id, ...allIds]));
  };

  const deselectAll = () => {
    setSelectedIds(new Set([entry.id]));
  };

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentList = activeTab === "similar" ? matches : nearby;
  const currentLoading = activeTab === "similar" ? matchesLoading : nearbyLoading;
  const currentError = activeTab === "similar" ? matchesError : nearbyError;
  const refetch = activeTab === "similar" ? fetchMatches : fetchNearby;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.3)",
          zIndex: 999,
        }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-label="Find Similar Sightings"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "400px",
          maxWidth: "100vw",
          backgroundColor: "#fff",
          boxShadow: "-4px 0 20px rgba(0, 0, 0, 0.1)",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          animation: "slideIn 0.2s ease-out",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "18px" }}>Find Similar Sightings</h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "24px",
              cursor: "pointer",
              padding: "4px",
              lineHeight: 1,
            }}
            aria-label="Close panel"
          >
            \u00D7
          </button>
        </div>

        {/* Source entry summary */}
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#f9fafb",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <p style={{ margin: 0, fontSize: "13px", color: "#6b7280" }}>
            Comparing with:
          </p>
          <p
            style={{
              margin: "4px 0 0",
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entry.nickname || `Sighting #${entry.id}`}
          </p>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <button
            role="tab"
            aria-selected={activeTab === "similar"}
            onClick={() => setActiveTab("similar")}
            style={{
              flex: 1,
              padding: "12px",
              border: "none",
              backgroundColor: activeTab === "similar" ? "#fff" : "#f9fafb",
              borderBottom: activeTab === "similar" ? "2px solid #3b82f6" : "2px solid transparent",
              cursor: "pointer",
              fontWeight: activeTab === "similar" ? 600 : 400,
              color: activeTab === "similar" ? "#3b82f6" : "#6b7280",
            }}
          >
            Similar Text {matches.length > 0 && `(${matches.length})`}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "nearby"}
            onClick={() => setActiveTab("nearby")}
            disabled={!hasCoordinates}
            title={!hasCoordinates ? "Location not verified yet" : undefined}
            style={{
              flex: 1,
              padding: "12px",
              border: "none",
              backgroundColor: activeTab === "nearby" ? "#fff" : "#f9fafb",
              borderBottom: activeTab === "nearby" ? "2px solid #3b82f6" : "2px solid transparent",
              cursor: hasCoordinates ? "pointer" : "not-allowed",
              fontWeight: activeTab === "nearby" ? 600 : 400,
              color: activeTab === "nearby" ? "#3b82f6" : "#6b7280",
              opacity: hasCoordinates ? 1 : 0.5,
            }}
          >
            Nearby {nearby.length > 0 && `(${nearby.length})`}
          </button>
        </div>

        {/* Radius slider for nearby tab */}
        {activeTab === "nearby" && hasCoordinates && (
          <div style={{ padding: "16px 16px 0" }}>
            <RadiusSlider
              value={radius}
              onChange={setRadius}
              min={100}
              max={2000}
              step={100}
            />
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
          {currentLoading ? (
            <LoadingSkeleton />
          ) : currentError ? (
            <ErrorState message={currentError} onRetry={refetch} />
          ) : activeTab === "nearby" && !hasCoordinates ? (
            <EmptyState
              title="Location not available"
              description="This sighting's location hasn't been verified yet. The 'Nearby' search requires a verified location."
            />
          ) : currentList.length === 0 ? (
            <EmptyState
              title={activeTab === "similar" ? "No similar sightings found" : "No sightings nearby"}
              description={
                activeTab === "similar"
                  ? "This sighting appears to be unique."
                  : "No other sightings within the selected radius. Try increasing the search area."
              }
            />
          ) : (
            <>
              {/* Selection controls */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "12px",
                  fontSize: "13px",
                }}
              >
                <span style={{ color: "#6b7280" }}>
                  {selectedIds.size - 1} of {currentList.length} selected
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={selectAll}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#3b82f6",
                      cursor: "pointer",
                      fontSize: "13px",
                    }}
                  >
                    Select all
                  </button>
                  <button
                    onClick={deselectAll}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#6b7280",
                      cursor: "pointer",
                      fontSize: "13px",
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Match list */}
              {activeTab === "similar"
                ? matches.map((match) => (
                    <MatchCard
                      key={match.candidate_id}
                      match={match}
                      selected={selectedIds.has(match.candidate_id)}
                      onToggle={() => toggleSelection(match.candidate_id)}
                    />
                  ))
                : nearby.map((sighting) => (
                    <MatchCard
                      key={sighting.entry_id}
                      match={sighting}
                      selected={selectedIds.has(sighting.entry_id)}
                      onToggle={() => toggleSelection(sighting.entry_id)}
                    />
                  ))}
            </>
          )}
        </div>

        {/* Action bar */}
        {selectedIds.size > 1 && (
          <div
            style={{
              padding: "16px",
              borderTop: "1px solid #e5e7eb",
              backgroundColor: "#f9fafb",
            }}
          >
            <p style={{ margin: "0 0 12px", fontWeight: 500 }}>
              {selectedIds.size} sightings selected
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => onCreateCat(Array.from(selectedIds))}
                style={{
                  flex: 1,
                  padding: "10px",
                  backgroundColor: "#3b82f6",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                Create New Cat
              </button>
              <button
                onClick={() => onLinkToCat(Array.from(selectedIds))}
                style={{
                  flex: 1,
                  padding: "10px",
                  backgroundColor: "#fff",
                  color: "#374151",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                Add to Existing Cat
              </button>
            </div>
          </div>
        )}

        <style>
          {`
            @keyframes slideIn {
              from {
                transform: translateX(100%);
              }
              to {
                transform: translateX(0);
              }
            }
          `}
        </style>
      </div>
    </>
  );
}

export default SimilarNearbyPanel;
