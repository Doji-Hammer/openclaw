import { describe, it, expect, beforeEach } from "vitest";
import { createScoreboard } from "./scoreboard.js";
import type { TelemetryEvent } from "./telemetry.js";

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    type: "llm_call",
    provider: "openai",
    model: "gpt-4",
    success: true,
    latencyMs: 100,
    tokens: { input: 10, output: 20 },
    ...overrides,
  };
}

describe("Scoreboard", () => {
  let board: ReturnType<typeof createScoreboard>;

  beforeEach(() => {
    board = createScoreboard();
  });

  it("starts empty", () => {
    const snap = board.snapshot();
    expect(snap.entries).toHaveLength(0);
    expect(snap.totalEvents).toBe(0);
  });

  it("records success", () => {
    board.record(makeEvent());
    const entry = board.get("openai", "gpt-4");
    expect(entry?.successCount).toBe(1);
    expect(entry?.failCount).toBe(0);
  });

  it("records failure", () => {
    board.record(makeEvent({ success: false }));
    const entry = board.get("openai", "gpt-4");
    expect(entry?.failCount).toBe(1);
  });

  it("tracks latency", () => {
    board.record(makeEvent({ latencyMs: 200 }));
    board.record(makeEvent({ latencyMs: 400 }));
    expect(board.avgLatency("openai", "gpt-4")).toBe(300);
  });

  it("tracks tokens", () => {
    board.record(makeEvent({ tokens: { input: 100, output: 50 } }));
    board.record(makeEvent({ tokens: { input: 200, output: 100 } }));
    const entry = board.get("openai", "gpt-4");
    expect(entry?.totalTokensIn).toBe(300);
    expect(entry?.totalTokensOut).toBe(150);
  });

  it("computes success rate", () => {
    board.record(makeEvent({ success: true }));
    board.record(makeEvent({ success: true }));
    board.record(makeEvent({ success: false }));
    expect(board.successRate("openai", "gpt-4")).toBeCloseTo(2 / 3);
  });

  it("returns undefined for unknown provider/model", () => {
    expect(board.get("nope", "nope")).toBeUndefined();
    expect(board.successRate("nope", "nope")).toBeUndefined();
    expect(board.avgLatency("nope", "nope")).toBeUndefined();
  });

  it("separates provider/model combos", () => {
    board.record(makeEvent({ provider: "openai", model: "gpt-4" }));
    board.record(makeEvent({ provider: "anthropic", model: "claude" }));
    const snap = board.snapshot();
    expect(snap.entries).toHaveLength(2);
    expect(snap.totalEvents).toBe(2);
  });

  it("uses 'unknown' for missing provider/model", () => {
    board.record(makeEvent({ provider: undefined, model: undefined }));
    expect(board.get("unknown", "unknown")?.successCount).toBe(1);
  });

  it("reset clears all data", () => {
    board.record(makeEvent());
    board.reset();
    expect(board.snapshot().entries).toHaveLength(0);
    expect(board.snapshot().totalEvents).toBe(0);
  });

  it("handles missing latency and tokens gracefully", () => {
    board.record(makeEvent({ latencyMs: undefined, tokens: undefined }));
    const entry = board.get("openai", "gpt-4");
    expect(entry?.totalLatencyMs).toBe(0);
    expect(entry?.totalTokensIn).toBe(0);
  });

  it("snapshot includes uptimeSince", () => {
    const snap = board.snapshot();
    expect(snap.uptimeSince).toBeGreaterThan(0);
    expect(snap.uptimeSince).toBeLessThanOrEqual(Date.now());
  });
});
