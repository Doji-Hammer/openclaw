/**
 * Scoreboard — Observability
 *
 * In-memory scoreboard tracking success/fail rates per provider/model.
 */

import { type TelemetryEvent, onTelemetry } from "./telemetry.js";

export type ScoreEntry = {
  provider: string;
  model: string;
  successCount: number;
  failCount: number;
  totalLatencyMs: number;
  totalTokensIn: number;
  totalTokensOut: number;
  lastEventAt: number;
};

export type ScoreboardSnapshot = {
  entries: ScoreEntry[];
  totalEvents: number;
  uptimeSince: number;
};

function makeKey(provider: string, model: string): string {
  return `${provider}::${model}`;
}

class Scoreboard {
  private entries = new Map<string, ScoreEntry>();
  private totalEvents = 0;
  private uptimeSince = Date.now();
  private unsubscribe: (() => void) | null = null;

  /**
   * Start listening to telemetry events.
   */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = onTelemetry((event) => this.record(event));
  }

  /**
   * Stop listening.
   */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Record a telemetry event.
   */
  record(event: TelemetryEvent): void {
    const provider = event.provider ?? "unknown";
    const model = event.model ?? "unknown";
    const key = makeKey(provider, model);

    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        provider,
        model,
        successCount: 0,
        failCount: 0,
        totalLatencyMs: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        lastEventAt: Date.now(),
      };
      this.entries.set(key, entry);
    }

    if (event.success) {
      entry.successCount++;
    } else {
      entry.failCount++;
    }
    entry.totalLatencyMs += event.latencyMs ?? 0;
    entry.totalTokensIn += event.tokens?.input ?? 0;
    entry.totalTokensOut += event.tokens?.output ?? 0;
    entry.lastEventAt = Date.now();
    this.totalEvents++;
  }

  /**
   * Get a snapshot of current scores.
   */
  snapshot(): ScoreboardSnapshot {
    return {
      entries: Array.from(this.entries.values()),
      totalEvents: this.totalEvents,
      uptimeSince: this.uptimeSince,
    };
  }

  /**
   * Get stats for a specific provider/model.
   */
  get(provider: string, model: string): ScoreEntry | undefined {
    return this.entries.get(makeKey(provider, model));
  }

  /**
   * Get success rate for a provider/model (0-1, or undefined if no data).
   */
  successRate(provider: string, model: string): number | undefined {
    const entry = this.get(provider, model);
    if (!entry) return undefined;
    const total = entry.successCount + entry.failCount;
    return total === 0 ? undefined : entry.successCount / total;
  }

  /**
   * Get average latency for a provider/model.
   */
  avgLatency(provider: string, model: string): number | undefined {
    const entry = this.get(provider, model);
    if (!entry) return undefined;
    const total = entry.successCount + entry.failCount;
    return total === 0 ? undefined : entry.totalLatencyMs / total;
  }

  /**
   * Reset all data.
   */
  reset(): void {
    this.entries.clear();
    this.totalEvents = 0;
    this.uptimeSince = Date.now();
  }
}

/** Singleton scoreboard instance. */
export const scoreboard = new Scoreboard();

/** Create a new independent scoreboard (for testing). */
export function createScoreboard(): Scoreboard {
  return new Scoreboard();
}
