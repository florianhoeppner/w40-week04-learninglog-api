/**
 * Tests for Error Utilities
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyHttpError,
  isRetryableStatus,
  handleHttpError,
  handleNetworkError,
  createValidationError,
} from "../errors";
import { ApiError, ErrorType } from "../../types/errors";

describe("Error Utilities", () => {
  describe("classifyHttpError", () => {
    it("should classify 500+ as SERVER_ERROR", () => {
      expect(classifyHttpError(500)).toBe(ErrorType.SERVER_ERROR);
      expect(classifyHttpError(502)).toBe(ErrorType.SERVER_ERROR);
      expect(classifyHttpError(503)).toBe(ErrorType.SERVER_ERROR);
    });

    it("should classify 404 as NOT_FOUND", () => {
      expect(classifyHttpError(404)).toBe(ErrorType.NOT_FOUND);
    });

    it("should classify 403 as FORBIDDEN", () => {
      expect(classifyHttpError(403)).toBe(ErrorType.FORBIDDEN);
    });

    it("should classify 401 as UNAUTHORIZED", () => {
      expect(classifyHttpError(401)).toBe(ErrorType.UNAUTHORIZED);
    });

    it("should classify 400 as BAD_REQUEST", () => {
      expect(classifyHttpError(400)).toBe(ErrorType.BAD_REQUEST);
    });

    it("should classify other codes as UNKNOWN_ERROR", () => {
      expect(classifyHttpError(418)).toBe(ErrorType.UNKNOWN_ERROR);
      expect(classifyHttpError(300)).toBe(ErrorType.UNKNOWN_ERROR);
    });
  });

  describe("isRetryableStatus", () => {
    it("should mark 500+ as retryable", () => {
      expect(isRetryableStatus(500)).toBe(true);
      expect(isRetryableStatus(502)).toBe(true);
      expect(isRetryableStatus(503)).toBe(true);
    });

    it("should mark 429 and 503 as retryable", () => {
      expect(isRetryableStatus(429)).toBe(true);
      expect(isRetryableStatus(503)).toBe(true);
    });

    it("should mark 4xx as not retryable", () => {
      expect(isRetryableStatus(400)).toBe(false);
      expect(isRetryableStatus(401)).toBe(false);
      expect(isRetryableStatus(403)).toBe(false);
      expect(isRetryableStatus(404)).toBe(false);
    });
  });

  describe("handleHttpError", () => {
    it("should create ApiError from Response with JSON body", async () => {
      const response = new Response(
        JSON.stringify({ message: "Test error" }),
        {
          status: 500,
          statusText: "Internal Server Error",
          headers: { "Content-Type": "application/json" },
        }
      );

      const error = await handleHttpError(response, "/test");

      expect(error).toBeInstanceOf(ApiError);
      expect(error.details.message).toBe("Test error");
      expect(error.details.statusCode).toBe(500);
      expect(error.details.type).toBe(ErrorType.SERVER_ERROR);
      expect(error.details.endpoint).toBe("/test");
      expect(error.details.retryable).toBe(true);
    });

    it("should handle text response body", async () => {
      const response = new Response("Plain text error", {
        status: 404,
        statusText: "Not Found",
      });

      const error = await handleHttpError(response, "/test");

      expect(error.details.message).toBe("Plain text error");
      expect(error.details.statusCode).toBe(404);
      expect(error.details.type).toBe(ErrorType.NOT_FOUND);
    });

    it("should parse Retry-After header", async () => {
      const response = new Response(JSON.stringify({ error: "Rate limited" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "60",
        },
      });

      const error = await handleHttpError(response, "/test");

      expect(error.details.retryAfter).toBe(60);
    });
  });

  describe("handleNetworkError", () => {
    it("should return ApiError as-is", () => {
      const apiError = new ApiError({
        message: "Test",
        type: ErrorType.NETWORK_ERROR,
        timestamp: new Date().toISOString(),
        retryable: true,
      });

      const result = handleNetworkError(apiError);
      expect(result).toBe(apiError);
    });

    it("should convert TypeError to NETWORK_ERROR", () => {
      const typeError = new TypeError("Failed to fetch");
      const error = handleNetworkError(typeError, "/test");

      expect(error).toBeInstanceOf(ApiError);
      expect(error.details.type).toBe(ErrorType.NETWORK_ERROR);
      expect(error.details.message).toBe("Network connection failed");
      expect(error.details.retryable).toBe(true);
      expect(error.details.endpoint).toBe("/test");
    });

    it("should convert AbortError to TIMEOUT_ERROR", () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      const error = handleNetworkError(abortError, "/test");

      expect(error.details.type).toBe(ErrorType.TIMEOUT_ERROR);
      expect(error.details.message).toBe("Request timeout");
      expect(error.details.retryable).toBe(true);
    });

    it("should convert generic Error to UNKNOWN_ERROR", () => {
      const genericError = new Error("Something went wrong");
      const error = handleNetworkError(genericError);

      expect(error.details.type).toBe(ErrorType.UNKNOWN_ERROR);
      expect(error.details.message).toBe("Something went wrong");
      expect(error.details.retryable).toBe(false);
    });

    it("should handle non-Error objects", () => {
      const error = handleNetworkError("String error");

      expect(error.details.type).toBe(ErrorType.UNKNOWN_ERROR);
      expect(error.details.message).toBe("String error");
      expect(error.details.retryable).toBe(false);
    });
  });

  describe("createValidationError", () => {
    it("should create validation error with message", () => {
      const error = createValidationError("Invalid input");

      expect(error).toBeInstanceOf(ApiError);
      expect(error.details.type).toBe(ErrorType.VALIDATION_ERROR);
      expect(error.details.message).toBe("Invalid input");
      expect(error.details.retryable).toBe(false);
    });
  });

  describe("ApiError class", () => {
    it("should have correct user messages for each error type", () => {
      const testCases = [
        {
          type: ErrorType.NETWORK_ERROR,
          expected: "Unable to connect to the server. Please check your internet connection.",
        },
        {
          type: ErrorType.TIMEOUT_ERROR,
          expected: "The request took too long. Please try again.",
        },
        {
          type: ErrorType.UNAUTHORIZED,
          expected: "You need to be logged in to perform this action.",
        },
        {
          type: ErrorType.SERVER_ERROR,
          expected: "Something went wrong on our end. Please try again later.",
        },
      ];

      for (const { type, expected } of testCases) {
        const error = new ApiError({
          message: "Test",
          type,
          timestamp: new Date().toISOString(),
          retryable: false,
        });

        expect(error.getUserMessage()).toBe(expected);
      }
    });

    it("should use custom message for validation errors", () => {
      const error = createValidationError("Email is required");
      expect(error.getUserMessage()).toBe("Email is required");
    });
  });
});
