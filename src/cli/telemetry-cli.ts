/**
 * Telemetry CLI registration (B8)
 *
 * @module cli/telemetry-cli
 */

import type { Command } from "commander";
import {
  telemetryCleanupCommand,
  telemetryQueryCommand,
  telemetryRegressionsCommand,
  telemetryScoreboardCommand,
  telemetryStatusCommand,
} from "../commands/telemetry.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { runCommandWithRuntime } from "./cli-utils.js";

function runTelemetryCommand(action: () => Promise<void>) {
  return runCommandWithRuntime(defaultRuntime, action);
}

export function registerTelemetryCli(program: Command) {
  const telemetry = program
    .command("telemetry")
    .description("Observability and routing telemetry")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/telemetry", "docs.openclaw.ai/cli/telemetry")}\n`,
    );

  telemetry
    .command("status")
    .description("Show telemetry system status")
    .action(async () => {
      await runTelemetryCommand(async () => {
        await telemetryStatusCommand({}, defaultRuntime);
      });
    });

  telemetry
    .command("scoreboard")
    .alias("board")
    .description("Display routing scoreboard with p50/p95 metrics")
    .option("-p, --period <hours>", "Time period in hours", "24")
    .option("--json", "Output as JSON")
    .option("--csv", "Export as CSV")
    .option("-o, --output <file>", "Output file (default: stdout)")
    .action(async (opts) => {
      await runTelemetryCommand(async () => {
        await telemetryScoreboardCommand(
          {
            period: parseInt(opts.period, 10),
            json: opts.json,
            csv: opts.csv,
            output: opts.output,
          },
          defaultRuntime,
        );
      });
    });

  telemetry
    .command("query")
    .description("Query telemetry records")
    .option("-t, --trace-id <id>", "Filter by trace ID")
    .option("-m, --model-id <id>", "Filter by model ID")
    .option("-p, --provider <name>", "Filter by provider")
    .option("-r, --role <role>", "Filter by role (dispatcher, planner, executor, retriever)")
    .option("-s, --status <status>", "Filter by status (success, failure, cancelled, timeout)")
    .option("--start-time <iso>", "Start time (ISO 8601)")
    .option("--end-time <iso>", "End time (ISO 8601)")
    .option("-l, --limit <n>", "Maximum records to return", "100")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      await runTelemetryCommand(async () => {
        await telemetryQueryCommand(
          {
            traceId: opts.traceId,
            modelId: opts.modelId,
            provider: opts.provider,
            role: opts.role,
            status: opts.status,
            startTime: opts.startTime,
            endTime: opts.endTime,
            limit: parseInt(opts.limit, 10),
            json: opts.json,
          },
          defaultRuntime,
        );
      });
    });

  telemetry
    .command("regressions")
    .description("Check for performance regressions")
    .option("-b, --baseline <hours>", "Baseline period in hours (default: 168 = 1 week)", "168")
    .option("-c, --current <hours>", "Current period in hours (default: 24)", "24")
    .option("--latency-threshold <pct>", "Latency increase threshold percentage", "50")
    .option(
      "--failure-threshold <pct>",
      "Failure rate increase threshold (percentage points)",
      "10",
    )
    .action(async (opts) => {
      await runTelemetryCommand(async () => {
        await telemetryRegressionsCommand(
          {
            baseline: parseInt(opts.baseline, 10),
            current: parseInt(opts.current, 10),
            latencyThreshold: parseInt(opts.latencyThreshold, 10),
            failureThreshold: parseInt(opts.failureThreshold, 10),
          },
          defaultRuntime,
        );
      });
    });

  telemetry
    .command("cleanup")
    .description("Clean up old telemetry data")
    .option("-r, --retention <days>", "Retention period in days", "30")
    .action(async (opts) => {
      await runTelemetryCommand(async () => {
        await telemetryCleanupCommand(
          {
            retention: parseInt(opts.retention, 10),
          },
          defaultRuntime,
        );
      });
    });
}
