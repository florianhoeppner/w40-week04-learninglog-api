/**
 * Tests for Timeout Utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withTimeout, fetchWithTimeout } from "../timeout";
import { ApiError, ErrorType } from "../../types/errors";

describe("Timeout Utility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should complete operation within timeout", async () => {
    const operation = vi.fn(async (signal) => {
      return "success";
    });

    const promise = withTimeout(operation, { timeoutMs: 5000 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("should abort on timeout", async () => {
    const operation = vi.fn(async (signal) => {
      // Simulate slow operation
      await new Promise((resolve) => setTimeout(resolve, 10000));
      return "success";
    });

    const promise = withTimeout(operation, { timeoutMs: 1000 });

    // Fast-forward past timeout
    await vi.advanceTimersByTimeAsync(1100);

    await expect(promise).rejects.toMatchObject({
      details: {
        type: ErrorType.TIMEOUT_ERROR,
        message: expect.stringContaining("timed out after 1000ms"),
      },
    });
  });

  it("should call onTimeout callback", async () => {
    const operation = vi.fn(async (signal) => {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      return "success";
    });

    const onTimeout = vi.fn();

    const promise = withTimeout(operation, { timeoutMs: 1000, onTimeout });

    await vi.advanceTimersByTimeAsync(1100);

    await expect(promise).rejects.toThrow();

    expect(onTimeout).toHaveBeenCalled();
  });

  it("should respect external abort signal", async () => {
    const externalController = new AbortController();
    const operation = vi.fn(async (signal) => {
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("Aborted")));
        setTimeout(() => resolve("success"), 5000);
      });
    });

    const promise = withTimeout(operation, {
      timeoutMs: 10000,
      abortSignal: externalController.signal,
    });

    // Abort externally before timeout
    externalController.abort();
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow("Aborted");
  });

  it("should cleanup timer on success", async () => {
    const operation = vi.fn(async (signal) => "success");

    const result = await withTimeout(operation, { timeoutMs: 5000 });

    expect(result).toBe("success");

    // Timer should be cleared
    expect(vi.getTimerCount()).toBe(0);
  });

  it("should cleanup timer on error", async () => {
    const error = new Error("Operation failed");
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withTimeout(operation, { timeoutMs: 5000 })).rejects.toThrow(
      error
    );

    // Timer should be cleared
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Circuit Breaker", () => {
  it("should transition to OPEN after threshold failures", async () => {
    const { CircuitBreaker } = await import("../circuitBreaker");
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    const failingOp = vi.fn().mockRejectedValue(new Error("Fail"));

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failingOp)).rejects.toThrow();
    }

    expect(breaker.getState()).toBe("OPEN");
  });

  it("should reject immediately when OPEN", async () => {
    const { CircuitBreaker } = await import("../circuitBreaker");
    const breaker = new CircuitBreaker({ failureThreshold: 2, timeout: 60000 });

    const failingOp = vi.fn().mockRejectedValue(new Error("Fail"));

    // Fail twice to open circuit
    await expect(breaker.execute(failingOp)).rejects.toThrow();
    await expect(breaker.execute(failingOp)).rejects.toThrow();

    expect(breaker.getState()).toBe("OPEN");

    // Should reject without calling operation
    await expect(breaker.execute(failingOp)).rejects.toMatchObject({
      details: {
        type: ErrorType.CIRCUIT_BREAKER_OPEN,
      },
    });

    expect(failingOp).toHaveBeenCalledTimes(2); // Not called the third time
  });

  it("should reset failure count on success when CLOSED", async () => {
    const { CircuitBreaker } = await import("../circuitBreaker");
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("Fail"))
      .mockResolvedValue("success");

    await expect(breaker.execute(operation)).rejects.toThrow();
    await expect(breaker.execute(operation)).resolves.toBe("success");

    // Failure count should be reset
    const stats = breaker.getStats();
    expect(stats.failureCount).toBe(0);
  });
});
