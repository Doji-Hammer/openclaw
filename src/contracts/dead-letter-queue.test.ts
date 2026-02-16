import { describe, expect, it } from "vitest";
import { DeadLetterQueue, DLQEntryStatus } from "./dead-letter-queue.js";
import { ErrorTaxonomy } from "./error-taxonomy.js";

describe("DeadLetterQueue", () => {
  const makeEntry = (taskId = "t1", taxonomy = ErrorTaxonomy.SCHEMA_VIOLATION) => ({
    taskId,
    errorTaxonomy: taxonomy,
    errorMessage: "failed",
    attempts: [{ timestamp: Date.now(), taxonomy, message: "failed", inputChanged: false }],
    reason: "retries_exhausted" as const,
  });

  it("enqueues and retrieves entries", () => {
    const dlq = new DeadLetterQueue();
    const entry = dlq.enqueue(makeEntry());
    expect(entry.id).toMatch(/^dlq-/);
    expect(entry.status).toBe(DLQEntryStatus.PENDING);
    expect(dlq.get(entry.id)).toBeDefined();
    expect(dlq.size).toBe(1);
  });

  it("updates entry status", () => {
    const dlq = new DeadLetterQueue();
    const entry = dlq.enqueue(makeEntry());
    const updated = dlq.updateStatus(entry.id, DLQEntryStatus.REVIEWING, "investigating");
    expect(updated?.status).toBe(DLQEntryStatus.REVIEWING);
    expect(updated?.notes).toBe("investigating");
  });

  it("returns undefined for unknown id", () => {
    const dlq = new DeadLetterQueue();
    expect(dlq.updateStatus("nonexistent", DLQEntryStatus.DISCARDED)).toBeUndefined();
  });

  it("gets pending entries", () => {
    const dlq = new DeadLetterQueue();
    dlq.enqueue(makeEntry("t1"));
    dlq.enqueue(makeEntry("t2"));
    const e3 = dlq.enqueue(makeEntry("t3"));
    dlq.updateStatus(e3.id, DLQEntryStatus.RESOLVED);
    expect(dlq.getPending()).toHaveLength(2);
  });

  it("queries with filters", () => {
    const dlq = new DeadLetterQueue();
    dlq.enqueue(makeEntry("t1", ErrorTaxonomy.SCHEMA_VIOLATION));
    dlq.enqueue(makeEntry("t2", ErrorTaxonomy.MODEL_FAILURE));
    dlq.enqueue(makeEntry("t3", ErrorTaxonomy.SCHEMA_VIOLATION));

    expect(dlq.query({ taxonomy: ErrorTaxonomy.SCHEMA_VIOLATION })).toHaveLength(2);
    expect(dlq.query({ limit: 1 })).toHaveLength(1);
    expect(dlq.query({ taskId: "t2" })).toHaveLength(1);
  });

  it("respects max size by evicting old entries", () => {
    const dlq = new DeadLetterQueue(2);
    dlq.enqueue(makeEntry("t1"));
    dlq.enqueue(makeEntry("t2"));
    dlq.enqueue(makeEntry("t3"));
    expect(dlq.size).toBe(2);
  });

  it("evicts resolved/discarded first", () => {
    const dlq = new DeadLetterQueue(2);
    const e1 = dlq.enqueue(makeEntry("t1"));
    dlq.enqueue(makeEntry("t2"));
    dlq.updateStatus(e1.id, DLQEntryStatus.DISCARDED);
    dlq.enqueue(makeEntry("t3"));
    expect(dlq.size).toBe(2);
    expect(dlq.get(e1.id)).toBeUndefined();
  });

  it("computes stats", () => {
    const dlq = new DeadLetterQueue();
    dlq.enqueue(makeEntry("t1", ErrorTaxonomy.SCHEMA_VIOLATION));
    dlq.enqueue(makeEntry("t2", ErrorTaxonomy.MODEL_FAILURE));
    const stats = dlq.getStats();
    expect(stats.total).toBe(2);
    expect(stats.byStatus[DLQEntryStatus.PENDING]).toBe(2);
    expect(stats.byTaxonomy[ErrorTaxonomy.SCHEMA_VIOLATION]).toBe(1);
    expect(stats.oldestPendingAgeMs).toBeTypeOf("number");
  });

  it("clears all entries", () => {
    const dlq = new DeadLetterQueue();
    dlq.enqueue(makeEntry());
    dlq.clear();
    expect(dlq.size).toBe(0);
  });
});
