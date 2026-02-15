import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ErrorTaxonomy } from "./error-taxonomy.js";
import { CircuitBreaker, CircuitState, RetryBudgetManager } from "./retry-budget.js";

describe("CircuitBreaker", () => {
  it("starts closed", () => {
    const cb = new CircuitBreaker();
    expect(cb.isClosed).toBe(true);
    expect(cb.canExecute()).toBe(true);
  });

  it("opens after threshold failures", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isClosed).toBe(true);
    cb.recordFailure();
    expect(cb.isOpen).toBe(true);
    expect(cb.canExecute()).toBe(false);
  });

  it("transitions to half-open after reset timeout", () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    cb.recordFailure();
    expect(cb.isOpen).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(cb.state.state).toBe(CircuitState.HALF_OPEN);
    expect(cb.canExecute()).toBe(true);
    vi.useRealTimers();
  });

  it("closes from half-open on success", () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 100 });
    cb.recordFailure();
    vi.advanceTimersByTime(100);
    cb.recordSuccess();
    expect(cb.isClosed).toBe(true);
    vi.useRealTimers();
  });

  it("reopens from half-open on failure", () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 100 });
    cb.recordFailure();
    vi.advanceTimersByTime(100);
    expect(cb.state.state).toBe(CircuitState.HALF_OPEN);
    cb.recordFailure();
    expect(cb.isOpen).toBe(true);
    vi.useRealTimers();
  });

  it("resets completely", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    cb.recordFailure();
    expect(cb.isOpen).toBe(true);
    cb.reset();
    expect(cb.isClosed).toBe(true);
    expect(cb.state.failureCount).toBe(0);
  });

  it("resets failure count on success in closed state", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    // After success, count resets so 1 more failure won't open
    cb.recordFailure();
    expect(cb.isClosed).toBe(true);
  });
});

describe("RetryBudgetManager", () => {
  it("allows first retry for retryable errors", () => {
    const mgr = new RetryBudgetManager();
    expect(mgr.canRetry("task-1", ErrorTaxonomy.SCHEMA_VIOLATION)).toBe(true);
  });

  it("denies retry for non-retryable errors", () => {
    const mgr = new RetryBudgetManager();
    expect(mgr.canRetry("task-1", ErrorTaxonomy.INVARIANT_VIOLATION)).toBe(false);
  });

  it("denies retry after budget exhausted", () => {
    const mgr = new RetryBudgetManager();
    mgr.recordAttempt("task-1", ErrorTaxonomy.SCHEMA_VIOLATION, "fail", true);
    expect(mgr.canRetry("task-1", ErrorTaxonomy.SCHEMA_VIOLATION)).toBe(false);
  });

  it("tracks exhausted budgets", () => {
    const mgr = new RetryBudgetManager();
    mgr.recordAttempt("task-1", ErrorTaxonomy.SCHEMA_VIOLATION, "fail", true);
    const exhausted = mgr.getExhaustedBudgets();
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]!.taskId).toBe("task-1");
  });

  it("clears budget on success", () => {
    const mgr = new RetryBudgetManager();
    mgr.recordAttempt("task-1", ErrorTaxonomy.SCHEMA_VIOLATION, "fail", true);
    mgr.recordSuccess("task-1", ErrorTaxonomy.SCHEMA_VIOLATION);
    expect(mgr.getBudget("task-1")).toBeUndefined();
  });

  it("blocks all retries when global circuit opens", () => {
    const mgr = new RetryBudgetManager({ failureThreshold: 2 });
    mgr.recordAttempt("t1", ErrorTaxonomy.TOOL_FAILURE, "fail", false);
    mgr.recordAttempt("t2", ErrorTaxonomy.TOOL_FAILURE, "fail", false);
    // Global circuit should be open now
    expect(mgr.canRetry("t3", ErrorTaxonomy.TOOL_FAILURE)).toBe(false);
    expect(mgr.getGlobalCircuitState().state).toBe(CircuitState.OPEN);
  });

  it("resets everything", () => {
    const mgr = new RetryBudgetManager();
    mgr.recordAttempt("t1", ErrorTaxonomy.TOOL_FAILURE, "fail", false);
    mgr.reset();
    expect(mgr.getExhaustedBudgets()).toHaveLength(0);
    expect(mgr.getGlobalCircuitState().state).toBe(CircuitState.CLOSED);
  });
});
