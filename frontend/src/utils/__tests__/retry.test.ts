/**
 * Tests for Retry Utility
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { retry } from "../retry";
import { ApiError, ErrorType } from "../../types/errors";

describe("Retry Utility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should succeed on first attempt", async () => {
    const operation = vi.fn().mockResolvedValue("success");

    const result = await retry(operation);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should retry on retryable error", async () => {
    const error = new ApiError({
      message: "Server error",
      type: ErrorType.SERVER_ERROR,
      timestamp: new Date().toISOString(),
      retryable: true,
    });

    const operation = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue("success");

    const promise = retry(operation, { maxAttempts: 3 });

    // Fast-forward through retries
    await vi.runAllTimersAsync();

    const result = await promise;

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("should not retry non-ApiError", async () => {
    const error = new Error("Generic error");
    const operation = vi.fn().mockRejectedValue(error);

    await expect(retry(operation)).rejects.toThrow(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should not retry non-retryable error", async () => {
    const error = new ApiError({
      message: "Validation error",
      type: ErrorType.VALIDATION_ERROR,
      timestamp: new Date().toISOString(),
      retryable: false,
    });

    const operation = vi.fn().mockRejectedValue(error);

    await expect(retry(operation)).rejects.toThrow(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should throw MAX_RETRIES_EXCEEDED after max attempts", async () => {
    const error = new ApiError({
      message: "Server error",
      type: ErrorType.SERVER_ERROR,
      timestamp: new Date().toISOString(),
      retryable: true,
    });

    const operation = vi.fn().mockRejectedValue(error);

    const promise = retry(operation, { maxAttempts: 3 });

    await vi.runAllTimersAsync();

    await expect(promise).rejects.toMatchObject({
      details: {
        type: ErrorType.MAX_RETRIES_EXCEEDED,
      },
    });

    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("should call onRetry callback", async () => {
    const error = new ApiError({
      message: "Server error",
      type: ErrorType.SERVER_ERROR,
      timestamp: new Date().toISOString(),
      retryable: true,
    });

    const operation = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("success");

    const onRetry = vi.fn();

    const promise = retry(operation, { maxAttempts: 3, onRetry });

    await vi.runAllTimersAsync();

    await promise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(
      error,
      1,
      expect.any(Number)
    );
  });

  it("should use custom shouldRetry function", async () => {
    const error = new ApiError({
      message: "Server error",
      type: ErrorType.SERVER_ERROR,
      timestamp: new Date().toISOString(),
      retryable: true,
    });

    const operation = vi.fn().mockRejectedValue(error);
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(
      retry(operation, { shouldRetry })
    ).rejects.toThrow(error);

    expect(shouldRetry).toHaveBeenCalledWith(error, 0);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should respect maxDelayMs cap", async () => {
    const error = new ApiError({
      message: "Server error",
      type: ErrorType.SERVER_ERROR,
      timestamp: new Date().toISOString(),
      retryable: true,
    });

    const operation = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("success");

    const onRetry = vi.fn();

    const promise = retry(operation, {
      maxAttempts: 3,
      initialDelayMs: 5000,
      maxDelayMs: 6000,
      backoffMultiplier: 10,
      onRetry,
    });

    await vi.runAllTimersAsync();

    await promise;

    // Delay should be capped at maxDelayMs (6000) + jitter
    const delayMs = onRetry.mock.calls[0][2];
    expect(delayMs).toBeLessThanOrEqual(6000 * 1.25); // Max + 25% jitter
  });
});
