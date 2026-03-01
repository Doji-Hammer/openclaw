/**
 * Retry Policy — Milestone D: Failure Economics
 *
 * Max-1-retry policy: categorize first, only retry transient errors, never more than once.
 */

import { categorizeError, isTransientCategory, type ErrorCategory } from "./error-taxonomy.js";
import { escalate, type EscalationInfo } from "./escalation.js";

export type RetryDecision = {
  /** Whether to retry the request. */
  shouldRetry: boolean;
  /** The error category determined by taxonomy. */
  category: ErrorCategory;
  /** Reason for the decision (human-readable). */
  reason: string;
};

export type RetryContext = {
  provider: string;
  model: string;
  /** Number of retries already attempted for this request (starts at 0). */
  retryCount: number;
  /** When the original request started (epoch ms). */
  startedAt: number;
};

/**
 * Decide whether to retry a failed request.
 *
 * Rules:
 * - Categorize the error first.
 * - Only retry transient errors (rate_limit, timeout, server_error, network).
 * - Never retry more than once (retryCount must be 0).
 * - "unknown" errors are NOT retried (conservative).
 */
export function shouldRetry(err: unknown, ctx: RetryContext): RetryDecision {
  const category = categorizeError(err);

  if (ctx.retryCount >= 1) {
    return {
      shouldRetry: false,
      category,
      reason: `Max retries exhausted (retryCount=${ctx.retryCount})`,
    };
  }

  if (isTransientCategory(category)) {
    return {
      shouldRetry: true,
      category,
      reason: `Transient error (${category}), retry #1 allowed`,
    };
  }

  return {
    shouldRetry: false,
    category,
    reason: `Non-retriable error category: ${category}`,
  };
}

/**
 * Execute a function with at-most-one-retry policy.
 * On exhaustion, escalates with structured error info.
 */
export async function executeWithRetry<T>(params: {
  provider: string;
  model: string;
  run: () => Promise<T>;
  onRetry?: (decision: RetryDecision, attempt: number) => void | Promise<void>;
  onEscalation?: (info: EscalationInfo) => void | Promise<void>;
}): Promise<T> {
  const startedAt = Date.now();
  let retryCount = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await params.run();
    } catch (err) {
      const ctx: RetryContext = {
        provider: params.provider,
        model: params.model,
        retryCount,
        startedAt,
      };
      const decision = shouldRetry(err, ctx);

      if (decision.shouldRetry) {
        retryCount++;
        await params.onRetry?.(decision, retryCount);
        continue;
      }

      // Exhausted — escalate
      const info = escalate(err, {
        provider: params.provider,
        model: params.model,
        retryCount,
        startedAt,
      });
      await params.onEscalation?.(info);
      throw err;
    }
  }
}
