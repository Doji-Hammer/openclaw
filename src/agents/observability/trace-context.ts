/**
 * Trace Context — Observability
 *
 * Generates trace IDs and provides propagation context for
 * correlating operations across components.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

export type TraceContext = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startedAt: number;
  attributes: Record<string, string | number | boolean>;
};

const traceStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Generate a random trace ID (32 hex chars = 128 bits).
 */
export function generateTraceId(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Generate a random span ID (16 hex chars = 64 bits).
 */
export function generateSpanId(): string {
  return crypto.randomBytes(8).toString("hex");
}

/**
 * Create a new trace context.
 */
export function createTraceContext(opts?: {
  traceId?: string;
  parentSpanId?: string;
  attributes?: Record<string, string | number | boolean>;
}): TraceContext {
  return {
    traceId: opts?.traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: opts?.parentSpanId,
    startedAt: Date.now(),
    attributes: opts?.attributes ?? {},
  };
}

/**
 * Create a child span within the same trace.
 */
export function createChildSpan(
  parent: TraceContext,
  attributes?: Record<string, string | number | boolean>,
): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: generateSpanId(),
    parentSpanId: parent.spanId,
    startedAt: Date.now(),
    attributes: { ...parent.attributes, ...attributes },
  };
}

/**
 * Run a function within a trace context (AsyncLocalStorage).
 */
export function withTraceContext<T>(ctx: TraceContext, fn: () => T): T {
  return traceStorage.run(ctx, fn);
}

/**
 * Get the current trace context from AsyncLocalStorage.
 */
export function currentTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

/**
 * Get the current trace ID, or undefined if not in a trace context.
 */
export function currentTraceId(): string | undefined {
  return traceStorage.getStore()?.traceId;
}

/**
 * Compute elapsed time from a trace context.
 */
export function elapsed(ctx: TraceContext): number {
  return Date.now() - ctx.startedAt;
}
