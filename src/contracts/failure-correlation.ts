/**
 * D7: Failure Correlation - Detect Cascading Failures
 *
 * @module contracts/failure-correlation
 */

import { ErrorTaxonomy } from "./error-taxonomy.js";

export interface FailureEvent {
  taskId: string;
  taxonomy: ErrorTaxonomy;
  message: string;
  modelId?: string;
  provider?: string;
  toolName?: string;
  timestamp: number;
}

export interface CorrelationAlert {
  type: "cascade" | "cluster" | "pattern";
  severity: "info" | "warning" | "critical";
  description: string;
  events: FailureEvent[];
  dimension: string;
  dimensionValue: string;
  detectedAt: number;
}

export interface CorrelationConfig {
  windowMs: number;
  cascadeThreshold: number;
  clusterThreshold: number;
  maxEvents: number;
}

const DEFAULT_CONFIG: CorrelationConfig = {
  windowMs: 60_000,
  cascadeThreshold: 5,
  clusterThreshold: 3,
  maxEvents: 500,
};

export class FailureCorrelator {
  private events: FailureEvent[] = [];
  private alerts: CorrelationAlert[] = [];
  private config: CorrelationConfig;

  constructor(config?: Partial<CorrelationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  recordFailure(event: Omit<FailureEvent, "timestamp">): CorrelationAlert[] {
    const fullEvent: FailureEvent = { ...event, timestamp: Date.now() };
    this.events.push(fullEvent);
    if (this.events.length > this.config.maxEvents) {
      this.events = this.events.slice(-this.config.maxEvents);
    }
    return this.analyze();
  }

  analyze(): CorrelationAlert[] {
    const now = Date.now();
    const recent = this.events.filter((e) => now - e.timestamp <= this.config.windowMs);
    const newAlerts: CorrelationAlert[] = [];

    // Cascade: too many failures in window
    if (recent.length >= this.config.cascadeThreshold) {
      newAlerts.push({
        type: "cascade",
        severity: "critical",
        description: `${recent.length} failures in ${this.config.windowMs / 1000}s window`,
        events: recent,
        dimension: "time_window",
        dimensionValue: `${this.config.windowMs}ms`,
        detectedAt: now,
      });
    }

    // Cluster by taxonomy
    for (const [key, events] of this.groupBy(recent, (e) => e.taxonomy)) {
      if (events.length >= this.config.clusterThreshold) {
        newAlerts.push({
          type: "cluster",
          severity: "warning",
          description: `${events.length} ${key} failures in ${this.config.windowMs / 1000}s`,
          events,
          dimension: "taxonomy",
          dimensionValue: key,
          detectedAt: now,
        });
      }
    }

    // Cluster by model
    for (const [key, events] of this.groupBy(
      recent.filter((e) => e.modelId),
      (e) => e.modelId!,
    )) {
      if (events.length >= this.config.clusterThreshold) {
        newAlerts.push({
          type: "cluster",
          severity: "warning",
          description: `${events.length} failures for model ${key}`,
          events,
          dimension: "model",
          dimensionValue: key,
          detectedAt: now,
        });
      }
    }

    // Cluster by provider
    for (const [key, events] of this.groupBy(
      recent.filter((e) => e.provider),
      (e) => e.provider!,
    )) {
      if (events.length >= this.config.clusterThreshold) {
        newAlerts.push({
          type: "cluster",
          severity: "warning",
          description: `${events.length} failures for provider ${key}`,
          events,
          dimension: "provider",
          dimensionValue: key,
          detectedAt: now,
        });
      }
    }

    // Cluster by tool
    for (const [key, events] of this.groupBy(
      recent.filter((e) => e.toolName),
      (e) => e.toolName!,
    )) {
      if (events.length >= this.config.clusterThreshold) {
        newAlerts.push({
          type: "cluster",
          severity: "warning",
          description: `${events.length} failures for tool ${key}`,
          events,
          dimension: "tool",
          dimensionValue: key,
          detectedAt: now,
        });
      }
    }

    // Pattern: same message repeated
    for (const [msg, events] of this.groupBy(recent, (e) => e.message)) {
      if (events.length >= this.config.clusterThreshold) {
        newAlerts.push({
          type: "pattern",
          severity: "warning",
          description: `Same error "${msg.slice(0, 80)}" repeated ${events.length} times`,
          events,
          dimension: "message",
          dimensionValue: msg,
          detectedAt: now,
        });
      }
    }

    // Deduplicate and store
    for (const alert of newAlerts) {
      const key = `${alert.type}:${alert.dimension}:${alert.dimensionValue}`;
      const idx = this.alerts.findIndex(
        (a) => `${a.type}:${a.dimension}:${a.dimensionValue}` === key,
      );
      if (idx >= 0) this.alerts[idx] = alert;
      else this.alerts.push(alert);
    }

    return newAlerts;
  }

  getAlerts(): CorrelationAlert[] {
    return [...this.alerts];
  }

  getActiveAlerts(): CorrelationAlert[] {
    const cutoff = Date.now() - this.config.windowMs;
    return this.alerts.filter((a) => a.detectedAt >= cutoff);
  }

  isCascading(): boolean {
    return this.getActiveAlerts().some((a) => a.type === "cascade");
  }

  getEvents(): FailureEvent[] {
    return [...this.events];
  }

  reset(): void {
    this.events = [];
    this.alerts = [];
  }

  private groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const item of items) {
      const key = keyFn(item);
      const group = map.get(key);
      if (group) group.push(item);
      else map.set(key, [item]);
    }
    return map;
  }
}
