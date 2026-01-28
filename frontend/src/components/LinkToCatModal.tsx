/**
 * LinkToCatModal Component
 * Modal for linking sightings to an existing cat
 */

import { useState, useMemo, useEffect } from "react";
import {
  getCats,
  linkSightingsToCat,
  type Entry,
  type Cat,
  type LinkSightingsResponse,
} from "../api/endpoints";
import { useToast } from "./Toast";

// ===========================
// Types
// ===========================

interface LinkToCatModalProps {
  selectedEntryIds: number[];
  entries: Entry[];
  onClose: () => void;
  onSuccess: (response: LinkSightingsResponse) => void;
}

// ===========================
// SightingsPreview Component
// ===========================

interface SightingsPreviewProps {
  entries: Entry[];
  maxVisible?: number;
}

function SightingsPreview({ entries, maxVisible = 3 }: SightingsPreviewProps) {
  const visibleEntries = entries.slice(0, maxVisible);
  const hiddenCount = entries.length - maxVisible;

  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        marginBottom: "16px",
        flexWrap: "wrap",
      }}
    >
      {visibleEntries.map((entry) => (
        <div
          key={entry.id}
          style={{
            padding: "8px 12px",
            backgroundColor: "#f3f4f6",
            borderRadius: "6px",
            fontSize: "13px",
          }}
        >
          <span
            style={{
              maxWidth: "100px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "inline-block",
            }}
          >
            {entry.nickname || entry.location?.split(",")[0] || `#${entry.id}`}
          </span>
        </div>
      ))}
      {hiddenCount > 0 && (
        <div
          style={{
            padding: "8px 12px",
            backgroundColor: "#e5e7eb",
            borderRadius: "6px",
            fontSize: "13px",
            color: "#6b7280",
          }}
        >
          +{hiddenCount} more
        </div>
      )}
    </div>
  );
}

// ===========================
// CatOption Component
// ===========================

interface CatOptionProps {
  cat: Cat;
  selected: boolean;
  onClick: () => void;
}

function CatOption({ cat, selected, onClick }: CatOptionProps) {
  return (
    <div
      onClick={onClick}
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
      <div style={{ fontWeight: 600 }}>
        {cat.name || `Cat #${cat.id}`}
      </div>
      <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>
        Created: {new Date(cat.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}

// ===========================
// Main Component
// ===========================

export function LinkToCatModal({
  selectedEntryIds,
  entries,
  onClose,
  onSuccess,
}: LinkToCatModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCat, setSelectedCat] = useState<Cat | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  const [cats, setCats] = useState<Cat[]>([]);
  const [catsLoading, setCatsLoading] = useState(true);
  const [catsError, setCatsError] = useState<string | null>(null);
  const { showSuccess, showError, showWarning } = useToast();

  // Filter selected entries for preview
  const selectedEntries = useMemo(
    () => entries.filter((e) => selectedEntryIds.includes(e.id)),
    [entries, selectedEntryIds]
  );

  // Filter cats based on search
  const filteredCats = useMemo(() => {
    if (!searchQuery.trim()) return cats;
    const query = searchQuery.toLowerCase();
    return cats.filter(
      (cat) =>
        cat.name?.toLowerCase().includes(query) ||
        cat.id.toString().includes(query)
    );
  }, [cats, searchQuery]);

  // Load cats on mount
  useEffect(() => {
    async function loadCats() {
      setCatsLoading(true);
      setCatsError(null);
      try {
        const data = await getCats();
        setCats(data);
      } catch (err: any) {
        setCatsError("Couldn't load cats");
        console.error(err);
      } finally {
        setCatsLoading(false);
      }
    }
    loadCats();
  }, []);

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
        showSuccess(`${messages.join(", ")} to ${selectedCat.name || `Cat #${selectedCat.id}`}`);
      } else if (result.already_linked.length === selectedEntryIds.length) {
        showWarning("All selected sightings were already linked to this cat.");
      }

      if (result.failed.length > 0) {
        showWarning(`${result.failed.length} sighting(s) could not be linked.`);
      }

      onSuccess(result);
      onClose();
    } catch (err: any) {
      showError(
        "Failed to link sightings",
        err.getUserMessage?.() || "Please try again."
      );
    } finally {
      setIsLinking(false);
    }
  };

  // Handle escape key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !isLinking) {
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={!isLinking ? onClose : undefined}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          zIndex: 1001,
        }}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-label="Add to Existing Cat"
        onKeyDown={handleKeyDown}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          backgroundColor: "#fff",
          borderRadius: "12px",
          padding: "24px",
          width: "400px",
          maxWidth: "90vw",
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.2)",
          zIndex: 1002,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "20px" }}>Add to Existing Cat</h2>
          <button
            onClick={onClose}
            disabled={isLinking}
            style={{
              background: "none",
              border: "none",
              fontSize: "24px",
              cursor: isLinking ? "not-allowed" : "pointer",
              padding: "4px",
              lineHeight: 1,
              opacity: isLinking ? 0.5 : 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Sightings Preview */}
        <SightingsPreview entries={selectedEntries} maxVisible={3} />

        <p
          style={{
            margin: "0 0 16px",
            color: "#6b7280",
            fontSize: "14px",
          }}
        >
          Linking <strong>{selectedEntryIds.length} sightings</strong> to a cat
        </p>

        {/* Search Input */}
        <div style={{ marginBottom: "12px" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search cats..."
            autoFocus
            disabled={isLinking}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              fontSize: "14px",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Cat List */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            marginBottom: "16px",
            minHeight: "200px",
            maxHeight: "300px",
          }}
        >
          {catsLoading ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#6b7280" }}>
              Loading cats...
            </div>
          ) : catsError ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#dc2626" }}>
              {catsError}
            </div>
          ) : filteredCats.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#6b7280" }}>
              {searchQuery ? "No cats found" : "No cats available. Create one first."}
            </div>
          ) : (
            filteredCats.map((cat) => (
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
          <div
            style={{
              padding: "12px",
              backgroundColor: "#eff6ff",
              borderRadius: "6px",
              marginBottom: "16px",
              fontSize: "14px",
            }}
          >
            <strong>Selected:</strong> {selectedCat.name || `Cat #${selectedCat.id}`}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            disabled={isLinking}
            style={{
              padding: "10px 20px",
              backgroundColor: "#fff",
              color: "#374151",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              cursor: isLinking ? "not-allowed" : "pointer",
              fontWeight: 500,
              opacity: isLinking ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleLink}
            disabled={isLinking || !selectedCat}
            style={{
              padding: "10px 20px",
              backgroundColor: isLinking || !selectedCat ? "#9ca3af" : "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: isLinking || !selectedCat ? "not-allowed" : "pointer",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {isLinking && (
              <span
                style={{
                  width: "14px",
                  height: "14px",
                  border: "2px solid #fff",
                  borderTopColor: "transparent",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              />
            )}
            {isLinking ? "Linking..." : "Link Sightings"}
          </button>
        </div>

        <style>
          {`
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          `}
        </style>
      </div>
    </>
  );
}

export default LinkToCatModal;
