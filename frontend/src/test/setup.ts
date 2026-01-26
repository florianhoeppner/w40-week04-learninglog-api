/**
 * Vitest Test Setup
 * Global test configuration and mocks
 */

import { expect, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock environment variables
vi.stubEnv("VITE_API_BASE", "http://localhost:8000");
vi.stubEnv("VITE_APP_NAME", "CatAtlas");
vi.stubEnv("VITE_APP_VERSION", "1.0.0");

// Mock fetch globally
global.fetch = vi.fn();

// Helper to mock fetch responses
export function mockFetchResponse(data: unknown, status = 200, ok = true) {
  (global.fetch as any).mockResolvedValueOnce({
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers(),
  });
}

// Helper to mock fetch errors
export function mockFetchError(error: Error) {
  (global.fetch as any).mockRejectedValueOnce(error);
}

// Helper to mock network error
export function mockNetworkError() {
  mockFetchError(new TypeError("Failed to fetch"));
}

// Helper to mock timeout
export function mockTimeout() {
  const error = new Error("AbortError");
  error.name = "AbortError";
  mockFetchError(error);
}

// Reset fetch mock before each test
afterEach(() => {
  vi.clearAllMocks();
});
