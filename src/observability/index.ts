/**
 * OpenClaw Observability Module - Milestone B
 *
 * End-to-end tracing and telemetry for data-driven routing decisions.
 *
 * ## Overview
 *
 * This module provides:
 *
 * - **Trace ID propagation** (B1-B5): Automatic trace ID generation and propagation
 *   through Dispatcher → Planner → Executor → Retriever chains.
 *
 * - **Per-call telemetry** (B6): Capture latency, tokens, errors, and escalation
 *   codes for every model invocation.
 *
 * - **SQLite storage** (B7): Persistent, queryable telemetry storage optimized
 *   for aggregation queries.
 *
 * - **Routing scoreboard** (B8): p50/p95 latency, failure rates, and escalation
 *   frequency views for optimization decisions.
 *
 * ## Usage
 *
 * ```ts
 * import {
 *   withTraceContext,
 *   generateTraceId,
 *   startTelemetrySession,
 *   completeTelemetrySession,
 *   printScoreboard,
 * } from "./observability/index.js";
 *
 * // Create trace context for a request
 * const traceId = generateTraceId();
 * await withTraceContext(
 *   { traceId, requestId: traceId, source: "dispatcher", startedAt: Date.now() },
 *   async () => {
 *     // All calls within this context automatically capture telemetry
 *     const sessionId = startTelemetrySession({
 *       traceId,
 *       requestId: traceId,
 *       modelId: "claude-opus-4-6",
 *       provider: "anthropic",
 *       role: "executor",
 *     });
 *
 *     try {
 *       const result = await runModel(...);
 *       completeTelemetrySession(sessionId, {
 *         status: "success",
 *         promptTokens: result.usage.input,
 *         completionTokens: result.usage.output,
 *       });
 *     } catch (error) {
 *       completeTelemetrySession(sessionId, {
 *         status: "failure",
 *         errorKind: "model_failure",
 *         errorMessage: error.message,
 *       });
 *     }
 *   },
 * );
 *
 * // View scoreboard
 * printScoreboard(24); // Last 24 hours
 * ```
 *
 * @module observability
 */

// Trace ID management (B1)
export {
  generateTraceId,
  traceContextStorage,
  getCurrentTraceContext,
  getCurrentTraceId,
  withTraceContext,
  createChildTraceContext,
  type TraceContext,
} from "./types.js";

// Types (shared)
export type {
  CallTelemetry,
  RoutingMetrics,
  RoutingScoreboard,
  calculatePercentiles,
  formatTelemetryRecord,
} from "./types.js";

// Telemetry logging (B6)
export {
  startTelemetrySession,
  completeTelemetrySession,
  updateTelemetrySession,
  cancelTelemetrySession,
  autoStartTelemetry,
  getActiveTelemetryCount,
  cleanupStaleSessions,
} from "./telemetry.js";

// Storage backend (B7)
export {
  getTelemetryDb,
  closeTelemetryDb,
  storeTelemetry,
  createTelemetryRecord,
  getTelemetryByTraceId,
  queryTelemetry,
  aggregateMetrics,
  buildRoutingScoreboard,
  cleanupOldTelemetry,
  type TelemetryQuery,
} from "./storage.js";

// Scoreboard view (B8)
export {
  formatScoreboard,
  printScoreboard,
  getScoreboard,
  exportScoreboardToJson,
  exportTelemetryToCsv,
  detectRegressions,
  formatRegressionAlerts,
  type RegressionAlert,
} from "./scoreboard.js";
