/**
 * Telemetry storage backend using SQLite (B7)
 *
 * Provides persistent storage for per-call telemetry data.
 * Optimized for the routing scoreboard aggregation queries.
 *
 * @module observability/storage
 */

import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CallTelemetry, RoutingMetrics, RoutingScoreboard } from "./types.js";
import { STATE_DIR } from "../config/paths.js";

const TELEMETRY_DB_NAME = "telemetry.db";

// SQL Schema
const CREATE_TABLES_SQL = `
-- Main telemetry table
CREATE TABLE IF NOT EXISTS call_telemetry (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  session_id TEXT,
  session_key TEXT,
  model_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  role TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  latency_ms INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  total_tokens INTEGER,
  retry_count INTEGER DEFAULT 0,
  escalation_codes TEXT, -- JSON array
  artifact_bytes INTEGER,
  status TEXT NOT NULL,
  error_kind TEXT,
  error_message TEXT,
  local_memory_pressure TEXT,
  stop_reason TEXT,
  is_subagent INTEGER DEFAULT 0,
  subagent_label TEXT,
  lane TEXT
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_trace_id ON call_telemetry(trace_id);
CREATE INDEX IF NOT EXISTS idx_started_at ON call_telemetry(started_at);
CREATE INDEX IF NOT EXISTS idx_model_role ON call_telemetry(model_id, role);
CREATE INDEX IF NOT EXISTS idx_status ON call_telemetry(status);
CREATE INDEX IF NOT EXISTS idx_provider ON call_telemetry(provider);

-- Metadata table for cleanup tracking
CREATE TABLE IF NOT EXISTS telemetry_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let dbInstance: DatabaseSync | null = null;

/**
 * Get the telemetry database instance (singleton).
 */
export function getTelemetryDb(): DatabaseSync {
  if (!dbInstance) {
    const dbPath = `${STATE_DIR}/${TELEMETRY_DB_NAME}`;
    fsSync.mkdirSync(path.dirname(dbPath), { recursive: true });
    dbInstance = new DatabaseSync(dbPath);
    initializeTables(dbInstance);
  }
  return dbInstance;
}

/**
 * Initialize database tables.
 */
function initializeTables(db: DatabaseSync): void {
  db.exec(CREATE_TABLES_SQL);
}

/**
 * Close the telemetry database connection.
 */
export function closeTelemetryDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Store a telemetry record (B6).
 */
export function storeTelemetry(record: CallTelemetry): void {
  const db = getTelemetryDb();

  const stmt = db.prepare(`
    INSERT INTO call_telemetry (
      id, trace_id, request_id, session_id, session_key,
      model_id, provider, role, started_at, completed_at, latency_ms,
      prompt_tokens, completion_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
      retry_count, escalation_codes, artifact_bytes, status, error_kind, error_message,
      local_memory_pressure, stop_reason, is_subagent, subagent_label, lane
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    record.id,
    record.traceId,
    record.requestId,
    record.sessionId ?? null,
    record.sessionKey ?? null,
    record.modelId,
    record.provider,
    record.role,
    record.startedAt,
    record.completedAt ?? null,
    record.latencyMs ?? null,
    record.promptTokens ?? null,
    record.completionTokens ?? null,
    record.cacheReadTokens ?? null,
    record.cacheWriteTokens ?? null,
    record.totalTokens ?? null,
    record.retryCount,
    record.escalationCodes ? JSON.stringify(record.escalationCodes) : null,
    record.artifactBytes ?? null,
    record.status,
    record.errorKind ?? null,
    record.errorMessage ?? null,
    record.localMemoryPressure ?? null,
    record.stopReason ?? null,
    record.isSubagent ? 1 : 0,
    record.subagentLabel ?? null,
    record.lane ?? null,
  );
}

/**
 * Create a CallTelemetry record with required defaults.
 */
export function createTelemetryRecord(
  partial: Omit<CallTelemetry, "id" | "startedAt" | "retryCount" | "isSubagent" | "status"> &
    Partial<Pick<CallTelemetry, "startedAt" | "retryCount" | "isSubagent" | "status">>,
): CallTelemetry {
  return {
    id: randomUUID(),
    startedAt: Date.now(),
    retryCount: 0,
    isSubagent: false,
    status: "success",
    ...partial,
  };
}

/**
 * Query telemetry records by trace ID.
 */
export function getTelemetryByTraceId(traceId: string): CallTelemetry[] {
  const db = getTelemetryDb();
  const stmt = db.prepare("SELECT * FROM call_telemetry WHERE trace_id = ? ORDER BY started_at");
  const rows = stmt.all(traceId) as Array<Record<string, unknown>>;
  return rows.map(rowToTelemetry);
}

