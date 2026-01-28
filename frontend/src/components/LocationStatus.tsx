/**
 * LocationStatus Component
 * Shows the normalization status of an entry's location
 */

import React from "react";
import type { Entry } from "../api/endpoints";

// ===========================
// Types
// ===========================

interface LocationStatusProps {
  entry: Entry;
  isNormalizing?: boolean;
  onRetryNormalize?: (entryId: number) => void;
}

type LocationState = "normalized" | "normalizing" | "failed" | "no_location";

// ===========================
// Status Messages
// ===========================

const LOCATION_STATUS_MESSAGES: Record<string, string> = {
  success: "Location verified",
  not_found: "Location not found on map. Check spelling or try a nearby landmark.",
  error: "Could not verify location. Click to retry.",
  no_location: "No location provided",
  already_normalized: "Location already verified",
};

// ===========================
// Helper Functions
// ===========================

function getLocationState(entry: Entry, isNormalizing: boolean): LocationState {
  if (isNormalizing) return "normalizing";
  if (!entry.location) return "no_location";
  if (entry.location_lat !== null && entry.location_lat !== undefined) return "normalized";
  return "failed";
}

// Helper to format distance between two coordinates
export function formatDistance(lat1: number, lon1: number, lat2: number, lon2: number): string {
  // Haversine formula
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  if (distance < 1000) {
    return `${Math.round(distance)}m`;
  }
  return `${(distance / 1000).toFixed(1)}km`;
}

// ===========================
// Component
// ===========================

export function LocationStatus({
  entry,
  isNormalizing = false,
  onRetryNormalize,
}: LocationStatusProps) {
  const state = getLocationState(entry, isNormalizing);

  const styles: Record<LocationState, React.CSSProperties> = {
    normalized: {
      color: "#22c55e",
    },
    normalizing: {
      color: "#3b82f6",
    },
    failed: {
      color: "#eab308",
    },
    no_location: {
      color: "#9ca3af",
    },
  };

  const icons: Record<LocationState, string> = {
    normalized: "\u2713", // checkmark
    normalizing: "\u27F3", // rotating arrows
    failed: "\u26A0", // warning
    no_location: "\u2014", // em dash
  };

  const getTooltipContent = (): string => {
    switch (state) {
      case "normalized":
        return entry.location_normalized || "Location verified";
      case "normalizing":
        return "Verifying location...";
      case "failed":
        return LOCATION_STATUS_MESSAGES.not_found;
      case "no_location":
        return LOCATION_STATUS_MESSAGES.no_location;
      default:
        return "";
    }
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "13px",
        ...styles[state],
      }}
      title={getTooltipContent()}
    >
      <span
        style={{
          fontSize: "14px",
          animation: state === "normalizing" ? "spin 1s linear infinite" : undefined,
        }}
      >
        {icons[state]}
      </span>

      {state === "normalized" && entry.location_normalized && (
        <span style={{ maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.location_normalized.split(",")[0]}
        </span>
      )}

      {state === "normalizing" && (
        <span style={{ fontStyle: "italic" }}>Verifying...</span>
      )}

      {state === "failed" && onRetryNormalize && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRetryNormalize(entry.id);
          }}
          style={{
            background: "none",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            textDecoration: "underline",
            fontSize: "12px",
            padding: "0 4px",
          }}
        >
          Retry
        </button>
      )}

      {state === "no_location" && (
        <span style={{ fontStyle: "italic" }}>No location</span>
      )}

      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
    </span>
  );
}

// ===========================
// Location Badge Component
// ===========================

interface LocationBadgeProps {
  entry: Entry;
  showCoordinates?: boolean;
}

export function LocationBadge({ entry, showCoordinates = false }: LocationBadgeProps) {
  if (!entry.location && !entry.location_normalized) {
    return null;
  }

  const hasCoords = entry.location_lat !== null && entry.location_lat !== undefined;
  const displayLocation = entry.location_normalized || entry.location;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 8px",
        borderRadius: "12px",
        fontSize: "12px",
        backgroundColor: hasCoords ? "#dcfce7" : "#f3f4f6",
        color: hasCoords ? "#166534" : "#6b7280",
      }}
      title={
        hasCoords
          ? `${entry.location_normalized}${showCoordinates ? ` (${entry.location_lat?.toFixed(4)}, ${entry.location_lon?.toFixed(4)})` : ""}`
          : `Original: ${entry.location}`
      }
    >
      <span>{hasCoords ? "\uD83D\uDCCD" : "\uD83D\uDDFA\uFE0F"}</span>
      <span
        style={{
          maxWidth: "120px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {displayLocation?.split(",")[0] || "Unknown"}
      </span>
    </span>
  );
}

export default LocationStatus;
