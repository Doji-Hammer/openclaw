/**
 * Telemetry and scoreboard CLI commands (B8)
 *
 * Commands for viewing routing metrics and telemetry data.
 *
 * @module commands/telemetry
 */

import type { RuntimeEnv } from "../runtime.js";
import {
  printScoreboard,
  getScoreboard,
  exportScoreboardToJson,
  exportTelemetryToCsv,
  detectRegressions,
  formatRegressionAlerts,
  queryTelemetry,
  cleanupOldTelemetry,
} from "../observability/index.js";
import { defaultRuntime } from "../runtime.js";

export type TelemetryScoreboardOptions = {
  period?: number; // hours
  json?: boolean;
  csv?: boolean;
  output?: string;
};

export type TelemetryQueryOptions = {
  traceId?: string;
  modelId?: string;
  provider?: string;
  role?: string;
  status?: "success" | "failure" | "cancelled" | "timeout";
  startTime?: string; // ISO date string
  endTime?: string; // ISO date string
  limit?: number;
  json?: boolean;
};

export type TelemetryRegressionsOptions = {
  baseline?: number; // hours (default 168 = 1 week)
  current?: number; // hours (default 24 = 1 day)
  latencyThreshold?: number; // percentage increase (default 50)
  failureThreshold?: number; // percentage point increase (default 10)
};

export type TelemetryCleanupOptions = {
  retention?: number; // days (default 30)
};

/**
 * Display the routing scoreboard.
 */
export async function telemetryScoreboardCommand(
  opts: TelemetryScoreboardOptions = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const periodHours = opts.period ?? 24;

  if (opts.csv) {
    const csv = exportTelemetryToCsv(Date.now() - periodHours * 60 * 60 * 1000, Date.now());
    if (opts.output) {
      const fs = await import("node:fs/promises");
      await fs.writeFile(opts.output, csv, "utf-8");
      runtime.log(`Telemetry data exported to ${opts.output}`);
    } else {
      runtime.log(csv);
    }
    return;
  }

  if (opts.json) {
    const scoreboard = getScoreboard(periodHours);
    const output = exportScoreboardToJson(periodHours);
    if (opts.output) {
      const fs = await import("node:fs/promises");
      await fs.writeFile(opts.output, output, "utf-8");
      runtime.log(`Scoreboard exported to ${opts.output}`);
    } else {
      runtime.log(output);
    }
    return;
  }

  // Console output
  printScoreboard(periodHours);
}

/**
 * Query telemetry records.
 */
export async function telemetryQueryCommand(
  opts: TelemetryQueryOptions = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const records = queryTelemetry({
    traceId: opts.traceId,
    modelId: opts.modelId,
    provider: opts.provider,
    role: opts.role,
    status: opts.status,
    startTime: opts.startTime ? new Date(opts.startTime).getTime() : undefined,
    endTime: opts.endTime ? new Date(opts.endTime).getTime() : undefined,
    limit: opts.limit ?? 100,
  });

  if (opts.json) {
    runtime.log(JSON.stringify(records, null, 2));
    return;
  }

  // Format as table
  if (records.length === 0) {
    runtime.log("No telemetry records found.");
    return;
  }

  const lines: string[] = [];
  lines.push("Telemetry Records:");
  lines.push("-".repeat(120));
  lines.push(
    `${"Timestamp".padEnd(20)} ${"Trace ID".padEnd(12)} ${"Model".padEnd(25)} ${"Role".padEnd(10)} ${"Status".padEnd(10)} ${"Latency".padEnd(10)} ${"Tokens".padEnd(8)}`,
  );
  lines.push("-".repeat(120));

  for (const r of records) {
    const ts = new Date(r.startedAt).toISOString().slice(0, 19).replace("T", " ");
    const traceShort = r.traceId.slice(0, 8);
    const model = `${r.provider}/${r.modelId}`.slice(0, 24).padEnd(25);
    const role = r.role.slice(0, 9).padEnd(10);
    const status = r.status.slice(0, 9).padEnd(10);
    const latency = r.latencyMs ? `${r.latencyMs}ms`.padEnd(10) : "-".padEnd(10);
    const tokens = r.totalTokens?.toString().padEnd(8) ?? "-".padEnd(8);

    lines.push(`${ts} ${traceShort} ${model} ${role} ${status} ${latency} ${tokens}`);
  }

  lines.push("-".repeat(120));
  lines.push(`Total: ${records.length} records`);

  runtime.log(lines.join("\n"));
}

/**
 * Check for performance regressions.
 */
export async function telemetryRegressionsCommand(
  opts: TelemetryRegressionsOptions = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const baselineHours = opts.baseline ?? 168; // 1 week
  const currentHours = opts.current ?? 24; // 1 day

  const alerts = detectRegressions(baselineHours, currentHours, {
    latencyP95: opts.latencyThreshold ?? 50,
    failureRate: opts.failureThreshold ?? 10,
  });

  runtime.log(formatRegressionAlerts(alerts));
}

/**
 * Clean up old telemetry data.
 */
export async function telemetryCleanupCommand(
  opts: TelemetryCleanupOptions = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const retentionDays = opts.retention ?? 30;
  const deleted = cleanupOldTelemetry(retentionDays);
  runtime.log(`Cleaned up ${deleted} old telemetry records (retention: ${retentionDays} days)`);
}

/**
 * Show telemetry system status.
 */
export async function telemetryStatusCommand(
  _opts: Record<string, never> = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const { getTelemetryDb } = await import("../observability/storage.js");
  const { getActiveTelemetryCount } = await import("../observability/telemetry.js");

  const db = getTelemetryDb();

  // Get counts
  const totalCalls = db.prepare("SELECT COUNT(*) as count FROM call_telemetry").get() as {
    count: number;
  };
  const recentCalls = db
    .prepare("SELECT COUNT(*) as count FROM call_telemetry WHERE started_at > @since")
    .get({ since: Date.now() - 24 * 60 * 60 * 1000 }) as { count: number };
  const failedCalls = db
    .prepare(
      "SELECT COUNT(*) as count FROM call_telemetry WHERE status = 'failure' AND started_at > @since",
    )
    .get({ since: Date.now() - 24 * 60 * 60 * 1000 }) as { count: number };

  const activeCount = getActiveTelemetryCount();

  const lines: string[] = [];
  lines.push("Telemetry System Status:");
  lines.push("-".repeat(40));
  lines.push(`Total records: ${totalCalls.count}`);
  lines.push(`Last 24h calls: ${recentCalls.count}`);
  lines.push(`Last 24h failures: ${failedCalls.count}`);
  lines.push(`Active sessions: ${activeCount}`);

  if (recentCalls.count > 0) {
    const failureRate = ((failedCalls.count / recentCalls.count) * 100).toFixed(2);
    lines.push(`Failure rate: ${failureRate}%`);
  }

  lines.push("-".repeat(40));
  lines.push("Telemetry is actively recording model calls.");
  lines.push("Use 'openclaw telemetry scoreboard' to view routing metrics.");

  runtime.log(lines.join("\n"));
}
