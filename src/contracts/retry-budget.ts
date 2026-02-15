/**
 * D3: Retry Budget / Circuit Breaker Pattern
 *
 * Tracks retry attempts per task and enforces budgets.
 * Implements circuit breaker to prevent retry storms.
 *
 * @module contracts/retry-budget
 */

import { ErrorTaxonomy, getErrorResponseConfig } from "./error-taxonomy.js";

// ============================================================================
// Circuit Breaker States
// ============================================================================

export enum CircuitState {
  CLOSED = "closed",
  HALF_OPEN = "half_open",
  OPEN = "open",
}

// ============================================================================
// Types
// ============================================================================

export interface RetryAttempt {
  timestamp: number;
  taxonomy: ErrorTaxonomy;
  message: string;
  inputChanged: boolean;
}

export interface RetryBudgetEntry {
  taskId: string;
  maxRetries: number;
  attempts: RetryAttempt[];
  exhausted: boolean;
  createdAt: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenSuccessThreshold: number;
}

export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: number | null;
  lastStateChange: number;
}

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  halfOpenSuccessThreshold: 1,
};

// ============================================================================
// Circuit Breaker
// ============================================================================

export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private _state: CircuitBreakerState;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
    this._state = {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastFailureAt: null,
      lastStateChange: Date.now(),
    };
  }

  get state(): CircuitBreakerState {
    this.maybeTransition();
    return { ...this._state };
  }

  get isOpen(): boolean {
    this.maybeTransition();
    return this._state.state === CircuitState.OPEN;
  }

  get isClosed(): boolean {
    this.maybeTransition();
    return this._state.state === CircuitState.CLOSED;
  }

  canExecute(): boolean {
    this.maybeTransition();
    return this._state.state !== CircuitState.OPEN;
  }

  recordSuccess(): void {
    this.maybeTransition();
    if (this._state.state === CircuitState.HALF_OPEN) {
      this._state.successCount++;
      if (this._state.successCount >= this.config.halfOpenSuccessThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    } else if (this._state.state === CircuitState.CLOSED) {
      this._state.failureCount = 0;
    }
  }

  recordFailure(): void {
    this._state.failureCount++;
    this._state.lastFailureAt = Date.now();

    if (this._state.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN);
    } else if (
      this._state.state === CircuitState.CLOSED &&
      this._state.failureCount >= this.config.failureThreshold
    ) {
      this.transitionTo(CircuitState.OPEN);
    }
  }

  reset(): void {
    this.transitionTo(CircuitState.CLOSED);
    this._state.failureCount = 0;
    this._state.successCount = 0;
    this._state.lastFailureAt = null;
  }

  private transitionTo(state: CircuitState): void {
    this._state.state = state;
    this._state.lastStateChange = Date.now();
    if (state === CircuitState.CLOSED) {
      this._state.failureCount = 0;
      this._state.successCount = 0;
    } else if (state === CircuitState.HALF_OPEN) {
      this._state.successCount = 0;
    }
  }

  private maybeTransition(): void {
    if (
      this._state.state === CircuitState.OPEN &&
      this._state.lastFailureAt !== null &&
      Date.now() - this._state.lastFailureAt >= this.config.resetTimeoutMs
    ) {
      this.transitionTo(CircuitState.HALF_OPEN);
    }
  }
}

// ============================================================================
// Retry Budget Manager
// ============================================================================

export class RetryBudgetManager {
  private budgets = new Map<string, RetryBudgetEntry>();
  private circuitBreakers = new Map<string, CircuitBreaker>();
  private globalCircuit: CircuitBreaker;

  constructor(globalCircuitConfig?: Partial<CircuitBreakerConfig>) {
    this.globalCircuit = new CircuitBreaker(globalCircuitConfig);
  }

  canRetry(taskId: string, taxonomy: ErrorTaxonomy): boolean {
    if (!this.globalCircuit.canExecute()) return false;

    const taxonomyBreaker = this.circuitBreakers.get(taxonomy);
    if (taxonomyBreaker && !taxonomyBreaker.canExecute()) return false;

    const config = getErrorResponseConfig(taxonomy);
    if (!config.retryable) return false;

    const budget = this.budgets.get(taskId);
    if (!budget) return true;
    if (budget.exhausted) return false;
    return budget.attempts.length < budget.maxRetries;
  }

  recordAttempt(
    taskId: string,
    taxonomy: ErrorTaxonomy,
    message: string,
    inputChanged: boolean,
  ): RetryBudgetEntry {
    const config = getErrorResponseConfig(taxonomy);
    let budget = this.budgets.get(taskId);

    if (!budget) {
      budget = {
        taskId,
        maxRetries: config.maxRetries,
        attempts: [],
        exhausted: false,
        createdAt: Date.now(),
      };
      this.budgets.set(taskId, budget);
    }

    budget.attempts.push({ timestamp: Date.now(), taxonomy, message, inputChanged });

    if (budget.attempts.length >= budget.maxRetries) {
      budget.exhausted = true;
    }

    this.globalCircuit.recordFailure();
    if (!this.circuitBreakers.has(taxonomy)) {
      this.circuitBreakers.set(taxonomy, new CircuitBreaker());
    }
    this.circuitBreakers.get(taxonomy)!.recordFailure();

    return { ...budget };
  }

  recordSuccess(taskId: string, taxonomy?: ErrorTaxonomy): void {
    this.globalCircuit.recordSuccess();
    if (taxonomy) {
      this.circuitBreakers.get(taxonomy)?.recordSuccess();
    }
    this.budgets.delete(taskId);
  }

  getBudget(taskId: string): RetryBudgetEntry | undefined {
    return this.budgets.get(taskId);
  }

  getExhaustedBudgets(): RetryBudgetEntry[] {
    return Array.from(this.budgets.values()).filter((b) => b.exhausted);
  }

  getGlobalCircuitState(): CircuitBreakerState {
    return this.globalCircuit.state;
  }

  getTaxonomyCircuitState(taxonomy: ErrorTaxonomy): CircuitBreakerState | undefined {
    return this.circuitBreakers.get(taxonomy)?.state;
  }

  reset(): void {
    this.budgets.clear();
    this.circuitBreakers.clear();
    this.globalCircuit.reset();
  }
}
