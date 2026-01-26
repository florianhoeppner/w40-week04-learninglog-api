/**
 * useMutation Hook
 * React hook for data mutations (POST, PUT, DELETE) with loading and error states
 */

import { useCallback, useRef, useState } from "react";
import { ApiError } from "../types/errors";

export interface UseMutationOptions<TData, TVariables> {
  /** Callback on success */
  onSuccess?: (data: TData, variables: TVariables) => void;
  /** Callback on error */
  onError?: (error: ApiError, variables: TVariables) => void;
  /** Callback before mutation starts */
  onMutate?: (variables: TVariables) => void;
  /** Callback when mutation completes (success or error) */
  onSettled?: (data: TData | null, error: ApiError | null, variables: TVariables) => void;
}

export interface UseMutationResult<TData, TVariables> {
  /** The mutation response data */
  data: TData | null;
  /** Whether the mutation is in progress */
  loading: boolean;
  /** Error if mutation failed */
  error: ApiError | null;
  /** Execute the mutation */
  mutate: (variables: TVariables) => Promise<TData>;
  /** Execute the mutation (async) */
  mutateAsync: (variables: TVariables) => Promise<TData>;
  /** Reset mutation state */
  reset: () => void;
  /** Clear error state */
  clearError: () => void;
}

/**
 * Hook for mutations with built-in state management
 */
export function useMutation<TData = unknown, TVariables = void>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: UseMutationOptions<TData, TVariables> = {}
): UseMutationResult<TData, TVariables> {
  const { onSuccess, onError, onMutate, onSettled } = options;

  const [data, setData] = useState<TData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);

  const mutateAsync = useCallback(
    async (variables: TVariables): Promise<TData> => {
      if (!isMountedRef.current) {
        throw new Error("Cannot mutate after component unmounted");
      }

      setLoading(true);
      setError(null);

      // Call onMutate before mutation starts
      onMutate?.(variables);

      try {
        const result = await mutationFn(variables);

        if (isMountedRef.current) {
          setData(result);
          setLoading(false);
          onSuccess?.(result, variables);
          onSettled?.(result, null, variables);
        }

        return result;
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError({
          message: err instanceof Error ? err.message : "Unknown error",
          type: "UNKNOWN_ERROR" as any,
          timestamp: new Date().toISOString(),
          retryable: false,
        });

        if (isMountedRef.current) {
          setError(apiError);
          setLoading(false);
          onError?.(apiError, variables);
          onSettled?.(null, apiError, variables);
        }

        throw apiError;
      }
    },
    [mutationFn, onSuccess, onError, onMutate, onSettled]
  );

  const mutate = useCallback(
    (variables: TVariables) => {
      mutateAsync(variables).catch(() => {
        // Error already handled in mutateAsync
      });
      // Return promise but don't expose errors (they're in state)
      return mutateAsync(variables);
    },
    [mutateAsync]
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Cleanup on unmount
  useRef(() => {
    return () => {
      isMountedRef.current = false;
    };
  });

  return {
    data,
    loading,
    error,
    mutate,
    mutateAsync,
    reset,
    clearError,
  };
}

/**
 * Helper hook for simple mutations that don't need variables
 */
export function useSimpleMutation<TData>(
  mutationFn: () => Promise<TData>,
  options?: UseMutationOptions<TData, void>
): Omit<UseMutationResult<TData, void>, "mutate" | "mutateAsync"> & {
  mutate: () => Promise<TData>;
  mutateAsync: () => Promise<TData>;
} {
  return useMutation<TData, void>(mutationFn, options);
}
