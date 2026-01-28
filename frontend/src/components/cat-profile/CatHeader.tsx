/**
 * CatHeader Component
 * Displays cat name, photo, and quick stats in the profile header
 */

import { type EnhancedCatProfile, type CatUpdateResponse } from "../../api/endpoints";
import { EditableCatName } from "./EditableCatName";

interface CatHeaderProps {
  profile: EnhancedCatProfile;
  onBack: () => void;
  onShare: () => void;
  onNameUpdated?: (response: CatUpdateResponse) => void;
}

export function CatHeader({ profile, onBack, onShare, onNameUpdated }: CatHeaderProps) {
  const { cat, stats } = profile;
  const catName = cat.name || `Cat #${cat.id}`;

  // Format date for display
  const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return "Unknown";
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "Unknown";
    }
  };

  return (
    <div className="cat-header">
      <div className="cat-header-nav">
        <button onClick={onBack} className="back-button" aria-label="Go back">
          &larr; Back
        </button>
        <button onClick={onShare} className="share-button" aria-label="Share profile">
          Share
        </button>
      </div>

      <div className="cat-header-content">
        <div className="cat-photo-container">
          {cat.primaryPhoto ? (
            <img
              src={cat.primaryPhoto}
              alt={catName}
              className="cat-photo"
            />
          ) : (
            <div className="cat-photo-placeholder" data-testid="photo-placeholder">
              <span className="cat-icon">&#128049;</span>
            </div>
          )}
        </div>

        <div className="cat-info">
          <EditableCatName
            catId={cat.id}
            initialName={cat.name}
            onNameUpdated={onNameUpdated}
          />
          <p className="cat-meta">
            First seen: {formatDate(stats.firstSeen || cat.createdAt)}
          </p>

          <div className="cat-stats-row">
            <span className="stat-item">
              <strong>{stats.totalSightings}</strong> sightings
            </span>
            <span className="stat-separator">&middot;</span>
            <span className="stat-item">
              <strong>{stats.uniqueLocations}</strong> locations
            </span>
            <span className="stat-separator">&middot;</span>
            <span className="stat-item">
              <strong>{stats.photoCount}</strong> photos
            </span>
          </div>

          {stats.mostFrequentLocation && (
            <p className="cat-location-hint">
              Most often seen at: <strong>{stats.mostFrequentLocation}</strong>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
