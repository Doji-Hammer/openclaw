/**
 * D9: Failure Reporting / Dashboard Data
 *
 * @module contracts/failure-reporting
 */

import type { DLQStats } from "./dead-letter-queue.js";
import type { CorrelationAlert } from "./failure-correlation.js";
import type { CircuitBreakerState } from "./retry-budget.js";
import { DegradationLevel } from "./graceful-degradation.js";

export interface FailureReport {
  generatedAt: number;
  windowMs: number;
  healthScore: number;
  degradationLevel: DegradationLevel;
  errors: ErrorSummary;
  retries: RetrySummary;
  costs: CostSummary;
  circuits: CircuitSummary;
  dlq: DLQStats;
  alerts: CorrelationAlert[];
  recommendations: string[];
}

export interface ErrorSummary {
  total: number;
  byTaxonomy: Record<string, number>;
  errorRate: number;
  topMessages: Array<{ message: string; count: number }>;
}

export interface RetrySummary {
  totalRetries: number;
  successfulRetries: number;
  retrySuccessRate: number;
  exhaustedBudgets: number;
}

export interface CostSummary {
  totalCostUsd: number;
  wastedCostUsd: number;
  wastePercentage: number;
  totalTokens: number;
  wastedTokens: number;
}

export interface CircuitSummary {
  global: CircuitBreakerState;
  byTaxonomy: Record<string, CircuitBreakerState>;
  openCount: number;
}

export class FailureReportBuilder {
  private windowMs: number;

  constructor(windowMs = 300_000) {
    this.windowMs = windowMs;
  }

  build(params: {
    errors: ErrorSummary;
    retries: RetrySummary;
    costs: CostSummary;
    circuits: CircuitSummary;
    dlq: DLQStats;
    alerts: CorrelationAlert[];
    degradationLevel: DegradationLevel;
  }): FailureReport {
    return {
      generatedAt: Date.now(),
      windowMs: this.windowMs,
      healthScore: this.calculateHealthScore(params),
      degradationLevel: params.degradationLevel,
      errors: params.errors,
      retries: params.retries,
      costs: params.costs,
      circuits: params.circuits,
      dlq: params.dlq,
      alerts: params.alerts,
      recommendations: this.generateRecommendations(params),
    };
  }

  private calculateHealthScore(params: {
    errors: ErrorSummary;
    costs: CostSummary;
    circuits: CircuitSummary;
    alerts: CorrelationAlert[];
    degradationLevel: DegradationLevel;
  }): number {
    let score = 100;
    score -= Math.min(40, params.errors.errorRate * 100);
    score -= Math.min(20, params.circuits.openCount * 10);
    score -= Math.min(15, params.costs.wastePercentage * 0.15);
    score -= Math.min(15, params.alerts.length * 5);
    const penalty: Record<DegradationLevel, number> = {
      [DegradationLevel.NORMAL]: 0,
      [DegradationLevel.REDUCED]: 5,
      [DegradationLevel.MINIMAL]: 10,
      [DegradationLevel.EMERGENCY]: 20,
    };
    score -= penalty[params.degradationLevel];
    return Math.max(0, Math.round(score));
  }

  private generateRecommendations(params: {
    errors: ErrorSummary;
    retries: RetrySummary;
    costs: CostSummary;
    circuits: CircuitSummary;
    dlq: DLQStats;
    alerts: CorrelationAlert[];
  }): string[] {
    const recs: string[] = [];
    if (params.errors.errorRate > 0.3)
      recs.push("High error rate detected. Review error patterns and consider model fallbacks.");
    if (params.circuits.openCount > 0)
      recs.push(
        `${params.circuits.openCount} circuit breaker(s) open. Investigate failing components.`,
      );
    if (params.costs.wastePercentage > 50)
      recs.push(
        `${params.costs.wastePercentage.toFixed(0)}% cost waste. Review retry strategies and error handling.`,
      );
    if (params.dlq.total > 10)
      recs.push(
        `${params.dlq.total} tasks in dead letter queue. Review and resolve pending items.`,
      );
    if (params.alerts.some((a) => a.type === "cascade"))
      recs.push("Cascading failure detected. Consider enabling emergency degradation mode.");
    if (params.retries.retrySuccessRate < 0.2 && params.retries.totalRetries > 0)
      recs.push(
        "Retry success rate is very low. Retries may be wasting resources without benefit.",
      );
    if (recs.length === 0) recs.push("System operating normally. No action required.");
    return recs;
  }
}