/**
 * Query telemetry records with filters.
 */
export interface TelemetryQuery {
  traceId?: string;
  requestId?: string;
  sessionId?: string;
  modelId?: string;
  provider?: string;
  role?: string;
  status?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

export function queryTelemetry(query: TelemetryQuery): CallTelemetry[] {
  const db = getTelemetryDb();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.traceId) {
    conditions.push("trace_id = ?");
    params.push(query.traceId);
  }
  if (query.requestId) {
    conditions.push("request_id = ?");
    params.push(query.requestId);
  }
  if (query.sessionId) {
    conditions.push("session_id = ?");
    params.push(query.sessionId);
  }
  if (query.modelId) {
    conditions.push("model_id = ?");
    params.push(query.modelId);
  }
  if (query.provider) {
    conditions.push("provider = ?");
    params.push(query.provider);
  }
  if (query.role) {
    conditions.push("role = ?");
    params.push(query.role);
  }
  if (query.status) {
    conditions.push("status = ?");
    params.push(query.status);
  }
  if (query.startTime) {
    conditions.push("started_at >= ?");
    params.push(query.startTime);
  }
  if (query.endTime) {
    conditions.push("started_at <= ?");
    params.push(query.endTime);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderClause = "ORDER BY started_at DESC";
  const limitClause = query.limit ? `LIMIT ?` : "";
  const offsetClause = query.offset ? `OFFSET ?` : "";

  if (query.limit) params.push(query.limit);
  if (query.offset) params.push(query.offset);

  const sql = `SELECT * FROM call_telemetry ${whereClause} ${orderClause} ${limitClause} ${offsetClause}`;
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as Array<Record<string, unknown>>;
  return rows.map(rowToTelemetry);
}

/**
 * Aggregate metrics for the routing scoreboard (B8).
 */
export function aggregateMetrics(periodHours: number = 24, endTime?: number): RoutingMetrics[] {
  const db = getTelemetryDb();
  const end = endTime ?? Date.now();
  const start = end - periodHours * 60 * 60 * 1000;

  const stmt = db.prepare(`
    SELECT
      model_id,
      provider,
      role,
      COUNT(*) as total_calls,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_calls,
      SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failure_calls,
      AVG(latency_ms) as avg_latency,
      AVG(prompt_tokens) as avg_prompt_tokens,
      AVG(completion_tokens) as avg_completion_tokens,
      AVG(total_tokens) as avg_total_tokens,
      GROUP_CONCAT(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END, ',') as latencies
    FROM call_telemetry
    WHERE started_at >= ? AND started_at <= ?
    GROUP BY model_id, provider, role
  `);

  const rows = stmt.all(start, end) as Array<{
    model_id: string;
    provider: string;
    role: string;
    total_calls: number;
    success_calls: number;
    failure_calls: number;
    avg_latency: number | null;
    avg_prompt_tokens: number | null;
    avg_completion_tokens: number | null;
    avg_total_tokens: number | null;
    latencies: string | null;
  }>;

  return rows.map((row) => {
    const latencies = row.latencies
      ? row.latencies
          .split(",")
          .map((n) => parseInt(n, 10))
          .filter((n) => !isNaN(n))
      : [];

    // Calculate percentiles
    const sorted = [...latencies].sort((a, b) => a - b);
    const getP = (p: number) => {
      if (sorted.length === 0) return 0;
      const idx = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, idx)];
    };

    // Get error breakdown
    const errorStmt = db.prepare(`
      SELECT error_kind, COUNT(*) as count
      FROM call_telemetry
      WHERE model_id = ? AND provider = ? AND role = ?
        AND started_at >= ? AND started_at <= ?
        AND status = 'failure'
      GROUP BY error_kind
    `);
    const errorRows = errorStmt.all(row.model_id, row.provider, row.role, start, end) as Array<{
      error_kind: string;
      count: number;
    }>;
    const errorBreakdown: Record<string, number> = {};
    for (const e of errorRows) {
      errorBreakdown[e.error_kind] = e.count;
    }

    // Get escalation reasons
    const escStmt = db.prepare(`
      SELECT escalation_codes
      FROM call_telemetry
      WHERE model_id = ? AND provider = ? AND role = ?
        AND started_at >= ? AND started_at <= ?
        AND escalation_codes IS NOT NULL
    `);
    const escRows = escStmt.all(row.model_id, row.provider, row.role, start, end) as Array<{
      escalation_codes: string;
    }>;
    const escalationReasons: Record<string, number> = {};
    for (const e of escRows) {
      try {
        const codes = JSON.parse(e.escalation_codes) as string[];
        for (const code of codes) {
          escalationReasons[code] = (escalationReasons[code] || 0) + 1;
        }
      } catch {
        // Ignore malformed JSON
      }
    }

    return {
      modelId: row.model_id,
      provider: row.provider,
      role: row.role,
      totalCalls: row.total_calls,
      successCalls: row.success_calls,
      failureCalls: row.failure_calls,
      latencyP50: getP(50),
      latencyP95: getP(95),
      latencyP99: getP(99),
      avgPromptTokens: Math.round(row.avg_prompt_tokens ?? 0),
      avgCompletionTokens: Math.round(row.avg_completion_tokens ?? 0),
      avgTotalTokens: Math.round(row.avg_total_tokens ?? 0),
      failureRate: row.total_calls > 0 ? row.failure_calls / row.total_calls : 0,
      errorBreakdown,
      escalationCount: Object.values(escalationReasons).reduce((a, b) => a + b, 0),
      escalationReasons,
      periodStart: start,
      periodEnd: end,
    };
  });
}

