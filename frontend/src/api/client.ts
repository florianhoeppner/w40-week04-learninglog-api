/**
 * API Client for CatAtlas
 * Centralized HTTP client with error handling, retry, timeout, and circuit breaker
 */

import { ApiError } from "../types/errors";
import { handleHttpError, handleNetworkError, logError } from "../utils/errors";
import { retry, type RetryOptions } from "../utils/retry";
import { withTimeout } from "../utils/timeout";
import { createCircuitBreaker } from "../utils/circuitBreaker";

// Get API base URL from environment
const API_BASE = import.meta.env.VITE_API_BASE;
if (!API_BASE) {
  throw new Error("VITE_API_BASE environment variable is not set");
}

export interface RequestConfig {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  retry?: boolean | RetryOptions;
  useCircuitBreaker?: boolean;
}

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
};

// Global circuit breaker for the API
const apiCircuitBreaker = createCircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000, // 1 minute
  onStateChange: (oldState, newState) => {
    console.warn(`[Circuit Breaker] State changed: ${oldState} -> ${newState}`);
  },
});

/**
 * Core request function with all resiliency patterns
 */
async function makeRequest(
  endpoint: string,
  config: RequestConfig = {}
): Promise<Response> {
  const {
    method = "GET",
    body,
    headers = {},
    timeout = DEFAULT_TIMEOUT,
    retry: retryConfig = true,
    useCircuitBreaker = true,
  } = config;

  const url = `${API_BASE}${endpoint}`;

  // Build fetch request init
  const requestInit: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };

  if (body) {
    requestInit.body = JSON.stringify(body);
  }

  // Create the fetch operation
  const fetchOperation = async (signal: AbortSignal): Promise<Response> => {
    const response = await fetch(url, { ...requestInit, signal });

    if (!response.ok) {
      throw await handleHttpError(response, endpoint);
    }

    return response;
  };

  // Wrap with timeout
  const fetchWithTimeout = () =>
    withTimeout(fetchOperation, { timeoutMs: timeout });

  // Wrap with retry if enabled
  const fetchWithRetry = retryConfig
    ? () =>
        retry(fetchWithTimeout, {
          ...(typeof retryConfig === "object" ? retryConfig : DEFAULT_RETRY_OPTIONS),
          onRetry: (error, attempt, delayMs) => {
            console.warn(
              `[Retry] Attempt ${attempt} for ${endpoint} after ${Math.round(delayMs)}ms`,
              error.details.type
            );
          },
        })
    : fetchWithTimeout;

  // Wrap with circuit breaker if enabled
  const fetchWithCircuitBreaker = useCircuitBreaker
    ? () => apiCircuitBreaker.execute(fetchWithRetry)
    : fetchWithRetry;

  try {
    return await fetchWithCircuitBreaker();
  } catch (error) {
    // Convert to ApiError if not already
    const apiError = error instanceof ApiError
      ? error
      : handleNetworkError(error, endpoint);

    // Log the error
    logError(apiError);

    throw apiError;
  }
}

/**
 * Generic request function that returns parsed JSON
 */
export async function request<T>(
  endpoint: string,
  config?: RequestConfig
): Promise<T> {
  const response = await makeRequest(endpoint, config);
  return response.json() as Promise<T>;
}

/**
 * GET request
 */
export async function get<T>(
  endpoint: string,
  config?: Omit<RequestConfig, "method" | "body">
): Promise<T> {
  return request<T>(endpoint, { ...config, method: "GET" });
}

/**
 * POST request
 */
export async function post<T>(
  endpoint: string,
  body?: unknown,
  config?: Omit<RequestConfig, "method" | "body">
): Promise<T> {
  return request<T>(endpoint, { ...config, method: "POST", body });
}

/**
 * PUT request
 */
export async function put<T>(
  endpoint: string,
  body?: unknown,
  config?: Omit<RequestConfig, "method" | "body">
): Promise<T> {
  return request<T>(endpoint, { ...config, method: "PUT", body });
}

/**
 * DELETE request
 */
export async function del<T>(
  endpoint: string,
  config?: Omit<RequestConfig, "method" | "body">
): Promise<T> {
  return request<T>(endpoint, { ...config, method: "DELETE" });
}

/**
 * PATCH request
 */
export async function patch<T>(
  endpoint: string,
  body?: unknown,
  config?: Omit<RequestConfig, "method" | "body">
): Promise<T> {
  return request<T>(endpoint, { ...config, method: "PATCH", body });
}

/**
 * Get circuit breaker stats (useful for debugging/monitoring)
 */
export function getCircuitBreakerStats() {
  return apiCircuitBreaker.getStats();
}

/**
 * Reset circuit breaker (useful for testing or manual recovery)
 */
export function resetCircuitBreaker() {
  apiCircuitBreaker.reset();
}
