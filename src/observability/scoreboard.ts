/**
 * Routing scoreboard display (B8)
 *
 * CLI and programmatic views of routing metrics for
 * data-driven optimization decisions.
 *
 * @module observability/scoreboard
 */

import type { RoutingScoreboard, RoutingMetrics } from "./types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { buildRoutingScoreboard, queryTelemetry } from "./storage.js";

const log = createSubsystemLogger("observability/scoreboard");

/**
 * Format a scoreboard for console display.
 */
export function formatScoreboard(scoreboard: RoutingScoreboard): string {
  const lines: string[] = [];

  lines.push("╔══════════════════════════════════════════════════════════════════╗");
  lines.push("║              OPENCLAW ROUTING SCOREBOARD                         ║");
  lines.push("╠══════════════════════════════════════════════════════════════════╣");
  lines.push(
    `║ Generated: ${new Date(scoreboard.generatedAt).toISOString()}                      ║`,
  );
  lines.push(
    `║ Period:    Last ${scoreboard.periodHours} hours                                   ║`,
  );
  lines.push("╚══════════════════════════════════════════════════════════════════╝");
  lines.push("");

  // Summary
  lines.push("┌─────────────────────────────────────────────────────────────────┐");
  lines.push("│ SUMMARY                                                         │");
  lines.push("├─────────────────────────────────────────────────────────────────┤");
  lines.push(`│ Total Calls:        ${scoreboard.summary.totalCalls.toString().padEnd(40)}│`);
  lines.push(
    `│ Overall Failure:    ${(scoreboard.summary.overallFailureRate * 100).toFixed(2)}%${"".padEnd(38)}│`,
  );
  lines.push(
    `│ Avg Latency P50:    ${Math.round(scoreboard.summary.avgLatencyP50).toString().padEnd(40)}│`,
  );
  lines.push(
    `│ Avg Latency P95:    ${Math.round(scoreboard.summary.avgLatencyP95).toString().padEnd(40)}│`,
  );
  lines.push("└─────────────────────────────────────────────────────────────────┘");
  lines.push("");

  // Per-model breakdown
  if (scoreboard.entries.length === 0) {
    lines.push("No telemetry data available for the selected period.");
    return lines.join("\n");
  }

  // Group by role
  const byRole = new Map<string, RoutingMetrics[]>();
  for (const entry of scoreboard.entries) {
    const list = byRole.get(entry.role) ?? [];
    list.push(entry);
    byRole.set(entry.role, list);
  }

  for (const [role, entries] of byRole) {
    lines.push(`┌─────────────────────────────────────────────────────────────────┐`);
    lines.push(`│ ${role.toUpperCase().padEnd(62)}│`);
    lines.push("├─────────────────────────────────────────────────────────────────┤");
    lines.push("│ Model                    Provider    Calls  Fail%  P50    P95  │");
    lines.push("├─────────────────────────────────────────────────────────────────┤");

    for (const e of entries.sort((a, b) => b.totalCalls - a.totalCalls)) {
      const model = e.modelId.length > 20 ? e.modelId.slice(0, 17) + "..." : e.modelId;
      const provider = e.provider.length > 10 ? e.provider.slice(0, 7) + "..." : e.provider;
      const failRate = (e.failureRate * 100).toFixed(1);

      lines.push(
        `│ ${model.padEnd(24)} ${provider.padEnd(10)} ${e.totalCalls.toString().padStart(5)} ${failRate.padStart(5)}% ${e.latencyP50.toString().padStart(5)} ${e.latencyP95.toString().padStart(5)} │`,
      );
    }

    lines.push("└─────────────────────────────────────────────────────────────────┘");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Print the scoreboard to console.
 */
export function printScoreboard(periodHours: number = 24): void {
  const scoreboard = buildRoutingScoreboard(periodHours);
  log.raw(formatScoreboard(scoreboard));
}

/**
 * Get scoreboard as structured data (for API/UI consumption).
 */
export function getScoreboard(periodHours: number = 24): RoutingScoreboard {
  return buildRoutingScoreboard(periodHours);
}

/**
 * Export scoreboard to JSON.
 */
export function exportScoreboardToJson(periodHours: number = 24): string {
  const scoreboard = buildRoutingScoreboard(periodHours);
  return JSON.stringify(scoreboard, null, 2);
}

/**
 * Export telemetry to CSV format.
 */
export function exportTelemetryToCsv(startTime?: number, endTime?: number, limit?: number): string {
  const records = queryTelemetry({
    startTime,
    endTime,
    limit,
  });

  const headers = [
    "id",
    "trace_id",
    "request_id",
    "timestamp",
    "model_id",
    "provider",
    "role",
    "status",
    "latency_ms",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "error_kind",
  ];

  const lines: string[] = [headers.join(",")];

  for (const r of records) {
    const values = [
      r.id,
      r.traceId,
      r.requestId,
      new Date(r.startedAt).toISOString(),
      r.modelId,
      r.provider,
      r.role,
      r.status,
      r.latencyMs ?? "",
      r.promptTokens ?? "",
      r.completionTokens ?? "",
      r.totalTokens ?? "",
      r.errorKind ?? "",
    ];
    lines.push(values.join(","));
  }

  return lines.join("\n");
}

/**
 * Check for performance regressions.
 */
export interface RegressionAlert {
  severity: "warning" | "critical";
  metric: string;
  modelId: string;
  role: string;
  current: number;
  baseline: number;
  change: number; // percentage change
}

/**
 * Compare current metrics against a baseline period.
 */
export function detectRegressions(
  baselineHours: number = 168, // 1 week
  currentHours: number = 24, // 1 day
  thresholds: {
    latencyP95?: number; // percentage increase threshold
    failureRate?: number; // percentage point increase threshold
  } = {},
): RegressionAlert[] {
  const { latencyP95 = 50, failureRate = 10 } = thresholds;

  const now = Date.now();
  const currentEnd = now;
  const currentStart = now - currentHours * 60 * 60 * 1000;
  const baselineEnd = currentStart;
  const baselineStart = baselineEnd - baselineHours * 60 * 60 * 1000;

  const current = buildRoutingScoreboard(currentHours);
  const baseline = queryTelemetry({
    startTime: baselineStart,
    endTime: baselineEnd,
  });

  // Calculate baseline metrics
  const baselineByKey = new Map<
    string,
    { latencyP95: number; failureRate: number; totalCalls: number }
  >();

  for (const record of baseline) {
    const key = `${record.modelId}:${record.role}`;
    const existing = baselineByKey.get(key);

    if (existing) {
      // Weighted average
      const weight = record.latencyMs ?? 0;
      existing.latencyP95 =
        (existing.latencyP95 * existing.totalCalls + weight) / (existing.totalCalls + 1);
      existing.failureRate =
        (existing.failureRate * existing.totalCalls + (record.status === "failure" ? 1 : 0)) /
        (existing.totalCalls + 1);
      existing.totalCalls++;
    } else {
      baselineByKey.set(key, {
        latencyP95: record.latencyMs ?? 0,
        failureRate: record.status === "failure" ? 1 : 0,
        totalCalls: 1,
      });
    }
  }

  // Compare
  const alerts: RegressionAlert[] = [];

  for (const entry of current.entries) {
    const key = `${entry.modelId}:${entry.role}`;
    const base = baselineByKey.get(key);

    if (!base || base.totalCalls < 10) {
      continue; // Not enough baseline data
    }

    // Check latency regression
    if (base.latencyP95 > 0) {
      const latencyChange = ((entry.latencyP95 - base.latencyP95) / base.latencyP95) * 100;
      if (latencyChange > latencyP95) {
        alerts.push({
          severity: latencyChange > latencyP95 * 2 ? "critical" : "warning",
          metric: "latency_p95",
          modelId: entry.modelId,
          role: entry.role,
          current: entry.latencyP95,
          baseline: base.latencyP95,
          change: latencyChange,
        });
      }
    }

    // Check failure rate regression
    const failureDiff = (entry.failureRate - base.failureRate) * 100;
    if (failureDiff > failureRate) {
      alerts.push({
        severity: failureDiff > failureRate * 2 ? "critical" : "warning",
        metric: "failure_rate",
        modelId: entry.modelId,
        role: entry.role,
        current: entry.failureRate * 100,
        baseline: base.failureRate * 100,
        change: failureDiff,
      });
    }
  }

  return alerts.sort((a, b) => b.change - a.change);
}

/**
 * Format regression alerts for display.
 */
export function formatRegressionAlerts(alerts: RegressionAlert[]): string {
  if (alerts.length === 0) {
    return "No regressions detected.";
  }

  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════════════════════════════════╗");
  lines.push("║              PERFORMANCE REGRESSION ALERTS                       ║");
  lines.push("╚══════════════════════════════════════════════════════════════════╝");
  lines.push("");

  for (const alert of alerts) {
    const icon = alert.severity === "critical" ? "🔴" : "🟡";
    const metric = alert.metric === "latency_p95" ? "P95 Latency" : "Failure Rate";
    const unit = alert.metric === "latency_p95" ? "ms" : "%";

    lines.push(`${icon} ${alert.modelId} (${alert.role})`);
    lines.push(
      `   ${metric}: ${alert.current.toFixed(1)}${unit} (was ${alert.baseline.toFixed(1)}${unit})`,
    );
    lines.push(`   Change: +${alert.change.toFixed(1)}%`);
    lines.push("");
  }

  return lines.join("\n");
}
