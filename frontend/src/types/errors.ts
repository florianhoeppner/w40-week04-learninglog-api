/**
 * Error Types for CatAtlas Frontend
 * Provides structured error handling with type safety
 */

export const ErrorType = {
  // Network errors
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT_ERROR: "TIMEOUT_ERROR",

  // HTTP errors
  BAD_REQUEST: "BAD_REQUEST", // 400
  UNAUTHORIZED: "UNAUTHORIZED", // 401
  FORBIDDEN: "FORBIDDEN", // 403
  NOT_FOUND: "NOT_FOUND", // 404
  SERVER_ERROR: "SERVER_ERROR", // 500+

  // Application errors
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",

  // Resiliency errors
  CIRCUIT_BREAKER_OPEN: "CIRCUIT_BREAKER_OPEN",
  MAX_RETRIES_EXCEEDED: "MAX_RETRIES_EXCEEDED",
} as const;

export type ErrorType = typeof ErrorType[keyof typeof ErrorType];

export interface ApiErrorDetails {
  message: string;
  statusCode?: number;
  type: ErrorType;
  timestamp: string;
  endpoint?: string;
  retryable: boolean;
  retryAfter?: number; // seconds
  originalError?: Error;
}

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  public readonly details: ApiErrorDetails;

  constructor(details: ApiErrorDetails) {
    super(details.message);
    this.name = "ApiError";
    this.details = details;

    // Maintain proper stack trace in V8 engines
    if (typeof (Error as any).captureStackTrace === 'function') {
      (Error as any).captureStackTrace(this, ApiError);
    }
  }

  /**
   * Check if this error is retryable
   */
  isRetryable(): boolean {
    return this.details.retryable;
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(): string {
    switch (this.details.type) {
      case ErrorType.NETWORK_ERROR:
        return "Unable to connect to the server. Please check your internet connection.";
      case ErrorType.TIMEOUT_ERROR:
        return "The request took too long. Please try again.";
      case ErrorType.UNAUTHORIZED:
        return "You need to be logged in to perform this action.";
      case ErrorType.FORBIDDEN:
        return "You don't have permission to perform this action.";
      case ErrorType.NOT_FOUND:
        return "The requested resource was not found.";
      case ErrorType.SERVER_ERROR:
        return "Something went wrong on our end. Please try again later.";
      case ErrorType.CIRCUIT_BREAKER_OPEN:
        return "Service is temporarily unavailable. Please try again in a few moments.";
      case ErrorType.MAX_RETRIES_EXCEEDED:
        return "Request failed after multiple attempts. Please try again later.";
      case ErrorType.VALIDATION_ERROR:
        return this.details.message; // Use specific validation message
      default:
        return "An unexpected error occurred. Please try again.";
    }
  }
}

/**
 * Type guard to check if error is ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
