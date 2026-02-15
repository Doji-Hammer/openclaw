/**
 * D6: Dead Letter Queue for Permanently Failed Tasks
 *
 * @module contracts/dead-letter-queue
 */

import type { RetryAttempt } from "./retry-budget.js";
import { ErrorTaxonomy } from "./error-taxonomy.js";

export enum DLQEntryStatus {
  PENDING = "pending",
  REVIEWING = "reviewing",
  RETRIED = "retried",
  DISCARDED = "discarded",
  RESOLVED = "resolved",
}

export interface DLQEntry {
  id: string;
  taskId: string;
  sessionId?: string;
  errorTaxonomy: ErrorTaxonomy;
  errorMessage: string;
  attempts: RetryAttempt[];
  originalPayload?: unknown;
  enqueuedAt: number;
  status: DLQEntryStatus;
  reason: "retries_exhausted" | "non_retryable" | "circuit_open" | "budget_exceeded" | "manual";
  notes?: string;
  updatedAt: number;
}

export interface DLQStats {
  total: number;
  byStatus: Record<DLQEntryStatus, number>;
  byTaxonomy: Record<string, number>;
  byReason: Record<string, number>;
  oldestPendingAgeMs: number | null;
}

export class DeadLetterQueue {
  private entries: DLQEntry[] = [];
  private nextId = 1;
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  enqueue(params: {
    taskId: string;
    sessionId?: string;
    errorTaxonomy: ErrorTaxonomy;
    errorMessage: string;
    attempts: RetryAttempt[];
    originalPayload?: unknown;
    reason: DLQEntry["reason"];
  }): DLQEntry {
    if (this.entries.length >= this.maxSize) {
      const evictIdx = this.entries.findIndex(
        (e) => e.status === DLQEntryStatus.DISCARDED || e.status === DLQEntryStatus.RESOLVED,
      );
      if (evictIdx >= 0) {
        this.entries.splice(evictIdx, 1);
      } else {
        this.entries.shift();
      }
    }

    const entry: DLQEntry = {
      id: `dlq-${this.nextId++}`,
      taskId: params.taskId,
      sessionId: params.sessionId,
      errorTaxonomy: params.errorTaxonomy,
      errorMessage: params.errorMessage,
      attempts: [...params.attempts],
      originalPayload: params.originalPayload,
      enqueuedAt: Date.now(),
      status: DLQEntryStatus.PENDING,
      reason: params.reason,
      updatedAt: Date.now(),
    };

    this.entries.push(entry);
    return entry;
  }

  get(id: string): DLQEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  updateStatus(id: string, status: DLQEntryStatus, notes?: string): DLQEntry | undefined {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return undefined;
    entry.status = status;
    entry.updatedAt = Date.now();
    if (notes !== undefined) entry.notes = notes;
    return entry;
  }

  getPending(): DLQEntry[] {
    return this.entries.filter((e) => e.status === DLQEntryStatus.PENDING);
  }

  query(filters?: {
    status?: DLQEntryStatus;
    taxonomy?: ErrorTaxonomy;
    reason?: DLQEntry["reason"];
    taskId?: string;
    limit?: number;
  }): DLQEntry[] {
    let results = [...this.entries];
    if (filters?.status !== undefined) results = results.filter((e) => e.status === filters.status);
    if (filters?.taxonomy !== undefined)
      results = results.filter((e) => e.errorTaxonomy === filters.taxonomy);
    if (filters?.reason !== undefined) results = results.filter((e) => e.reason === filters.reason);
    if (filters?.taskId !== undefined) results = results.filter((e) => e.taskId === filters.taskId);
    if (filters?.limit !== undefined) results = results.slice(0, filters.limit);
    return results;
  }

  getStats(): DLQStats {
    const byStatus = {} as Record<DLQEntryStatus, number>;
    for (const s of Object.values(DLQEntryStatus)) byStatus[s] = 0;
    const byTaxonomy: Record<string, number> = {};
    const byReason: Record<string, number> = {};

    for (const entry of this.entries) {
      byStatus[entry.status]++;
      byTaxonomy[entry.errorTaxonomy] = (byTaxonomy[entry.errorTaxonomy] ?? 0) + 1;
      byReason[entry.reason] = (byReason[entry.reason] ?? 0) + 1;
    }

    const pending = this.entries.filter((e) => e.status === DLQEntryStatus.PENDING);
    const oldestPendingAgeMs =
      pending.length > 0 ? Date.now() - Math.min(...pending.map((e) => e.enqueuedAt)) : null;

    return { total: this.entries.length, byStatus, byTaxonomy, byReason, oldestPendingAgeMs };
  }

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
  }
}
