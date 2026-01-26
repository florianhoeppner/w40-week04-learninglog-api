/**
 * Error Utilities for CatAtlas Frontend
 * Helper functions to classify and transform errors
 */

import { ApiError, type ApiErrorDetails, ErrorType } from "../types/errors";

/**
 * Classify HTTP status code to ErrorType
 */
export function classifyHttpError(status: number): ErrorType {
  if (status >= 500) return ErrorType.SERVER_ERROR;
  if (status === 404) return ErrorType.NOT_FOUND;
  if (status === 403) return ErrorType.FORBIDDEN;
  if (status === 401) return ErrorType.UNAUTHORIZED;
  if (status === 400) return ErrorType.BAD_REQUEST;
  return ErrorType.UNKNOWN_ERROR;
}

/**
 * Determine if an HTTP status code represents a retryable error
 */
export function isRetryableStatus(status: number): boolean {
  // Retry on server errors (500+) and rate limiting (429)
  return status >= 500 || status === 429 || status === 503;
}

/**
 * Parse error response body
 */
async function parseErrorBody(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const data = await response.json();
      return data.message || data.error || data.detail || "Unknown error";
    }
    const text = await response.text();
    return text || `HTTP ${response.status}: ${response.statusText}`;
  } catch {
    return `HTTP ${response.status}: ${response.statusText}`;
  }
}

/**
 * Transform fetch Response error to ApiError
 */
export async function handleHttpError(
  response: Response,
  endpoint: string
): Promise<ApiError> {
  const status = response.status;
  const errorType = classifyHttpError(status);
  const message = await parseErrorBody(response);

  const details: ApiErrorDetails = {
    message,
    statusCode: status,
    type: errorType,
    timestamp: new Date().toISOString(),
    endpoint,
    retryable: isRetryableStatus(status),
  };

  // Check for Retry-After header (for rate limiting)
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    details.retryAfter = parseInt(retryAfter, 10);
  }

  return new ApiError(details);
}

/**
 * Transform network/unknown error to ApiError
 */
export function handleNetworkError(
  error: unknown,
  endpoint?: string
): ApiError {
  // Check if it's already an ApiError
  if (error instanceof ApiError) {
    return error;
  }

  // Handle TypeError (usually network errors)
  if (error instanceof TypeError) {
    const details: ApiErrorDetails = {
      message: "Network connection failed",
      type: ErrorType.NETWORK_ERROR,
      timestamp: new Date().toISOString(),
      endpoint,
      retryable: true,
      originalError: error,
    };
    return new ApiError(details);
  }

  // Handle timeout errors (DOMException: AbortError)
  if (error instanceof Error && error.name === "AbortError") {
    const details: ApiErrorDetails = {
      message: "Request timeout",
      type: ErrorType.TIMEOUT_ERROR,
      timestamp: new Date().toISOString(),
      endpoint,
      retryable: true,
      originalError: error,
    };
    return new ApiError(details);
  }

  // Handle generic Error
  if (error instanceof Error) {
    const details: ApiErrorDetails = {
      message: error.message,
      type: ErrorType.UNKNOWN_ERROR,
      timestamp: new Date().toISOString(),
      endpoint,
      retryable: false,
      originalError: error,
    };
    return new ApiError(details);
  }

  // Fallback for non-Error objects
  const details: ApiErrorDetails = {
    message: String(error),
    type: ErrorType.UNKNOWN_ERROR,
    timestamp: new Date().toISOString(),
    endpoint,
    retryable: false,
  };
  return new ApiError(details);
}

/**
 * Create a validation error
 */
export function createValidationError(message: string): ApiError {
  const details: ApiErrorDetails = {
    message,
    type: ErrorType.VALIDATION_ERROR,
    timestamp: new Date().toISOString(),
    retryable: false,
  };
  return new ApiError(details);
}

/**
 * Log error to console in development, could send to error tracking service in production
 */
export function logError(error: ApiError): void {
  if (import.meta.env.DEV) {
    console.error("[ApiError]", {
      type: error.details.type,
      message: error.details.message,
      statusCode: error.details.statusCode,
      endpoint: error.details.endpoint,
      timestamp: error.details.timestamp,
      retryable: error.details.retryable,
      originalError: error.details.originalError,
    });
  }

  // In production, you could send to Sentry or other error tracking service
  // if (import.meta.env.PROD && window.Sentry) {
  //   window.Sentry.captureException(error);
  // }
}
