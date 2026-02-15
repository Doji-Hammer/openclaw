/**
 * D5: Cost Tracking Per Retry Attempt
 *
 * @module contracts/cost-tracking
 */

import { ErrorTaxonomy } from "./error-taxonomy.js";

export interface AttemptCost {
  attemptId: string;
  taskId: string;
  attemptNumber: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  modelId: string;
  isRetry: boolean;
  errorTaxonomy?: ErrorTaxonomy;
  timestamp: number;
}

export interface TaskCostSummary {
  taskId: string;
  attempts: AttemptCost[];
  totalCostUsd: number;
  totalTokens: number;
  totalDurationMs: number;
  wastedCostUsd: number;
  wastedTokens: number;
  succeeded: boolean;
}

export interface CostBudget {
  maxCostPerTaskUsd: number;
  maxTokensPerTask: number;
  maxTotalCostUsd: number;
}

const DEFAULT_COST_BUDGET: CostBudget = {
  maxCostPerTaskUsd: 1.0,
  maxTokensPerTask: 500_000,
  maxTotalCostUsd: 100.0,
};

interface ModelPricing {
  inputPer1kTokens: number;
  outputPer1kTokens: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6": { inputPer1kTokens: 0.015, outputPer1kTokens: 0.075 },
  "claude-sonnet-4-5": { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015 },
  "gpt-4o": { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 },
  "gpt-4o-mini": { inputPer1kTokens: 0.00015, outputPer1kTokens: 0.0006 },
  default: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015 },
};

export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[modelId] ?? MODEL_PRICING["default"]!;
  return (
    (inputTokens / 1000) * pricing.inputPer1kTokens +
    (outputTokens / 1000) * pricing.outputPer1kTokens
  );
}

export class CostTracker {
  private attempts: AttemptCost[] = [];
  private taskOutcomes = new Map<string, boolean>();
  private budget: CostBudget;

  constructor(budget?: Partial<CostBudget>) {
    this.budget = { ...DEFAULT_COST_BUDGET, ...budget };
  }

  recordAttempt(params: {
    taskId: string;
    attemptNumber: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    modelId: string;
    isRetry: boolean;
    errorTaxonomy?: ErrorTaxonomy;
  }): AttemptCost {
    const cost = estimateCost(params.modelId, params.inputTokens, params.outputTokens);
    const entry: AttemptCost = {
      attemptId: `${params.taskId}-${params.attemptNumber}`,
      taskId: params.taskId,
      attemptNumber: params.attemptNumber,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalTokens: params.inputTokens + params.outputTokens,
      estimatedCostUsd: cost,
      durationMs: params.durationMs,
      modelId: params.modelId,
      isRetry: params.isRetry,
      errorTaxonomy: params.errorTaxonomy,
      timestamp: Date.now(),
    };
    this.attempts.push(entry);
    return entry;
  }

  markTaskOutcome(taskId: string, succeeded: boolean): void {
    this.taskOutcomes.set(taskId, succeeded);
  }

  isOverBudget(taskId: string): { overBudget: boolean; reason?: string } {
    const taskAttempts = this.attempts.filter((a) => a.taskId === taskId);
    const totalCost = taskAttempts.reduce((s, a) => s + a.estimatedCostUsd, 0);
    const totalTokens = taskAttempts.reduce((s, a) => s + a.totalTokens, 0);

    if (totalCost > this.budget.maxCostPerTaskUsd) {
      return {
        overBudget: true,
        reason: `Task cost $${totalCost.toFixed(4)} exceeds budget $${this.budget.maxCostPerTaskUsd}`,
      };
    }
    if (totalTokens > this.budget.maxTokensPerTask) {
      return {
        overBudget: true,
        reason: `Task used ${totalTokens} tokens, exceeds budget ${this.budget.maxTokensPerTask}`,
      };
    }
    const globalCost = this.attempts.reduce((s, a) => s + a.estimatedCostUsd, 0);
    if (globalCost > this.budget.maxTotalCostUsd) {
      return {
        overBudget: true,
        reason: `Global cost $${globalCost.toFixed(4)} exceeds budget $${this.budget.maxTotalCostUsd}`,
      };
    }
    return { overBudget: false };
  }

  getTaskSummary(taskId: string): TaskCostSummary {
    const taskAttempts = this.attempts.filter((a) => a.taskId === taskId);
    const failedAttempts = taskAttempts.filter((a) => a.errorTaxonomy !== undefined);
    return {
      taskId,
      attempts: taskAttempts,
      totalCostUsd: taskAttempts.reduce((s, a) => s + a.estimatedCostUsd, 0),
      totalTokens: taskAttempts.reduce((s, a) => s + a.totalTokens, 0),
      totalDurationMs: taskAttempts.reduce((s, a) => s + a.durationMs, 0),
      wastedCostUsd: failedAttempts.reduce((s, a) => s + a.estimatedCostUsd, 0),
      wastedTokens: failedAttempts.reduce((s, a) => s + a.totalTokens, 0),
      succeeded: this.taskOutcomes.get(taskId) ?? false,
    };
  }

  getAggregateStats(): {
    totalAttempts: number;
    totalRetries: number;
    totalCostUsd: number;
    wastedCostUsd: number;
    totalTokens: number;
    wastedTokens: number;
    retryRate: number;
    taskCount: number;
    successRate: number;
  } {
    const retries = this.attempts.filter((a) => a.isRetry);
    const failed = this.attempts.filter((a) => a.errorTaxonomy !== undefined);
    const taskIds = new Set(this.attempts.map((a) => a.taskId));
    const succeededCount = Array.from(taskIds).filter(
      (id) => this.taskOutcomes.get(id) === true,
    ).length;

    return {
      totalAttempts: this.attempts.length,
      totalRetries: retries.length,
      totalCostUsd: this.attempts.reduce((s, a) => s + a.estimatedCostUsd, 0),
      wastedCostUsd: failed.reduce((s, a) => s + a.estimatedCostUsd, 0),
      totalTokens: this.attempts.reduce((s, a) => s + a.totalTokens, 0),
      wastedTokens: failed.reduce((s, a) => s + a.totalTokens, 0),
      retryRate: this.attempts.length > 0 ? retries.length / this.attempts.length : 0,
      taskCount: taskIds.size,
      successRate: taskIds.size > 0 ? succeededCount / taskIds.size : 0,
    };
  }

  getAllAttempts(): AttemptCost[] {
    return [...this.attempts];
  }

  reset(): void {
    this.attempts = [];
    this.taskOutcomes.clear();
  }
}
