/**
 * Observability module for OpenClaw - Milestone B
 *
 * Provides end-to-end tracing and telemetry for all routing decisions.
 * This makes the system observable and enables data-driven optimization.
 *
 * @module observability
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

// ============================================================================
// Trace ID Management (B1)
// ============================================================================

/**
 * Generate a new trace ID for a user request.
 * Uses UUID v4 for uniqueness and traceability.
 */
export function generateTraceId(): string {
  return randomUUID();
}

/**
 * AsyncLocalStorage for trace context propagation through the call stack.
 * This allows automatic trace ID propagation without explicit parameter passing.
 */
export const traceContextStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Context carried throughout a request's lifecycle.
 */
export interface TraceContext {
  /** The root trace ID for this request */
  traceId: string;
  /** The request ID (may differ from trace ID for retries) */
  requestId: string;
  /** Component that created this context */
  source: "dispatcher" | "planner" | "executor" | "retriever" | "subagent";
  /** Timestamp when the trace started */
  startedAt: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Get the current trace context from AsyncLocalStorage.
 * Returns null if not within a traced context.
 */
export function getCurrentTraceContext(): TraceContext | null {
  return traceContextStorage.getStore() ?? null;
}

/**
 * Get the current trace ID or return a fallback if not in a traced context.
 */
export function getCurrentTraceId(fallback = "unknown"): string {
  return getCurrentTraceContext()?.traceId ?? fallback;
}

/**
 * Execute a function within a trace context.
 * This ensures trace ID propagation through async boundaries.
 */
export async function withTraceContext<T>(context: TraceContext, fn: () => Promise<T>): Promise<T> {
  return traceContextStorage.run(context, fn);
}

/**
 * Create a child trace context for sub-operations (e.g., subagents).
 */
export function createChildTraceContext(
  parent: TraceContext,
  source: TraceContext["source"],
): TraceContext {
  return {
    ...parent,
    source,
    // Note: traceId stays the same for child contexts (same request)
    // requestId may differ for retries
  };
}

// ============================================================================
// Telemetry Types (B6)
// ============================================================================

/**
 * Per-call telemetry record for model invocations.
 * This captures the data needed for the routing scoreboard.
 */
export interface CallTelemetry {
  /** Unique telemetry record ID */
  id: string;
  /** Trace ID linking to the request */
  traceId: string;
  /** Request ID */
  requestId: string;
  /** Session identifier */
  sessionId?: string;
  /** Session key */
  sessionKey?: string;

  // Model identification
  /** Model identifier (e.g., "claude-opus-4-6") */
  modelId: string;
  /** Provider identifier (e.g., "anthropic") */
  provider: string;
  /** Role in the routing decision */
  role: "dispatcher" | "planner" | "executor" | "retriever" | "subagent";

  // Timing
  /** Timestamp when the call started */
  startedAt: number;
  /** Timestamp when the call completed */
  completedAt?: number;
  /** Latency in milliseconds */
  latencyMs?: number;

  // Token usage
  /** Input/prompt tokens */
  promptTokens?: number;
  /** Output/completion tokens */
  completionTokens?: number;
  /** Cache read tokens (if applicable) */
  cacheReadTokens?: number;
  /** Cache write tokens (if applicable) */
  cacheWriteTokens?: number;
  /** Total tokens consumed */
  totalTokens?: number;

  // Execution details
  /** Number of retries attempted */
  retryCount: number;
  /** Escalation reason codes */
  escalationCodes?: string[];
  /** Size of artifacts transmitted */
  artifactBytes?: number;

  // Status
  /** Final status of the call */
  status: "success" | "failure" | "cancelled" | "timeout";
  /** Error classification if status is 'failure' */
  errorKind?:
    | "schema_violation"
    | "model_failure"
    | "tool_failure"
    | "resource_exhaustion"
    | "invariant_violation"
    | "context_overflow"
    | "compaction_failure"
    | "timeout"
    | "abort"
    | "unknown";
  /** Error message if status is 'failure' */
  errorMessage?: string;

  // Local resource pressure
  /** Memory pressure indicator at time of call */
  localMemoryPressure?: "low" | "medium" | "high";
  /** Stop reason from the model */
  stopReason?: string;

  // Routing context
  /** Whether this was a subagent call */
  isSubagent: boolean;
  /** Subagent label if applicable */
  subagentLabel?: string;
  /** Lane identifier for queue tracking */
  lane?: string;
}

/**
 * Aggregated metrics for the routing scoreboard (B8).
 */
export interface RoutingMetrics {
  /** Model identifier */
  modelId: string;
  /** Provider identifier */
  provider: string;
  /** Role (dispatcher, planner, executor) */
  role: string;

  // Call counts
  totalCalls: number;
  successCalls: number;
  failureCalls: number;

  // Latency percentiles (in ms)
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;

  // Token usage averages
  avgPromptTokens: number;
  avgCompletionTokens: number;
  avgTotalTokens: number;

  // Failure rates
  failureRate: number; // 0-1
  errorBreakdown: Record<string, number>;

  // Escalation tracking
  escalationCount: number;
  escalationReasons: Record<string, number>;

  // Time range
  periodStart: number;
  periodEnd: number;
}

/**
 * Scoreboard view aggregating metrics across models.
 */
export interface RoutingScoreboard {
  /** When the scoreboard was generated */
  generatedAt: number;
  /** Time period covered */
  periodHours: number;
  /** Metrics per model-role combination */
  entries: RoutingMetrics[];
  /** Overall system metrics */
  summary: {
    totalCalls: number;
    overallFailureRate: number;
    avgLatencyP50: number;
    avgLatencyP95: number;
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate latency percentiles from an array of latency values.
 */
export function calculatePercentiles(latencies: number[]): {
  p50: number;
  p95: number;
  p99: number;
} {
  if (latencies.length === 0) {
    return { p50: 0, p95: 0, p99: 0 };
  }

  const sorted = [...latencies].toSorted((a, b) => a - b);
  const getPercentile = (p: number): number => {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  };

  return {
    p50: getPercentile(50),
    p95: getPercentile(95),
    p99: getPercentile(99),
  };
}

/**
 * Format a telemetry record for display/logging.
 */
export function formatTelemetryRecord(record: CallTelemetry): string {
  const latency = record.latencyMs ?? 0;
  const tokens = record.totalTokens ?? 0;
  const status = record.status;
  const error = record.errorKind ? ` [${record.errorKind}]` : "";

  return `[${record.traceId}] ${record.role} ${record.provider}/${record.modelId} ${status}${error} latency=${latency}ms tokens=${tokens} retries=${record.retryCount}`;
}
