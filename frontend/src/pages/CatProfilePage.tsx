/**
 * CatProfilePage Component
 * Dedicated page for viewing a cat's profile with aggregated stats
 */

import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useCatProfile } from "../hooks/useCatProfile";
import { CatHeader } from "../components/cat-profile/CatHeader";
import type { EnhancedCatProfile, CatUpdateResponse, PaginatedSighting } from "../api/endpoints";
import { getCatSightings } from "../api/endpoints";

type TabType = "overview" | "sightings" | "locations" | "photos" | "insights";

export function CatProfilePage() {
  const { catId } = useParams<{ catId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  // Parse and validate cat ID
  const numericCatId = parseInt(catId || "0", 10);

  // Handle invalid cat ID in URL
  if (isNaN(numericCatId) || numericCatId <= 0) {
    return (
      <div className="error-page">
        <h1>Invalid Cat ID</h1>
        <p>The cat ID "{catId}" is not valid.</p>
        <button onClick={() => navigate("/")}>Go to Home</button>
      </div>
    );
  }

  const { profile, loading, error, refetch } = useCatProfile(numericCatId);

  const handleNameUpdated = (_response: CatUpdateResponse) => {
    // Refetch the profile to get updated name
    refetch();
  };

  const handleBack = () => {
    navigate(-1);
  };

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/cats/${numericCatId}`;
    const catName = profile?.cat.name || `Cat #${numericCatId}`;

    // Try native share API first (mobile)
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${catName} - CatAtlas`,
          text: `Check out ${catName} on CatAtlas!`,
          url: shareUrl,
        });
        return;
      } catch {
        // User cancelled or API failed, fall back to clipboard
      }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareMessage("Link copied!");
      setTimeout(() => setShareMessage(null), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = shareUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setShareMessage("Link copied!");
      setTimeout(() => setShareMessage(null), 2000);
    }
  };

  // Loading state
  if (loading) {
    return <CatProfileSkeleton />;
  }

  // Error state
  if (error) {
    const isNotFound = error.details.statusCode === 404;
    return (
      <div className="error-page">
        <h1>{isNotFound ? "Cat Not Found" : "Error Loading Profile"}</h1>
        <p>
          {isNotFound
            ? `We couldn't find a cat with ID ${numericCatId}.`
            : error.message}
        </p>
        <div className="error-actions">
          <button onClick={() => navigate("/")}>Go to Home</button>
          {!isNotFound && <button onClick={refetch}>Try Again</button>}
        </div>
      </div>
    );
  }

  // No profile data
  if (!profile) {
    return (
      <div className="error-page">
        <h1>No Profile Data</h1>
        <p>Unable to load profile data for this cat.</p>
        <button onClick={() => navigate("/")}>Go to Home</button>
      </div>
    );
  }

  return (
    <div className="cat-profile-page">
      {shareMessage && <div className="share-toast">{shareMessage}</div>}

      <CatHeader
        profile={profile}
        onBack={handleBack}
        onShare={handleShare}
        onNameUpdated={handleNameUpdated}
      />

      <div className="cat-profile-tabs">
        <TabButton
          label="Overview"
          active={activeTab === "overview"}
          onClick={() => setActiveTab("overview")}
        />
        <TabButton
          label="Sightings"
          active={activeTab === "sightings"}
          onClick={() => setActiveTab("sightings")}
          count={profile.stats.totalSightings}
        />
        <TabButton
          label="Locations"
          active={activeTab === "locations"}
          onClick={() => setActiveTab("locations")}
          count={profile.stats.uniqueLocations}
        />
        <TabButton
          label="Photos"
          active={activeTab === "photos"}
          onClick={() => setActiveTab("photos")}
          count={profile.stats.photoCount}
        />
        <TabButton
          label="Insights"
          active={activeTab === "insights"}
          onClick={() => setActiveTab("insights")}
        />
      </div>

      <div className="cat-profile-content">
        {activeTab === "overview" && <OverviewTab profile={profile} />}
        {activeTab === "sightings" && <SightingsTab profile={profile} />}
        {activeTab === "locations" && <LocationsTab profile={profile} />}
        {activeTab === "photos" && <PhotosTab profile={profile} />}
        {activeTab === "insights" && <InsightsTab profile={profile} />}
      </div>
    </div>
  );
}

// Tab button component
function TabButton({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      className={`tab-button ${active ? "active" : ""}`}
      onClick={onClick}
    >
      {label}
      {count !== undefined && <span className="tab-count">({count})</span>}
    </button>
  );
}

