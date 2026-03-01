/**
 * Escalation — Milestone D: Failure Economics
 *
 * When retries are exhausted, produce structured escalation info
 * for upstream consumers (logging, fallback chains, observability).
 */

import { categorizeError, type ErrorCategory } from "./error-taxonomy.js";

export type EscalationInfo = {
  /** Error category from taxonomy. */
  category: ErrorCategory;
  /** Provider that failed. */
  provider: string;
  /** Model that failed. */
  model: string;
  /** Total latency in ms from first attempt to escalation. */
  latencyMs: number;
  /** Number of retries attempted (0 = no retries, 1 = one retry). */
  retryCount: number;
  /** Original error message. */
  errorMessage: string;
  /** Error code if available. */
  errorCode?: string;
  /** HTTP status code if available. */
  httpStatus?: number;
  /** ISO timestamp of escalation. */
  escalatedAt: string;
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

function getErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function getStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const s = (err as { status?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
  if (typeof s === "number") return s;
  return undefined;
}

/**
 * Build structured escalation info from a failed request.
 */
export function escalate(
  err: unknown,
  ctx: {
    provider: string;
    model: string;
    retryCount: number;
    startedAt: number;
  },
): EscalationInfo {
  return {
    category: categorizeError(err),
    provider: ctx.provider,
    model: ctx.model,
    latencyMs: Date.now() - ctx.startedAt,
    retryCount: ctx.retryCount,
    errorMessage: getErrorMessage(err),
    errorCode: getErrorCode(err),
    httpStatus: getStatusCode(err),
    escalatedAt: new Date().toISOString(),
  };
}

/**
 * Format escalation info as a human-readable summary line.
 */
export function formatEscalation(info: EscalationInfo): string {
  const parts = [
    `[ESCALATION]`,
    `category=${info.category}`,
    `provider=${info.provider}`,
    `model=${info.model}`,
    `latency=${info.latencyMs}ms`,
    `retries=${info.retryCount}`,
  ];
  if (info.httpStatus) parts.push(`http=${info.httpStatus}`);
  if (info.errorCode) parts.push(`code=${info.errorCode}`);
  parts.push(`msg="${info.errorMessage}"`);
  return parts.join(" ");
}
