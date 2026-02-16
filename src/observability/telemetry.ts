/**
 * Telemetry logging integration (B6)
 *
 * Captures per-call telemetry from model executions and stores
 * them for the routing scoreboard.
 *
 * @module observability/telemetry
 */

import type { CallTelemetry, TraceContext } from "./types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { createTelemetryRecord, storeTelemetry } from "./storage.js";
import { formatTelemetryRecord } from "./types.js";
import { getCurrentTraceContext } from "./types.js";

const log = createSubsystemLogger("observability/telemetry");

/**
 * Active telemetry sessions tracking in-flight calls.
 */
const activeSessions = new Map<string, Partial<CallTelemetry>>();

/**
 * Start a telemetry session for a model call.
 * Returns a session ID for completing the telemetry later.
 */
export function startTelemetrySession(params: {
  traceId: string;
  requestId: string;
  sessionId?: string;
  sessionKey?: string;
  modelId: string;
  provider: string;
  role: CallTelemetry["role"];
  isSubagent?: boolean;
  subagentLabel?: string;
  lane?: string;
  artifactBytes?: number;
}): string {
  const record = createTelemetryRecord({
    traceId: params.traceId,
    requestId: params.requestId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    modelId: params.modelId,
    provider: params.provider,
    role: params.role,
    isSubagent: params.isSubagent ?? false,
    subagentLabel: params.subagentLabel,
    lane: params.lane,
    artifactBytes: params.artifactBytes,
  });

  activeSessions.set(record.id, record);
  return record.id;
}

/**
 * Complete a telemetry session with the results.
 */
export function completeTelemetrySession(
  sessionId: string,
  result: {
    status: CallTelemetry["status"];
    errorKind?: CallTelemetry["errorKind"];
    errorMessage?: string;
    promptTokens?: number;
    completionTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalTokens?: number;
    stopReason?: string;
    retryCount?: number;
    escalationCodes?: string[];
    localMemoryPressure?: CallTelemetry["localMemoryPressure"];
  },
): void {
  const session = activeSessions.get(sessionId);
  if (!session) {
    log.warn(`Telemetry session not found: ${sessionId}`);
    return;
  }

  const completedAt = Date.now();
  const latencyMs = completedAt - (session.startedAt ?? completedAt);

  const record: CallTelemetry = {
    ...(session as CallTelemetry),
    completedAt,
    latencyMs,
    status: result.status,
    errorKind: result.errorKind,
    errorMessage: result.errorMessage,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    cacheReadTokens: result.cacheReadTokens,
    cacheWriteTokens: result.cacheWriteTokens,
    totalTokens: result.totalTokens,
    stopReason: result.stopReason,
    retryCount: result.retryCount ?? session.retryCount ?? 0,
    escalationCodes: result.escalationCodes,
    localMemoryPressure: result.localMemoryPressure,
  };

  // Store to SQLite
  try {
    storeTelemetry(record);
    log.debug(formatTelemetryRecord(record));
  } catch (err) {
    log.error(`Failed to store telemetry: ${err instanceof Error ? err.message : String(err)}`);
  }

  activeSessions.delete(sessionId);
}

/**
 * Update an active telemetry session with partial data.
 */
export function updateTelemetrySession(
  sessionId: string,
  updates: Partial<Pick<CallTelemetry, "escalationCodes" | "retryCount" | "artifactBytes">>,
): void {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return;
  }

  Object.assign(session, updates);
}

/**
 * Cancel an active telemetry session without recording.
 */
export function cancelTelemetrySession(sessionId: string): void {
  activeSessions.delete(sessionId);
}

/**
 * Auto-start telemetry from the current trace context.
 * Useful for integrating with existing code paths.
 */
export function autoStartTelemetry(params: {
  modelId: string;
  provider: string;
  role: CallTelemetry["role"];
  requestId?: string;
  sessionId?: string;
  sessionKey?: string;
  isSubagent?: boolean;
  subagentLabel?: string;
  lane?: string;
  artifactBytes?: number;
}): string | null {
  const ctx = getCurrentTraceContext();
  if (!ctx) {
    // No trace context - telemetry disabled or not initialized
    return null;
  }

  return startTelemetrySession({
    traceId: ctx.traceId,
    requestId: params.requestId ?? ctx.requestId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    modelId: params.modelId,
    provider: params.provider,
    role: params.role,
    isSubagent: params.isSubagent,
    subagentLabel: params.subagentLabel,
    lane: params.lane,
    artifactBytes: params.artifactBytes,
  });
}

/**
 * Get count of active telemetry sessions (for monitoring).
 */
export function getActiveTelemetryCount(): number {
  return activeSessions.size;
}

/**
 * Force cleanup of stale telemetry sessions (for recovery).
 */
export function cleanupStaleSessions(maxAgeMs: number = 5 * 60 * 1000): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [id, session] of activeSessions) {
    const age = now - (session.startedAt ?? 0);
    if (age > maxAgeMs) {
      activeSessions.delete(id);
      cleaned++;
    }
  }

  return cleaned;
}
