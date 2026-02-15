import { describe, expect, it } from "vitest";
import { CostTracker, estimateCost } from "./cost-tracking.js";
import { ErrorTaxonomy } from "./error-taxonomy.js";

describe("estimateCost", () => {
  it("calculates cost for known models", () => {
    const cost = estimateCost("claude-opus-4-6", 1000, 1000);
    expect(cost).toBeCloseTo(0.015 + 0.075, 5);
  });

  it("uses default pricing for unknown models", () => {
    const cost = estimateCost("unknown-model", 1000, 1000);
    expect(cost).toBeCloseTo(0.003 + 0.015, 5);
  });
});

describe("CostTracker", () => {
  it("records attempt and calculates cost", () => {
    const tracker = new CostTracker();
    const attempt = tracker.recordAttempt({
      taskId: "t1",
      attemptNumber: 0,
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 2000,
      modelId: "gpt-4o-mini",
      isRetry: false,
    });
    expect(attempt.estimatedCostUsd).toBeGreaterThan(0);
    expect(attempt.totalTokens).toBe(1500);
    expect(attempt.isRetry).toBe(false);
  });

  it("tracks task cost summary", () => {
    const tracker = new CostTracker();
    tracker.recordAttempt({
      taskId: "t1",
      attemptNumber: 0,
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 1000,
      modelId: "gpt-4o",
      isRetry: false,
    });
    tracker.recordAttempt({
      taskId: "t1",
      attemptNumber: 1,
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 1000,
      modelId: "gpt-4o",
      isRetry: true,
      errorTaxonomy: ErrorTaxonomy.MODEL_FAILURE,
    });
    tracker.markTaskOutcome("t1", false);

    const summary = tracker.getTaskSummary("t1");
    expect(summary.attempts).toHaveLength(2);
    expect(summary.totalCostUsd).toBeGreaterThan(0);
    expect(summary.wastedCostUsd).toBeGreaterThan(0);
    expect(summary.succeeded).toBe(false);
  });

  it("detects over-budget tasks", () => {
    const tracker = new CostTracker({ maxCostPerTaskUsd: 0.001 });
    tracker.recordAttempt({
      taskId: "t1",
      attemptNumber: 0,
      inputTokens: 10000,
      outputTokens: 5000,
      durationMs: 1000,
      modelId: "claude-opus-4-6",
      isRetry: false,
    });
    const result = tracker.isOverBudget("t1");
    expect(result.overBudget).toBe(true);
    expect(result.reason).toContain("exceeds budget");
  });

  it("detects over-budget by token count", () => {
    const tracker = new CostTracker({ maxTokensPerTask: 100 });
    tracker.recordAttempt({
      taskId: "t1",
      attemptNumber: 0,
      inputTokens: 80,
      outputTokens: 80,
      durationMs: 1000,
      modelId: "gpt-4o-mini",
      isRetry: false,
    });
    expect(tracker.isOverBudget("t1").overBudget).toBe(true);
  });

  it("reports aggregate stats", () => {
    const tracker = new CostTracker();
    tracker.recordAttempt({
      taskId: "t1",
      attemptNumber: 0,
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 100,
      modelId: "gpt-4o-mini",
      isRetry: false,
    });
    tracker.recordAttempt({
      taskId: "t1",
      attemptNumber: 1,
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 100,
      modelId: "gpt-4o-mini",
      isRetry: true,
      errorTaxonomy: ErrorTaxonomy.TOOL_FAILURE,
    });
    tracker.markTaskOutcome("t1", true);

    const stats = tracker.getAggregateStats();
    expect(stats.totalAttempts).toBe(2);
    expect(stats.totalRetries).toBe(1);
    expect(stats.taskCount).toBe(1);
    expect(stats.successRate).toBe(1);
    expect(stats.retryRate).toBe(0.5);
  });

  it("resets all data", () => {
    const tracker = new CostTracker();
    tracker.recordAttempt({
      taskId: "t1",
      attemptNumber: 0,
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 100,
      modelId: "gpt-4o-mini",
      isRetry: false,
    });
    tracker.reset();
    expect(tracker.getAllAttempts()).toHaveLength(0);
  });
});
