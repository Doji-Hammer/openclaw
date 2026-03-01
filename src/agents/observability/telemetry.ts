/**
 * Telemetry — Observability
 *
 * Per-call telemetry logging: provider, model, latencyMs, tokens, success/fail, trace_id.
 */

import { createSubsystemLogger } from "../../logging/subsystem.js";
import { currentTraceId } from "./trace-context.js";

const log = createSubsystemLogger("telemetry");

export type TelemetryEvent = {
  /** Event type */
  type: "llm_call" | "tool_call" | "validation" | "escalation" | "custom";
  /** Provider name */
  provider?: string;
  /** Model identifier */
  model?: string;
  /** Latency in milliseconds */
  latencyMs?: number;
  /** Token counts */
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
  };
  /** Whether the call succeeded */
  success: boolean;
  /** Error message if failed */
  errorMessage?: string;
  /** Error category */
  errorCategory?: string;
  /** Trace ID for correlation */
  traceId?: string;
  /** Additional metadata */
  meta?: Record<string, unknown>;
};

const listeners: Array<(event: TelemetryEvent) => void> = [];

/**
 * Emit a telemetry event. Logs it and notifies listeners.
 */
export function emitTelemetry(event: Omit<TelemetryEvent, "traceId"> & { traceId?: string }): void {
  const enriched: TelemetryEvent = {
    ...event,
    traceId: event.traceId ?? currentTraceId(),
  };

  const level = enriched.success ? "debug" : "warn";
  log[level](
    `${enriched.type}: ${enriched.provider ?? "?"}/${enriched.model ?? "?"} ${enriched.success ? "ok" : "FAIL"} ${enriched.latencyMs ?? "?"}ms`,
    {
      ...enriched,
    },
  );

  for (const listener of listeners) {
    try {
      listener(enriched);
    } catch {
      // swallow listener errors
    }
  }
}

/**
 * Register a telemetry listener. Returns unsubscribe function.
 */
export function onTelemetry(fn: (event: TelemetryEvent) => void): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/**
 * Clear all listeners (for testing).
 */
export function clearTelemetryListeners(): void {
  listeners.length = 0;
}

/**
 * Helper: time an async operation and emit telemetry.
 */
export async function withTelemetry<T>(
  opts: {
    type: TelemetryEvent["type"];
    provider?: string;
    model?: string;
    meta?: Record<string, unknown>;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    emitTelemetry({
      ...opts,
      success: true,
      latencyMs: Date.now() - start,
    });
    return result;
  } catch (err) {
    emitTelemetry({
      ...opts,
      success: false,
      latencyMs: Date.now() - start,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