// Loading skeleton
function CatProfileSkeleton() {
  return (
    <div className="cat-profile-skeleton">
      <div className="skeleton-header">
        <div className="skeleton-nav">
          <div className="skeleton-button" />
          <div className="skeleton-button" />
        </div>
        <div className="skeleton-content">
          <div className="skeleton-photo" />
          <div className="skeleton-info">
            <div className="skeleton-title" />
            <div className="skeleton-text" />
            <div className="skeleton-stats" />
          </div>
        </div>
      </div>
      <div className="skeleton-tabs" />
      <div className="skeleton-body" />
    </div>
  );
}

// Overview tab content
function OverviewTab({ profile }: { profile: EnhancedCatProfile }) {
  const hasLocations = profile.locationSummary.length > 0;
  const hasRecentSightings = profile.recentSightings.length > 0;
  const hasInsights =
    profile.insightStatus.hasProfile ||
    profile.insightStatus.hasCare ||
    profile.insightStatus.hasUpdate ||
    profile.insightStatus.hasRisk;

  return (
    <div className="overview-tab">
      {/* AI Profile Summary */}
      <section className="profile-section">
        <h2>About</h2>
        <p className="profile-text">{profile.profile_text}</p>
        {profile.top_tags.length > 0 && (
          <div className="tag-list">
            {profile.top_tags.map((tag, i) => (
              <span key={i} className="tag">
                {tag}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Recent Locations */}
      {hasLocations && (
        <section className="profile-section">
          <h2>Recent Locations</h2>
          <ul className="location-list">
            {profile.locationSummary.slice(0, 5).map((loc, i) => (
              <li key={i} className="location-item">
                <span className="location-name">{loc.location}</span>
                <span className="location-count">
                  {loc.count} sighting{loc.count !== 1 ? "s" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Recent Sightings Preview */}
      {hasRecentSightings && (
        <section className="profile-section">
          <h2>Recent Sightings</h2>
          <ul className="sighting-preview-list">
            {profile.recentSightings.slice(0, 3).map((sighting) => (
              <li key={sighting.id} className="sighting-preview-item">
                <p className="sighting-text">{sighting.text}</p>
                <div className="sighting-meta">
                  {sighting.location && (
                    <span className="sighting-location">{sighting.location}</span>
                  )}
                  <span className="sighting-date">
                    {new Date(sighting.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Insight Status */}
      {hasInsights && (
        <section className="profile-section">
          <h2>AI Insights</h2>
          <div className="insight-badges">
            {profile.insightStatus.hasProfile && (
              <span className="insight-badge">Profile Generated</span>
            )}
            {profile.insightStatus.hasCare && (
              <span className="insight-badge">Care Tips</span>
            )}
            {profile.insightStatus.hasUpdate && (
              <span className="insight-badge">Recent Update</span>
            )}
            {profile.insightStatus.hasRisk && (
              <span className="insight-badge warning">Risk Alert</span>
            )}
          </div>
          {profile.insightStatus.lastUpdated && (
            <p className="insight-update">
              Last updated:{" "}
              {new Date(profile.insightStatus.lastUpdated).toLocaleDateString()}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

// Sightings tab content with pagination
function SightingsTab({ profile }: { profile: EnhancedCatProfile }) {
  const [sightings, setSightings] = useState<PaginatedSighting[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const ITEMS_PER_PAGE = 10;

  // Fetch sightings when page changes
  const fetchSightings = async (pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await getCatSightings(profile.cat.id, pageNum, ITEMS_PER_PAGE);
      setSightings(response.sightings);
      setTotalPages(response.totalPages);
      setTotal(response.total);
      setPage(response.page);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to load sightings";
      setError(errorMessage);
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  };

  // Initial load
  if (!initialized && !loading) {
    fetchSightings(1);
  }

  if (profile.stats.totalSightings === 0) {
    return (
      <div className="empty-state">
        <p>No sightings recorded yet.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-state">
        <p>Error loading sightings: {error}</p>
        <button onClick={() => fetchSightings(page)}>Try Again</button>
      </div>
    );
  }

  return (
    <div className="sightings-tab">
      <p className="tab-description">
        Showing page {page} of {totalPages} ({total} total sightings)
      </p>

      {loading ? (
        <div className="loading-state">Loading sightings...</div>
      ) : (
        <>
          <div className="sightings-list">
            {sightings.map((sighting) => (
              <div key={sighting.id} className="sighting-card">
                <div className="sighting-header">
                  <div>
                    <span className="sighting-meta">
                      {new Date(sighting.createdAt).toLocaleString()}
                    </span>
                    {sighting.nickname && (
                      <span className="sighting-nickname"> - {sighting.nickname}</span>
                    )}
                  </div>
                  {sighting.isFavorite && (
                    <span className="sighting-favorite">Favorite</span>
                  )}
                </div>
                {sighting.location && (
                  <p className="sighting-location">&#128205; {sighting.location}</p>
                )}
                <p className="sighting-text">{sighting.text}</p>
                {sighting.photo_url && (
                  <img
                    src={sighting.photo_url}
                    alt="Sighting"
                    className="sighting-photo"
                  />
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination-controls">
              <button
                className="pagination-btn"
                onClick={() => fetchSightings(page - 1)}
                disabled={page <= 1 || loading}
              >
                Previous
              </button>
              <span className="pagination-info">
                Page {page} of {totalPages}
              </span>
              <button
                className="pagination-btn"
                onClick={() => fetchSightings(page + 1)}
                disabled={page >= totalPages || loading}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Locations tab content
function LocationsTab({ profile }: { profile: EnhancedCatProfile }) {
  if (profile.locationSummary.length === 0) {
    return (
      <div className="empty-state">
        <p>No location data available.</p>
      </div>
    );
  }

  return (
    <div className="locations-tab">
      <ul className="location-detailed-list">
        {profile.locationSummary.map((loc, i) => (
          <li key={i} className="location-detailed-item">
            <div className="location-header">
              <h3 className="location-name">{loc.location}</h3>
              <span className="location-count">
                {loc.count} sighting{loc.count !== 1 ? "s" : ""}
              </span>
            </div>
            {loc.normalizedLocation && loc.normalizedLocation !== loc.location && (
              <p className="location-normalized">{loc.normalizedLocation}</p>
            )}
            <p className="location-last-seen">
              Last seen: {new Date(loc.lastSeen).toLocaleDateString()}
            </p>
            {loc.lat && loc.lon && (
              <p className="location-coords">
                Coordinates: {loc.lat.toFixed(4)}, {loc.lon.toFixed(4)}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Photos tab content
function PhotosTab({ profile }: { profile: EnhancedCatProfile }) {
  const photos = profile.recentSightings.filter((s) => s.photo_url);

  if (photos.length === 0) {
    return (
      <div className="empty-state">
        <p>No photos available yet.</p>
      </div>
    );
  }

  return (
    <div className="photos-tab">
      <p className="tab-description">
        Showing {photos.length} of {profile.stats.photoCount} photos.
      </p>
      <div className="photo-grid">
        {photos.map((sighting) => (
          <div key={sighting.id} className="photo-item">
            <img
              src={sighting.photo_url!}
              alt={`Sighting on ${new Date(sighting.createdAt).toLocaleDateString()}`}
              className="grid-photo"
            />
            <div className="photo-overlay">
              <span className="photo-date">
                {new Date(sighting.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Insights tab content
function InsightsTab({ profile }: { profile: EnhancedCatProfile }) {
  const { insightStatus } = profile;
  const hasAnyInsight =
    insightStatus.hasProfile ||
    insightStatus.hasCare ||
    insightStatus.hasUpdate ||
    insightStatus.hasRisk;

  if (!hasAnyInsight) {
    return (
      <div className="empty-state">
        <p>No AI insights generated yet.</p>
        <p className="hint">
          Generate insights from the cat's profile to get care recommendations
          and updates.
        </p>
      </div>
    );
  }

  return (
    <div className="insights-tab">
      <p className="tab-description">
        AI-generated insights based on {profile.stats.totalSightings} sightings.
      </p>

      <div className="insight-summary">
        <h3>Temperament</h3>
        <p className="temperament">{profile.temperament_guess}</p>
      </div>

      <div className="insight-status-grid">
        <InsightStatusCard
          title="Profile"
          available={insightStatus.hasProfile}
          description="General profile and personality based on sightings"
        />
        <InsightStatusCard
          title="Care Tips"
          available={insightStatus.hasCare}
          description="Recommendations for caring and feeding"
        />
        <InsightStatusCard
          title="Activity Update"
          available={insightStatus.hasUpdate}
          description="Recent activity and behavior changes"
        />
        <InsightStatusCard
          title="Risk Assessment"
          available={insightStatus.hasRisk}
          description="Health or safety concerns to watch for"
        />
      </div>

      {insightStatus.lastUpdated && (
        <p className="last-updated">
          Last insight generated:{" "}
          {new Date(insightStatus.lastUpdated).toLocaleString()}
        </p>
      )}
    </div>
  );
}

function InsightStatusCard({
  title,
  available,
  description,
}: {
  title: string;
  available: boolean;
  description: string;
}) {
  return (
    <div className={`insight-status-card ${available ? "available" : "pending"}`}>
      <h4>{title}</h4>
      <p>{description}</p>
      <span className="status-indicator">
        {available ? "Available" : "Not generated"}
      </span>
    </div>
  );
}