/**
 * Build the routing scoreboard view (B8).
 */
export function buildRoutingScoreboard(periodHours: number = 24): RoutingScoreboard {
  const entries = aggregateMetrics(periodHours);
  const totalCalls = entries.reduce((sum, e) => sum + e.totalCalls, 0);
  const overallFailures = entries.reduce((sum, e) => sum + e.failureCalls, 0);

  return {
    generatedAt: Date.now(),
    periodHours,
    entries,
    summary: {
      totalCalls,
      overallFailureRate: totalCalls > 0 ? overallFailures / totalCalls : 0,
      avgLatencyP50:
        entries.length > 0 ? entries.reduce((sum, e) => sum + e.latencyP50, 0) / entries.length : 0,
      avgLatencyP95:
        entries.length > 0 ? entries.reduce((sum, e) => sum + e.latencyP95, 0) / entries.length : 0,
    },
  };
}

/**
 * Clean up old telemetry records.
 */
export function cleanupOldTelemetry(retentionDays: number = 30): number {
  const db = getTelemetryDb();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  const stmt = db.prepare("DELETE FROM call_telemetry WHERE started_at < ?");
  const result = stmt.run(cutoff);
  // @ts-expect-error - changes is a property of the result object
  return result.changes as number;
}

/**
 * Convert a database row to a CallTelemetry object.
 */
function rowToTelemetry(row: Record<string, unknown>): CallTelemetry {
  return {
    id: String(row.id),
    traceId: String(row.trace_id),
    requestId: String(row.request_id),
    sessionId: row.session_id ? String(row.session_id) : undefined,
    sessionKey: row.session_key ? String(row.session_key) : undefined,
    modelId: String(row.model_id),
    provider: String(row.provider),
    role: String(row.role) as CallTelemetry["role"],
    startedAt: Number(row.started_at),
    completedAt: row.completed_at ? Number(row.completed_at) : undefined,
    latencyMs: row.latency_ms ? Number(row.latency_ms) : undefined,
    promptTokens: row.prompt_tokens ? Number(row.prompt_tokens) : undefined,
    completionTokens: row.completion_tokens ? Number(row.completion_tokens) : undefined,
    cacheReadTokens: row.cache_read_tokens ? Number(row.cache_read_tokens) : undefined,
    cacheWriteTokens: row.cache_write_tokens ? Number(row.cache_write_tokens) : undefined,
    totalTokens: row.total_tokens ? Number(row.total_tokens) : undefined,
    retryCount: Number(row.retry_count) || 0,
    escalationCodes: row.escalation_codes
      ? (JSON.parse(String(row.escalation_codes)) as string[])
      : undefined,
    artifactBytes: row.artifact_bytes ? Number(row.artifact_bytes) : undefined,
    status: String(row.status) as CallTelemetry["status"],
    errorKind: row.error_kind ? (String(row.error_kind) as CallTelemetry["errorKind"]) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    localMemoryPressure: row.local_memory_pressure
      ? (String(row.local_memory_pressure) as CallTelemetry["localMemoryPressure"])
      : undefined,
    stopReason: row.stop_reason ? String(row.stop_reason) : undefined,
    isSubagent: Boolean(row.is_subagent),
    subagentLabel: row.subagent_label ? String(row.subagent_label) : undefined,
    lane: row.lane ? String(row.lane) : undefined,
  };
}
