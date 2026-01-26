/**
 * useApi Hook
 * React hook for fetching data with loading, error, and retry states
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../types/errors";

export interface UseApiOptions<T> {
  /** Initial data value */
  initialData?: T;
  /** Whether to fetch on mount (default: true) */
  fetchOnMount?: boolean;
  /** Callback on success */
  onSuccess?: (data: T) => void;
  /** Callback on error */
  onError?: (error: ApiError) => void;
  /** Dependencies to trigger refetch */
  deps?: unknown[];
}

export interface UseApiResult<T> {
  /** The fetched data */
  data: T | null;
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
 * Hook for data fetching with built-in state management
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  options: UseApiOptions<T> = {}
): UseApiResult<T> {
  const {
    initialData = null,
    fetchOnMount = true,
    onSuccess,
    onError,
    deps = [],
  } = options;

  const [data, setData] = useState<T | null>(initialData as T | null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);

  // Track current request to prevent race conditions
  const requestIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    const currentRequestId = ++requestIdRef.current;

    setLoading(true);
    setError(null);

    try {
      const result = await fetcher();

      // Only update state if this is still the latest request and component is mounted
      if (currentRequestId === requestIdRef.current && isMountedRef.current) {
        setData(result);
        setLoading(false);
        onSuccess?.(result);
      }
    } catch (err) {
      // Only update state if this is still the latest request and component is mounted
      if (currentRequestId === requestIdRef.current && isMountedRef.current) {
        const apiError = err instanceof ApiError ? err : new ApiError({
          message: err instanceof Error ? err.message : "Unknown error",
          type: "UNKNOWN_ERROR" as any,
          timestamp: new Date().toISOString(),
          retryable: false,
        });

        setError(apiError);
        setLoading(false);
        onError?.(apiError);
      }
    }
  }, [fetcher, onSuccess, onError]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    if (fetchOnMount) {
      fetchData();
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchOnMount, ...deps]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
    clearError,
  };
}

/**
 * Simplified version that always fetches on mount
 */
export function useFetch<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = []
): UseApiResult<T> {
  return useApi(fetcher, { fetchOnMount: true, deps });
}

/**
 * Version that doesn't fetch on mount (for lazy loading)
 */
export function useLazyApi<T>(
  fetcher: () => Promise<T>
): Omit<UseApiResult<T>, "refetch"> & { fetch: () => Promise<void> } {
  const result = useApi(fetcher, { fetchOnMount: false });

  return {
    ...result,
    fetch: result.refetch,
  };
}
