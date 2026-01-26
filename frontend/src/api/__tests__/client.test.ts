/**
 * Tests for API Client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { get, post, put, del, patch, resetCircuitBreaker } from "../client";
import { mockFetchResponse, mockNetworkError } from "../../test/setup";
import { ErrorType } from "../../types/errors";

describe("API Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCircuitBreaker();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("GET requests", () => {
    it("should make successful GET request", async () => {
      const mockData = { id: 1, name: "Test" };
      mockFetchResponse(mockData);

      const result = await get("/test");

      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8000/test",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("should handle 404 errors", async () => {
      mockFetchResponse({ error: "Not found" }, 404, false);

      await expect(get("/test")).rejects.toMatchObject({
        details: {
          type: ErrorType.NOT_FOUND,
          statusCode: 404,
        },
      });
    });

    it("should retry on 500 errors", async () => {
      // Fail twice, then succeed
      mockFetchResponse({ error: "Server error" }, 500, false);
      mockFetchResponse({ error: "Server error" }, 500, false);
      mockFetchResponse({ id: 1 });

      const promise = get("/test", { retry: { maxAttempts: 3 } });

      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result).toEqual({ id: 1 });
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("should not retry on 400 errors", async () => {
      mockFetchResponse({ error: "Bad request" }, 400, false);

      await expect(get("/test")).rejects.toMatchObject({
        details: {
          type: ErrorType.BAD_REQUEST,
          statusCode: 400,
        },
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST requests", () => {
    it("should make successful POST request with body", async () => {
      const payload = { name: "Test" };
      const mockData = { id: 1, ...payload };
      mockFetchResponse(mockData);

      const result = await post("/test", payload);

      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8000/test",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(payload),
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("should handle POST without body", async () => {
      mockFetchResponse({ success: true });

      const result = await post("/test");

      expect(result).toEqual({ success: true });
    });
  });

  describe("PUT requests", () => {
    it("should make successful PUT request", async () => {
      const payload = { name: "Updated" };
      const mockData = { id: 1, ...payload };
      mockFetchResponse(mockData);

      const result = await put("/test/1", payload);

      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8000/test/1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify(payload),
        })
      );
    });
  });

  describe("DELETE requests", () => {
    it("should make successful DELETE request", async () => {
      mockFetchResponse({ success: true });

      const result = await del("/test/1");

      expect(result).toEqual({ success: true });
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8000/test/1",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  describe("PATCH requests", () => {
    it("should make successful PATCH request", async () => {
      const payload = { name: "Patched" };
      mockFetchResponse({ success: true });

      const result = await patch("/test/1", payload);

      expect(result).toEqual({ success: true });
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8000/test/1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify(payload),
        })
      );
    });
  });

  describe("Error handling", () => {
    it("should handle network errors", async () => {
      mockNetworkError();

      await expect(get("/test")).rejects.toMatchObject({
        details: {
          type: ErrorType.NETWORK_ERROR,
        },
      });
    });

    it("should handle timeout", async () => {
      // Mock a slow response
      (global.fetch as any).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ ok: true, json: async () => ({}) }), 60000);
          })
      );

      const promise = get("/test", { timeout: 1000 });

      await vi.advanceTimersByTimeAsync(1100);

      await expect(promise).rejects.toMatchObject({
        details: {
          type: ErrorType.TIMEOUT_ERROR,
        },
      });
    });
  });

  describe("Retry configuration", () => {
    it("should disable retry when retry=false", async () => {
      mockFetchResponse({ error: "Server error" }, 500, false);

      await expect(get("/test", { retry: false })).rejects.toMatchObject({
        details: {
          type: ErrorType.SERVER_ERROR,
        },
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("should use custom retry options", async () => {
      mockFetchResponse({ error: "Server error" }, 500, false);
      mockFetchResponse({ error: "Server error" }, 500, false);
      mockFetchResponse({ error: "Server error" }, 500, false);
      mockFetchResponse({ error: "Server error" }, 500, false);
      mockFetchResponse({ error: "Server error" }, 500, false);

      const promise = get("/test", {
        retry: {
          maxAttempts: 5,
          initialDelayMs: 100,
        },
      });

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toMatchObject({
        details: {
          type: ErrorType.MAX_RETRIES_EXCEEDED,
        },
      });

      expect(global.fetch).toHaveBeenCalledTimes(5);
    });
  });

  describe("Circuit breaker", () => {
    it("should open circuit after failures", async () => {
      // Fail 5 times to open circuit
      for (let i = 0; i < 5; i++) {
        mockFetchResponse({ error: "Server error" }, 500, false);
      }

      for (let i = 0; i < 5; i++) {
        const promise = get("/test", { retry: false });
        await vi.runAllTimersAsync();
        await promise.catch(() => {});
      }

      // Next request should fail immediately with circuit breaker open
      await expect(get("/test", { retry: false })).rejects.toMatchObject({
        details: {
          type: ErrorType.CIRCUIT_BREAKER_OPEN,
        },
      });

      // Circuit breaker prevented the request
      expect(global.fetch).toHaveBeenCalledTimes(5);
    });

    it("should respect useCircuitBreaker=false", async () => {
      mockFetchResponse({ error: "Server error" }, 500, false);

      await expect(
        get("/test", { retry: false, useCircuitBreaker: false })
      ).rejects.toMatchObject({
        details: {
          type: ErrorType.SERVER_ERROR,
        },
      });
    });
  });
});
