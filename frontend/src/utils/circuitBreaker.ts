/**
 * Circuit Breaker Pattern
 * Prevents cascading failures by failing fast when service is unhealthy
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, reject immediately
 * - HALF_OPEN: Testing if service recovered, allow limited requests
 */

import { ApiError, ErrorType } from "../types/errors";

export const CircuitState = {
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN",
} as const;

export type CircuitState = typeof CircuitState[keyof typeof CircuitState];

export interface CircuitBreakerOptions {
  failureThreshold?: number; // Number of failures before opening (default: 5)
  successThreshold?: number; // Number of successes to close from half-open (default: 2)
  timeout?: number; // Time in ms before trying half-open (default: 60000 = 1 min)
  onStateChange?: (oldState: CircuitState, newState: CircuitState) => void;
}

interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  nextAttempt: number; // Timestamp when we can try half-open
}

const DEFAULT_OPTIONS: Required<Omit<CircuitBreakerOptions, "onStateChange">> = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000, // 1 minute
};

/**
 * Circuit Breaker implementation
 */
export class CircuitBreaker {
  private options: Required<Omit<CircuitBreakerOptions, "onStateChange">>;
  private state: CircuitBreakerState;
  private onStateChange?: (oldState: CircuitState, newState: CircuitState) => void;

  constructor(options: CircuitBreakerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.onStateChange = options.onStateChange;
    this.state = {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      nextAttempt: 0,
    };
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state.state;
  }

  /**
   * Execute operation through circuit breaker
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state.state === CircuitState.OPEN) {
      // Check if timeout has elapsed
      if (Date.now() < this.state.nextAttempt) {
        throw new ApiError({
          message: "Circuit breaker is open",
          type: ErrorType.CIRCUIT_BREAKER_OPEN,
          timestamp: new Date().toISOString(),
          retryable: false,
          retryAfter: Math.ceil((this.state.nextAttempt - Date.now()) / 1000),
        });
      }

      // Timeout elapsed, try half-open
      this.transitionTo(CircuitState.HALF_OPEN);
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful request
   */
  private onSuccess(): void {
    if (this.state.state === CircuitState.HALF_OPEN) {
      this.state.successCount++;

      // If enough successes, close the circuit
      if (this.state.successCount >= this.options.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
        this.state.failureCount = 0;
        this.state.successCount = 0;
      }
    } else if (this.state.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.state.failureCount = 0;
    }
  }

  /**
   * Handle failed request
   */
  private onFailure(): void {
    this.state.failureCount++;

    if (this.state.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open reopens the circuit
      this.transitionTo(CircuitState.OPEN);
      this.state.nextAttempt = Date.now() + this.options.timeout;
      this.state.successCount = 0;
    } else if (this.state.state === CircuitState.CLOSED) {
      // Check if we've exceeded failure threshold
      if (this.state.failureCount >= this.options.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
        this.state.nextAttempt = Date.now() + this.options.timeout;
        this.state.successCount = 0;
      }
    }
  }

  /**
   * Transition to new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state.state;
    if (oldState !== newState) {
      this.state.state = newState;
      if (this.onStateChange) {
        this.onStateChange(oldState, newState);
      }
    }
  }

  /**
   * Manually reset circuit to closed state
   */
  reset(): void {
    this.transitionTo(CircuitState.CLOSED);
    this.state.failureCount = 0;
    this.state.successCount = 0;
    this.state.nextAttempt = 0;
  }

  /**
   * Get circuit breaker statistics
   */
  getStats() {
    return {
      state: this.state.state,
      failureCount: this.state.failureCount,
      successCount: this.state.successCount,
      nextAttemptIn:
        this.state.state === CircuitState.OPEN
          ? Math.max(0, this.state.nextAttempt - Date.now())
          : 0,
    };
  }
}

/**
 * Create a circuit breaker for API endpoints
 * Typically you'd create one per service or endpoint
 */
export function createCircuitBreaker(
  options?: CircuitBreakerOptions
): CircuitBreaker {
  return new CircuitBreaker(options);
}
