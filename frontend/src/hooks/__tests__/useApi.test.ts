/**
 * Tests for useApi and useMutation hooks
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useApi } from "../useApi";
import { useMutation } from "../useMutation";
import { ApiError, ErrorType } from "../../types/errors";

describe("useApi Hook", () => {
  it("should fetch data on mount", async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 1, name: "Test" });

    const { result } = renderHook(() => useApi(fetcher));

    // Initially loading
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    // Wait for data to load
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual({ id: 1, name: "Test" });
    expect(result.current.error).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("should handle errors", async () => {
    const error = new ApiError({
      message: "Test error",
      type: ErrorType.SERVER_ERROR,
      timestamp: new Date().toISOString(),
      retryable: false,
    });

    const fetcher = vi.fn().mockRejectedValue(error);

    const { result } = renderHook(() => useApi(fetcher));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toEqual(error);
  });

  it("should not fetch on mount when fetchOnMount=false", async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 1 });

    const { result } = renderHook(() =>
      useApi(fetcher, { fetchOnMount: false })
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("should refetch when refetch is called", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 });

    const { result } = renderHook(() => useApi(fetcher));

    await waitFor(() => {
      expect(result.current.data).toEqual({ id: 1 });
    });

    // Trigger refetch
    await result.current.refetch();

    await waitFor(() => {
      expect(result.current.data).toEqual({ id: 2 });
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("should call onSuccess callback", async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 1 });
    const onSuccess = vi.fn();

    renderHook(() => useApi(fetcher, { onSuccess }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({ id: 1 });
    });
  });

  it("should call onError callback", async () => {
    const error = new ApiError({
      message: "Test error",
      type: ErrorType.SERVER_ERROR,
      timestamp: new Date().toISOString(),
      retryable: false,
    });

    const fetcher = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();

    renderHook(() => useApi(fetcher, { onError }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(error);
    });
  });

  it("should use initialData", () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 2 });
    const initialData = { id: 1 };

    const { result } = renderHook(() =>
      useApi(fetcher, { initialData })
    );

    expect(result.current.data).toEqual(initialData);
  });

  it("should clear error", async () => {
    const error = new ApiError({
      message: "Test error",
      type: ErrorType.SERVER_ERROR,
      timestamp: new Date().toISOString(),
      retryable: false,
    });

    const fetcher = vi.fn().mockRejectedValue(error);

    const { result } = renderHook(() => useApi(fetcher));

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });

    result.current.clearError();

    expect(result.current.error).toBeNull();
  });
});

describe("useMutation Hook", () => {
  it("should execute mutation successfully", async () => {
    const mutationFn = vi.fn().mockResolvedValue({ id: 1, name: "Created" });

    const { result } = renderHook(() => useMutation(mutationFn));

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();

    // Execute mutation
    const promise = result.current.mutateAsync({ name: "Test" });

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const data = await promise;

    expect(data).toEqual({ id: 1, name: "Created" });
    expect(result.current.data).toEqual({ id: 1, name: "Created" });
    expect(result.current.error).toBeNull();
    expect(mutationFn).toHaveBeenCalledWith({ name: "Test" });
  });

  it("should handle mutation errors", async () => {
    const error = new ApiError({
      message: "Mutation failed",
      type: ErrorType.BAD_REQUEST,
      timestamp: new Date().toISOString(),
      retryable: false,
    });

    const mutationFn = vi.fn().mockRejectedValue(error);

    const { result } = renderHook(() => useMutation(mutationFn));

    await expect(result.current.mutateAsync({})).rejects.toThrow(error);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toEqual(error);
    expect(result.current.data).toBeNull();
  });

  it("should call lifecycle callbacks", async () => {
    const mutationFn = vi.fn().mockResolvedValue({ id: 1 });
    const onMutate = vi.fn();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();

    const { result } = renderHook(() =>
      useMutation(mutationFn, {
        onMutate,
        onSuccess,
        onError,
        onSettled,
      })
    );

    await result.current.mutateAsync({ test: true });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });

    expect(onMutate).toHaveBeenCalledWith({ test: true });
    expect(onSuccess).toHaveBeenCalledWith({ id: 1 }, { test: true });
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledWith({ id: 1 }, null, { test: true });
  });

  it("should call onError and onSettled on failure", async () => {
    const error = new ApiError({
      message: "Failed",
      type: ErrorType.SERVER_ERROR,
      timestamp: new Date().toISOString(),
      retryable: false,
    });

    const mutationFn = vi.fn().mockRejectedValue(error);
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();

    const { result } = renderHook(() =>
      useMutation(mutationFn, { onSuccess, onError, onSettled })
    );

    await expect(result.current.mutateAsync({})).rejects.toThrow();

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(error, {});
    expect(onSettled).toHaveBeenCalledWith(null, error, {});
  });

  it("should reset mutation state", async () => {
    const mutationFn = vi.fn().mockResolvedValue({ id: 1 });

    const { result } = renderHook(() => useMutation(mutationFn));

    await result.current.mutateAsync({});

    await waitFor(() => {
      expect(result.current.data).toBeTruthy();
    });

    result.current.reset();

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("should clear error", async () => {
    const error = new ApiError({
      message: "Failed",
      type: ErrorType.SERVER_ERROR,
      timestamp: new Date().toISOString(),
      retryable: false,
    });

    const mutationFn = vi.fn().mockRejectedValue(error);

    const { result } = renderHook(() => useMutation(mutationFn));

    await expect(result.current.mutateAsync({})).rejects.toThrow();

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });

    result.current.clearError();

    expect(result.current.error).toBeNull();
  });
});
