/**
 * Retry Utility with Exponential Backoff
 * Automatically retries failed operations with increasing delays
 */

import { ApiError, ErrorType } from "../types/errors";

export interface RetryOptions {
  maxAttempts?: number; // Default: 3
  initialDelayMs?: number; // Default: 1000 (1 second)
  maxDelayMs?: number; // Default: 10000 (10 seconds)
  backoffMultiplier?: number; // Default: 2
  shouldRetry?: (error: ApiError, attempt: number) => boolean;
  onRetry?: (error: ApiError, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "onRetry">> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  shouldRetry: (error: ApiError) => error.isRetryable(),
};

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  backoffMultiplier: number,
  maxDelayMs: number
): number {
  // Exponential backoff: initialDelay * (multiplier ^ attempt)
  const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter (random 0-25% of delay) to avoid thundering herd
  const jitter = cappedDelay * Math.random() * 0.25;

  return cappedDelay + jitter;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async operation with exponential backoff
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let lastError: ApiError | undefined;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      // Convert to ApiError if needed
      if (!(error instanceof ApiError)) {
        throw error; // Don't retry non-ApiErrors
      }

      lastError = error;

      // Check if we should retry this error
      const shouldRetry = opts.shouldRetry
        ? opts.shouldRetry(error, attempt)
        : error.isRetryable();

      // Don't retry on last attempt or if error is not retryable
      if (attempt === opts.maxAttempts - 1 || !shouldRetry) {
        break;
      }

      // Calculate delay
      const delayMs = calculateDelay(
        attempt,
        opts.initialDelayMs,
        opts.backoffMultiplier,
        opts.maxDelayMs
      );

      // Call retry callback if provided
      if (options.onRetry) {
        options.onRetry(error, attempt + 1, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // If we get here, all retries failed
  if (lastError) {
    // Create new error indicating max retries exceeded
    throw new ApiError({
      ...lastError.details,
      type: ErrorType.MAX_RETRIES_EXCEEDED,
      message: `${lastError.details.message} (failed after ${opts.maxAttempts} attempts)`,
    });
  }

  // This should never happen, but TypeScript needs it
  throw new Error("Retry failed with no error");
}

/**
 * Wrapper for fetch with retry logic
 */
export async function retryFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  return retry(() => fetch(input, init), options);
}
