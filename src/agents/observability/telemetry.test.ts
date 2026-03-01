import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  emitTelemetry,
  onTelemetry,
  clearTelemetryListeners,
  withTelemetry,
  type TelemetryEvent,
} from "./telemetry.js";
import { createTraceContext, withTraceContext } from "./trace-context.js";

beforeEach(() => {
  clearTelemetryListeners();
});

describe("emitTelemetry", () => {
  it("notifies listeners", () => {
    const events: TelemetryEvent[] = [];
    onTelemetry((e) => events.push(e));
    emitTelemetry({ type: "llm_call", provider: "openai", model: "gpt-4", success: true });
    expect(events).toHaveLength(1);
    expect(events[0].provider).toBe("openai");
  });

  it("enriches with current traceId", () => {
    const events: TelemetryEvent[] = [];
    onTelemetry((e) => events.push(e));
    const ctx = createTraceContext();
    withTraceContext(ctx, () => {
      emitTelemetry({ type: "llm_call", success: true });
    });
    expect(events[0].traceId).toBe(ctx.traceId);
  });

  it("uses explicit traceId over context", () => {
    const events: TelemetryEvent[] = [];
    onTelemetry((e) => events.push(e));
    emitTelemetry({ type: "llm_call", success: true, traceId: "explicit-id" });
    expect(events[0].traceId).toBe("explicit-id");
  });

  it("swallows listener errors", () => {
    onTelemetry(() => {
      throw new Error("boom");
    });
    const events: TelemetryEvent[] = [];
    onTelemetry((e) => events.push(e));
    expect(() => emitTelemetry({ type: "llm_call", success: true })).not.toThrow();
    expect(events).toHaveLength(1);
  });
});

describe("onTelemetry", () => {
  it("returns unsubscribe function", () => {
    const events: TelemetryEvent[] = [];
    const unsub = onTelemetry((e) => events.push(e));
    emitTelemetry({ type: "llm_call", success: true });
    expect(events).toHaveLength(1);
    unsub();
    emitTelemetry({ type: "llm_call", success: true });
    expect(events).toHaveLength(1);
  });
});

describe("clearTelemetryListeners", () => {
  it("removes all listeners", () => {
    const events: TelemetryEvent[] = [];
    onTelemetry((e) => events.push(e));
    clearTelemetryListeners();
    emitTelemetry({ type: "llm_call", success: true });
    expect(events).toHaveLength(0);
  });
});

describe("withTelemetry", () => {
  it("emits success event on success", async () => {
    const events: TelemetryEvent[] = [];
    onTelemetry((e) => events.push(e));
    const result = await withTelemetry(
      { type: "llm_call", provider: "anthropic", model: "claude" },
      async () => 42,
    );
    expect(result).toBe(42);
    expect(events).toHaveLength(1);
    expect(events[0].success).toBe(true);
    expect(events[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("emits failure event on error and rethrows", async () => {
    const events: TelemetryEvent[] = [];
    onTelemetry((e) => events.push(e));
    await expect(
      withTelemetry({ type: "tool_call" }, async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
    expect(events).toHaveLength(1);
    expect(events[0].success).toBe(false);
    expect(events[0].errorMessage).toBe("fail");
  });
});
