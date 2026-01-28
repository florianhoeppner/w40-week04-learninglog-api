/**
 * CreateCatModal Component
 * Modal for creating a new cat from selected sightings
 */

import { useState, useMemo } from "react";
import { createCatFromSightings, type Entry, type Cat } from "../api/endpoints";
import { useToast } from "./Toast";

// ===========================
// Types
// ===========================

interface CreateCatModalProps {
  selectedEntryIds: number[];
  entries: Entry[];
  onClose: () => void;
  onSuccess: (cat: Cat) => void;
}

// ===========================
// Helper Functions
// ===========================

function getMostFrequent<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  const counts = new Map<T, number>();
  arr.forEach((item) => {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  });
  let maxCount = 0;
  let maxItem: T | null = null;
  counts.forEach((count, item) => {
    if (count > maxCount) {
      maxCount = count;
      maxItem = item;
    }
  });
  return maxItem;
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
          {entry.photo_url ? (
            <img
              src={entry.photo_url}
              alt="Sighting"
              style={{
                width: "40px",
                height: "40px",
                objectFit: "cover",
                borderRadius: "4px",
                marginRight: "8px",
                verticalAlign: "middle",
              }}
            />
          ) : null}
          <span
            style={{
              maxWidth: "100px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "inline-block",
              verticalAlign: "middle",
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
// Main Component
// ===========================

export function CreateCatModal({
  selectedEntryIds,
  entries,
  onClose,
  onSuccess,
}: CreateCatModalProps) {
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const { showSuccess, showError } = useToast();

  // Filter selected entries for preview
  const selectedEntries = useMemo(
    () => entries.filter((e) => selectedEntryIds.includes(e.id)),
    [entries, selectedEntryIds]
  );

  // Generate suggested name from common location
  const suggestedName = useMemo(() => {
    const locations = selectedEntries
      .map((e) => e.location_normalized?.split(",")[0] || e.location?.split(",")[0])
      .filter(Boolean) as string[];
    const mostCommon = getMostFrequent(locations);
    return mostCommon ? `${mostCommon} Cat` : "";
  }, [selectedEntries]);

  const handleCreate = async () => {
    try {
      setIsCreating(true);
      const catName = name.trim() || suggestedName || undefined;
      const cat = await createCatFromSightings(selectedEntryIds, catName);

      showSuccess(
        `Created ${cat.name || "new cat"} with ${selectedEntryIds.length} sightings`
      );

      onSuccess(cat);
      onClose();
    } catch (err: any) {
      showError(
        "Failed to create cat",
        err.getUserMessage?.() || "Please try again."
      );
    } finally {
      setIsCreating(false);
    }
  };

  // Handle escape key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !isCreating) {
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={!isCreating ? onClose : undefined}
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
        aria-label="Create New Cat"
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
          overflow: "auto",
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
          <h2 style={{ margin: 0, fontSize: "20px" }}>Create New Cat</h2>
          <button
            onClick={onClose}
            disabled={isCreating}
            style={{
              background: "none",
              border: "none",
              fontSize: "24px",
              cursor: isCreating ? "not-allowed" : "pointer",
              padding: "4px",
              lineHeight: 1,
              opacity: isCreating ? 0.5 : 1,
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
            margin: "0 0 20px",
            color: "#6b7280",
            fontSize: "14px",
          }}
        >
          Creating cat from <strong>{selectedEntryIds.length} sightings</strong>
        </p>

        {/* Name Input */}
        <div style={{ marginBottom: "20px" }}>
          <label
            htmlFor="cat-name"
            style={{
              display: "block",
              marginBottom: "6px",
              fontWeight: 500,
              fontSize: "14px",
            }}
          >
            Cat Name (optional)
          </label>
          <input
            id="cat-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={suggestedName || "Enter a name..."}
            maxLength={100}
            autoFocus
            disabled={isCreating}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              fontSize: "14px",
              boxSizing: "border-box",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: "6px",
              fontSize: "12px",
              color: "#9ca3af",
            }}
          >
            {suggestedName && !name && (
              <span>Suggested: {suggestedName}</span>
            )}
            <span style={{ marginLeft: "auto" }}>{name.length}/100</span>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            disabled={isCreating}
            style={{
              padding: "10px 20px",
              backgroundColor: "#fff",
              color: "#374151",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              cursor: isCreating ? "not-allowed" : "pointer",
              fontWeight: 500,
              opacity: isCreating ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isCreating}
            style={{
              padding: "10px 20px",
              backgroundColor: isCreating ? "#9ca3af" : "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: isCreating ? "not-allowed" : "pointer",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {isCreating && (
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
            {isCreating ? "Creating..." : "Create Cat"}
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

export default CreateCatModal;
