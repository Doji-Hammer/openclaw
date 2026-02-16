import { describe, expect, it } from "vitest";
import { DLQEntryStatus } from "./dead-letter-queue.js";
import { FailureReportBuilder } from "./failure-reporting.js";
import { DegradationLevel } from "./graceful-degradation.js";
import { CircuitState } from "./retry-budget.js";

const baseCircuitState = {
  state: CircuitState.CLOSED,
  failureCount: 0,
  successCount: 0,
  lastFailureAt: null,
  lastStateChange: Date.now(),
};

const baseDlqStats = {
  total: 0,
  byStatus: {
    [DLQEntryStatus.PENDING]: 0,
    [DLQEntryStatus.REVIEWING]: 0,
    [DLQEntryStatus.RETRIED]: 0,
    [DLQEntryStatus.DISCARDED]: 0,
    [DLQEntryStatus.RESOLVED]: 0,
  },
  byTaxonomy: {},
  byReason: {},
  oldestPendingAgeMs: null,
};

describe("FailureReportBuilder", () => {
  it("builds a healthy report with score 100", () => {
    const builder = new FailureReportBuilder();
    const report = builder.build({
      errors: { total: 0, byTaxonomy: {}, errorRate: 0, topMessages: [] },
      retries: { totalRetries: 0, successfulRetries: 0, retrySuccessRate: 0, exhaustedBudgets: 0 },
      costs: {
        totalCostUsd: 0,
        wastedCostUsd: 0,
        wastePercentage: 0,
        totalTokens: 0,
        wastedTokens: 0,
      },
      circuits: { global: baseCircuitState, byTaxonomy: {}, openCount: 0 },
      dlq: baseDlqStats,
      alerts: [],
      degradationLevel: DegradationLevel.NORMAL,
    });

    expect(report.healthScore).toBe(100);
    expect(report.recommendations).toContain("System operating normally. No action required.");
  });

  it("reduces health score with errors", () => {
    const builder = new FailureReportBuilder();
    const report = builder.build({
      errors: { total: 10, byTaxonomy: {}, errorRate: 0.5, topMessages: [] },
      retries: { totalRetries: 5, successfulRetries: 0, retrySuccessRate: 0, exhaustedBudgets: 3 },
      costs: {
        totalCostUsd: 1.0,
        wastedCostUsd: 0.8,
        wastePercentage: 80,
        totalTokens: 10000,
        wastedTokens: 8000,
      },
      circuits: {
        global: { ...baseCircuitState, state: CircuitState.OPEN },
        byTaxonomy: {},
        openCount: 1,
      },
      dlq: { ...baseDlqStats, total: 15 },
      alerts: [
        {
          type: "cascade",
          severity: "critical",
          description: "cascade",
          events: [],
          dimension: "time_window",
          dimensionValue: "60s",
          detectedAt: Date.now(),
        },
      ],
      degradationLevel: DegradationLevel.EMERGENCY,
    });

    expect(report.healthScore).toBeLessThan(50);
    expect(report.recommendations.length).toBeGreaterThan(1);
    expect(report.recommendations.some((r) => r.includes("error rate"))).toBe(true);
    expect(report.recommendations.some((r) => r.includes("circuit breaker"))).toBe(true);
    expect(report.recommendations.some((r) => r.includes("cost waste"))).toBe(true);
    expect(report.recommendations.some((r) => r.includes("dead letter"))).toBe(true);
    expect(report.recommendations.some((r) => r.includes("Cascading"))).toBe(true);
  });

  it("recommends on low retry success rate", () => {
    const builder = new FailureReportBuilder();
    const report = builder.build({
      errors: { total: 1, byTaxonomy: {}, errorRate: 0.1, topMessages: [] },
      retries: {
        totalRetries: 10,
        successfulRetries: 1,
        retrySuccessRate: 0.1,
        exhaustedBudgets: 0,
      },
      costs: {
        totalCostUsd: 0,
        wastedCostUsd: 0,
        wastePercentage: 0,
        totalTokens: 0,
        wastedTokens: 0,
      },
      circuits: { global: baseCircuitState, byTaxonomy: {}, openCount: 0 },
      dlq: baseDlqStats,
      alerts: [],
      degradationLevel: DegradationLevel.NORMAL,
    });

    expect(report.recommendations.some((r) => r.includes("Retry success rate"))).toBe(true);
  });

  it("includes window and timestamp", () => {
    const builder = new FailureReportBuilder(120_000);
    const report = builder.build({
      errors: { total: 0, byTaxonomy: {}, errorRate: 0, topMessages: [] },
      retries: { totalRetries: 0, successfulRetries: 0, retrySuccessRate: 0, exhaustedBudgets: 0 },
      costs: {
        totalCostUsd: 0,
        wastedCostUsd: 0,
        wastePercentage: 0,
        totalTokens: 0,
        wastedTokens: 0,
      },
      circuits: { global: baseCircuitState, byTaxonomy: {}, openCount: 0 },
      dlq: baseDlqStats,
      alerts: [],
      degradationLevel: DegradationLevel.NORMAL,
    });

    expect(report.windowMs).toBe(120_000);
    expect(report.generatedAt).toBeTypeOf("number");
  });
});
