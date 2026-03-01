/**
 * Error Taxonomy — Milestone D: Failure Economics
 *
 * Extends the existing FailoverReason with finer-grained categories
 * for retry/escalation decisions.
 */

import {
  isFailoverError,
  resolveFailoverReasonFromError,
  type FailoverError,
} from "./failover-error.js";
import type { FailoverReason } from "./pi-embedded-helpers.js";

/**
 * Extended error categories for failure economics.
 * Maps to FailoverReason where possible, adds network/invalid_request/server_error/unknown.
 */
export type ErrorCategory =
  | "rate_limit"
  | "auth"
  | "timeout"
  | "invalid_request"
  | "server_error"
  | "network"
  | "unknown";

/** Transient errors that are safe to retry (at most once). */
const TRANSIENT_CATEGORIES: ReadonlySet<ErrorCategory> = new Set([
  "rate_limit",
  "timeout",
  "server_error",
  "network",
]);

/** Non-transient errors that should never be retried. */
const PERMANENT_CATEGORIES: ReadonlySet<ErrorCategory> = new Set(["auth", "invalid_request"]);

const NETWORK_CODE_RE = /^(ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|EPIPE)$/;
const NETWORK_MSG_RE = /network error|fetch failed|dns lookup|socket hang up|ECONNREFUSED/i;
const SERVER_ERROR_RE = /\b5\d{2}\b|internal server error|service unavailable|bad gateway/i;

function getErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return "";
}

function getStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const s = (err as { status?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
  if (typeof s === "number") return s;
  if (typeof s === "string" && /^\d+$/.test(s)) return Number(s);
  return undefined;
}

/**
 * Map FailoverReason → ErrorCategory.
 */
function failoverReasonToCategory(reason: FailoverReason): ErrorCategory {
  switch (reason) {
    case "rate_limit":
      return "rate_limit";
    case "auth":
    case "billing":
      return "auth";
    case "timeout":
      return "timeout";
    case "format":
      return "invalid_request";
    case "unknown":
      return "unknown";
    default:
      return "unknown";
  }
}

/**
 * Categorize any error into an ErrorCategory.
 * Leverages existing FailoverError/FailoverReason classification,
 * then adds network and server_error detection.
 */
export function categorizeError(err: unknown): ErrorCategory {
  // 1. If it's already a FailoverError, use its reason
  if (isFailoverError(err)) {
    return failoverReasonToCategory(err.reason);
  }

  // 2. Try existing classification
  const reason = resolveFailoverReasonFromError(err);
  if (reason) {
    return failoverReasonToCategory(reason);
  }

  // 3. Check for network errors
  const code = getErrorCode(err);
  if (code && NETWORK_CODE_RE.test(code)) {
    return "network";
  }
  const message = getErrorMessage(err);
  if (message && NETWORK_MSG_RE.test(message)) {
    return "network";
  }

  // 4. Check for server errors (5xx)
  const status = getStatusCode(err);
  if (status && status >= 500 && status < 600) {
    return "server_error";
  }
  if (message && SERVER_ERROR_RE.test(message)) {
    return "server_error";
  }

  return "unknown";
}

/**
 * Whether a given error category is transient (retriable).
 */
export function isTransientCategory(category: ErrorCategory): boolean {
  return TRANSIENT_CATEGORIES.has(category);
}

/**
 * Whether a given error category is permanent (never retry).
 */
export function isPermanentCategory(category: ErrorCategory): boolean {
  return PERMANENT_CATEGORIES.has(category);
}

export { TRANSIENT_CATEGORIES, PERMANENT_CATEGORIES };
