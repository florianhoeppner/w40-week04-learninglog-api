/**
 * Timeout Utility
 * Wraps operations with configurable timeout
 */

import { ApiError, ErrorType } from "../types/errors";

export interface TimeoutOptions {
  timeoutMs?: number; // Default: 30000 (30 seconds)
  abortSignal?: AbortSignal; // Optional external abort signal
  onTimeout?: () => void; // Callback when timeout occurs
}

const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Wrap an async operation with a timeout
 */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: TimeoutOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Create an AbortController for timeout
  const timeoutController = new AbortController();

  // Set up timeout
  const timeoutId = setTimeout(() => {
    timeoutController.abort();
    if (options.onTimeout) {
      options.onTimeout();
    }
  }, timeoutMs);

  try {
    // If external signal provided, combine signals
    let signal = timeoutController.signal;
    if (options.abortSignal) {
      // Create combined signal that aborts when either aborts
      signal = combineSignals(timeoutController.signal, options.abortSignal);
    }

    const result = await operation(signal);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);

    // Check if it was our timeout that aborted
    if (
      timeoutController.signal.aborted &&
      !options.abortSignal?.aborted
    ) {
      throw new ApiError({
        message: `Operation timed out after ${timeoutMs}ms`,
        type: ErrorType.TIMEOUT_ERROR,
        timestamp: new Date().toISOString(),
        retryable: true,
      });
    }

    throw error;
  }
}

/**
 * Combine multiple AbortSignals into one
 */
function combineSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }

    signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  return controller.signal;
}

/**
 * Fetch with timeout wrapper
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  return withTimeout(
    (signal) => {
      // Merge our timeout signal with any existing signal in init
      const mergedInit = {
        ...init,
        signal: init?.signal
          ? combineSignals(signal, init.signal)
          : signal,
      };
      return fetch(input, mergedInit);
    },
    { timeoutMs }
  );
}

/**
 * Helper to create a timeout promise (for race conditions)
 */
export function createTimeoutPromise(
  timeoutMs: number,
  message?: string
): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(
        new ApiError({
          message: message || `Timeout after ${timeoutMs}ms`,
          type: ErrorType.TIMEOUT_ERROR,
          timestamp: new Date().toISOString(),
          retryable: true,
        })
      );
    }, timeoutMs);
  });
}
