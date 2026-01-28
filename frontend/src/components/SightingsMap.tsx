/**
 * SightingsMap Component
 * Displays cat sightings on an interactive map with clustering
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  getEntriesByArea,
  getSuggestedGroupings,
  type Entry,
  type AreaSighting,
  type AreaQueryResponse,
  type SuggestedGroup,
  type SuggestedGroupingsResponse,
} from "../api/endpoints";

// ===========================
// Fix Leaflet default icon issue
// ===========================

// @ts-ignore - Leaflet icon fix for bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// ===========================
// Types
// ===========================

interface SightingsMapProps {
  entries: Entry[];
  onEntryClick: (entryId: number) => void;
  onCreateCat: (entryIds: number[]) => void;
}

// ===========================
// Custom Marker Icons
// ===========================

const unassignedIcon = new L.DivIcon({
  className: "custom-marker",
  html: `<div style="
    width: 20px;
    height: 20px;
    background: #3b82f6;
    border: 3px solid white;
    border-radius: 50%;
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  "></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const assignedIcon = new L.DivIcon({
  className: "custom-marker",
  html: `<div style="
    width: 24px;
    height: 24px;
    background: #22c55e;
    border: 3px solid white;
    border-radius: 50%;
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
  ">🐱</div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

// ===========================
// Map Event Handler Component
// ===========================

interface MapEventsProps {
  onMoveEnd: (center: [number, number], zoom: number) => void;
}

function MapEvents({ onMoveEnd }: MapEventsProps) {
  const map = useMap();

  useEffect(() => {
    const handleMoveEnd = () => {
      const center = map.getCenter();
      onMoveEnd([center.lat, center.lng], map.getZoom());
    };

    map.on("moveend", handleMoveEnd);
    return () => {
      map.off("moveend", handleMoveEnd);
    };
  }, [map, onMoveEnd]);

  return null;
}

// ===========================
// Helper Functions
// ===========================

function getRadiusFromZoom(zoom: number): number {
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

function getClusterColor(confidence: number): string {
  if (confidence > 0.7) return "#22c55e";
  if (confidence > 0.4) return "#eab308";
  return "#9ca3af";
}

// ===========================
// GroupDetailsPanel Component
// ===========================

interface GroupDetailsPanelProps {
  group: SuggestedGroup;
  sightings: AreaSighting[];
  onClose: () => void;
  onCreateCat: () => void;
}

function GroupDetailsPanel({ group, sightings, onClose, onCreateCat }: GroupDetailsPanelProps) {
  const confidenceLabel =
    group.confidence > 0.7 ? "High" : group.confidence > 0.4 ? "Medium" : "Low";
  const confidenceColor = getClusterColor(group.confidence);

  return (
    <div
      style={{
        position: "absolute",
        top: "16px",
        right: "16px",
        width: "300px",
        maxHeight: "calc(100% - 32px)",
        backgroundColor: "#fff",
        borderRadius: "12px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h3 style={{ margin: "0 0 4px", fontSize: "16px" }}>
            {group.suggested_name || "Suggested Group"}
          </h3>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: "12px",
              fontSize: "11px",
              fontWeight: 500,
              backgroundColor: `${confidenceColor}20`,
              color: confidenceColor,
            }}
          >
            {confidenceLabel} confidence
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            fontSize: "20px",
            cursor: "pointer",
            padding: "0 4px",
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Info */}
      <div style={{ padding: "16px", borderBottom: "1px solid #e5e7eb" }}>
        <p style={{ margin: 0, fontSize: "13px", color: "#6b7280" }}>
          {group.entry_ids.length} sightings within {Math.round(group.radius_meters)}m
        </p>

        {group.reasons.length > 0 && (
          <div style={{ marginTop: "12px" }}>
            <p style={{ margin: "0 0 8px", fontSize: "12px", fontWeight: 600 }}>
              Why these might be the same cat:
            </p>
            <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "12px", color: "#6b7280" }}>
              {group.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Sightings list */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px 16px" }}>
        {sightings.map((sighting) => (
          <div
            key={sighting.entry_id}
            style={{
              padding: "8px 0",
              borderBottom: "1px solid #f3f4f6",
              fontSize: "13px",
            }}
          >
            <p
              style={{
                margin: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {sighting.text_preview}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: "11px", color: "#9ca3af" }}>
              {sighting.location_normalized || sighting.location || "Unknown location"}
            </p>
          </div>
        ))}
      </div>

      {/* Action */}
      <div style={{ padding: "16px", borderTop: "1px solid #e5e7eb" }}>
        <button
          onClick={onCreateCat}
          style={{
            width: "100%",
            padding: "10px",
            backgroundColor: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          Create Cat from Group
        </button>
      </div>
    </div>
  );
}

// ===========================
// Main Component
// ===========================

export function SightingsMap({ entries, onEntryClick, onCreateCat }: SightingsMapProps) {
  // Default to NYC if no sightings with coordinates
  const defaultCenter: [number, number] = [40.7128, -74.006];

  // Find initial center from entries
  const initialCenter = useMemo(() => {
    const withCoords = entries.filter(
      (e) => e.location_lat !== null && e.location_lat !== undefined
    );
    if (withCoords.length === 0) return defaultCenter;
    const avgLat = withCoords.reduce((sum, e) => sum + (e.location_lat || 0), 0) / withCoords.length;
    const avgLon = withCoords.reduce((sum, e) => sum + (e.location_lon || 0), 0) / withCoords.length;
    return [avgLat, avgLon] as [number, number];
  }, [entries]);

  const [center, setCenter] = useState<[number, number]>(initialCenter);
  const [zoom, setZoom] = useState(13);
  const [showAssigned, setShowAssigned] = useState(true);
  const [showGroups, setShowGroups] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<SuggestedGroup | null>(null);

  // Area data
  const [areaData, setAreaData] = useState<AreaQueryResponse | null>(null);
  const [groupsData, setGroupsData] = useState<SuggestedGroupingsResponse | null>(null);
  const [loading, setLoading] = useState(false);


  // Fetch area sightings
  const fetchAreaSightings = useCallback(async () => {
    setLoading(true);
    try {
      const radius = getRadiusFromZoom(zoom);
      const data = await getEntriesByArea(center[0], center[1], radius, showAssigned);
      setAreaData(data);
    } catch (e: any) {
      console.error("Failed to fetch area sightings:", e);
    } finally {
      setLoading(false);
    }
  }, [center, zoom, showAssigned]);

  // Fetch suggested groups
  const fetchGroups = useCallback(async () => {
    if (!showGroups) {
      setGroupsData(null);
      return;
    }
    try {
      const radius = getRadiusFromZoom(zoom);
      const data = await getSuggestedGroupings(center[0], center[1], radius, 100, 2);
      setGroupsData(data);
    } catch (e: any) {
      console.error("Failed to fetch groups:", e);
    }
  }, [center, zoom, showGroups]);

  // Load data on center/zoom change
  useEffect(() => {
    fetchAreaSightings();
  }, [fetchAreaSightings]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  // Handle map move
  const handleMoveEnd = useCallback((newCenter: [number, number], newZoom: number) => {
    setCenter(newCenter);
    setZoom(newZoom);
  }, []);

  // Handle group click
  const handleGroupClick = (group: SuggestedGroup) => {
    setSelectedGroup(group);
  };

  // Handle create cat from group
  const handleCreateFromGroup = () => {
    if (selectedGroup) {
      onCreateCat(selectedGroup.entry_ids);
      setSelectedGroup(null);
    }
  };

  // Get sightings for selected group
  const groupSightings = useMemo(() => {
    if (!selectedGroup || !areaData) return [];
    return areaData.sightings.filter((s) => selectedGroup.entry_ids.includes(s.entry_id));
  }, [selectedGroup, areaData]);

  return (
    <div style={{ position: "relative", height: "500px", borderRadius: "12px", overflow: "hidden" }}>
      {/* Loading indicator */}
      {loading && (
        <div
          style={{
            position: "absolute",
            top: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: "#fff",
            padding: "8px 16px",
            borderRadius: "20px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            zIndex: 1000,
            fontSize: "13px",
          }}
        >
          Loading sightings...
        </div>
      )}

      {/* Controls */}
      <div
        style={{
          position: "absolute",
          top: "16px",
          left: "16px",
          backgroundColor: "#fff",
          padding: "12px",
          borderRadius: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          zIndex: 1000,
          fontSize: "13px",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
          <input
            type="checkbox"
            checked={showAssigned}
            onChange={(e) => setShowAssigned(e.target.checked)}
          />
          Show assigned
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="checkbox"
            checked={showGroups}
            onChange={(e) => setShowGroups(e.target.checked)}
          />
          Show suggested groups
        </label>
      </div>

      {/* Stats */}
      {areaData && (
        <div
          style={{
            position: "absolute",
            bottom: "16px",
            left: "16px",
            backgroundColor: "#fff",
            padding: "8px 12px",
            borderRadius: "8px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            zIndex: 1000,
            fontSize: "12px",
          }}
        >
          <span>{areaData.total_count} sightings</span>
          <span style={{ color: "#6b7280", marginLeft: "8px" }}>
            ({areaData.unassigned_count} unassigned)
          </span>
          {showGroups && groupsData && (
            <span style={{ color: "#3b82f6", marginLeft: "8px" }}>
              • {groupsData.groups.length} groups
            </span>
          )}
        </div>
      )}

      {/* Map */}
      <MapContainer
        center={initialCenter}
        zoom={zoom}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapEvents onMoveEnd={handleMoveEnd} />

        {/* Sighting markers */}
        {areaData?.sightings.map((sighting) => (
          <Marker
            key={sighting.entry_id}
            position={[sighting.latitude, sighting.longitude]}
            icon={sighting.cat_id ? assignedIcon : unassignedIcon}
            eventHandlers={{
              click: () => onEntryClick(sighting.entry_id),
            }}
          >
            <Popup>
              <div style={{ minWidth: "180px" }}>
                <p style={{ margin: "0 0 8px", fontSize: "14px" }}>{sighting.text_preview}</p>
                <p style={{ margin: 0, fontSize: "12px", color: "#6b7280" }}>
                  {sighting.location_normalized || sighting.location || "Unknown"}
                </p>
                {sighting.cat_name && (
                  <p
                    style={{
                      margin: "8px 0 0",
                      fontSize: "12px",
                      color: "#22c55e",
                      fontWeight: 500,
                    }}
                  >
                    Linked to: {sighting.cat_name}
                  </p>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Cluster circles */}
        {showGroups &&
          groupsData?.groups.map((group) => {
            const color = getClusterColor(group.confidence);
            const isSelected = selectedGroup?.group_id === group.group_id;

            return (
              <Circle
                key={group.group_id}
                center={[group.center_lat, group.center_lon]}
                radius={group.radius_meters}
                pathOptions={{
                  color: isSelected ? "#3b82f6" : color,
                  fillColor: color,
                  fillOpacity: 0.2,
                  weight: isSelected ? 3 : 2,
                }}
                eventHandlers={{
                  click: () => handleGroupClick(group),
                }}
              />
            );
          })}
      </MapContainer>

      {/* Group details panel */}
      {selectedGroup && (
        <GroupDetailsPanel
          group={selectedGroup}
          sightings={groupSightings}
          onClose={() => setSelectedGroup(null)}
          onCreateCat={handleCreateFromGroup}
        />
      )}
    </div>
  );
}

export default SightingsMap;
