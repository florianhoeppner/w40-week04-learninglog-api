/**
 * useCatProfile Hook
 * React hook for fetching enhanced cat profile data
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getEnhancedCatProfile, type EnhancedCatProfile } from "../api/endpoints";
import { ApiError } from "../types/errors";

export interface UseCatProfileResult {
  /** The cat profile data */
  profile: EnhancedCatProfile | null;
  /** Whether the request is in progress */
  loading: boolean;
  /** Error if request failed */
  error: ApiError | null;
  /** Manually trigger a refetch */
  refetch: () => Promise<void>;
  /** Reset error state */
  clearError: () => void;
}

/**
 * Hook for fetching enhanced cat profile data
 * @param catId The cat ID to fetch profile for
 */
export function useCatProfile(catId: number): UseCatProfileResult {
  const [profile, setProfile] = useState<EnhancedCatProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);

  // Track current request to prevent race conditions
  const requestIdRef = useRef(0);

  const fetchProfile = useCallback(async () => {
    const currentRequestId = ++requestIdRef.current;

    setLoading(true);
    setError(null);

    try {
      const result = await getEnhancedCatProfile(catId);

      // Only update state if this is still the latest request and component is mounted
      if (currentRequestId === requestIdRef.current && isMountedRef.current) {
        setProfile(result);
        setLoading(false);
      }
    } catch (err) {
      // Only update state if this is still the latest request and component is mounted
      if (currentRequestId === requestIdRef.current && isMountedRef.current) {
        const apiError =
          err instanceof ApiError
            ? err
            : new ApiError({
                message: err instanceof Error ? err.message : "Unknown error",
                type: "UNKNOWN_ERROR" as any,
                timestamp: new Date().toISOString(),
                retryable: false,
              });

        setError(apiError);
        setLoading(false);
      }
    }
  }, [catId]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Fetch on mount and when catId changes
  useEffect(() => {
    isMountedRef.current = true;
    fetchProfile();

    return () => {
      isMountedRef.current = false;
    };
  }, [catId, fetchProfile]);

  return {
    profile,
    loading,
    error,
    refetch: fetchProfile,
    clearError,
  };
}
