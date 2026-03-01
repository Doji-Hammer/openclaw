import { describe, it, expect } from "vitest";
import {
  generateTraceId,
  generateSpanId,
  createTraceContext,
  createChildSpan,
  withTraceContext,
  currentTraceContext,
  currentTraceId,
  elapsed,
} from "./trace-context.js";

describe("generateTraceId", () => {
  it("returns 32 hex chars", () => {
    const id = generateTraceId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
    expect(ids.size).toBe(100);
  });
});

describe("generateSpanId", () => {
  it("returns 16 hex chars", () => {
    const id = generateSpanId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("createTraceContext", () => {
  it("creates context with generated IDs", () => {
    const ctx = createTraceContext();
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(ctx.parentSpanId).toBeUndefined();
    expect(ctx.startedAt).toBeGreaterThan(0);
    expect(ctx.attributes).toEqual({});
  });

  it("accepts custom traceId", () => {
    const ctx = createTraceContext({ traceId: "abc123" });
    expect(ctx.traceId).toBe("abc123");
  });

  it("accepts attributes", () => {
    const ctx = createTraceContext({ attributes: { env: "test" } });
    expect(ctx.attributes.env).toBe("test");
  });
});

describe("createChildSpan", () => {
  it("inherits traceId from parent", () => {
    const parent = createTraceContext();
    const child = createChildSpan(parent);
    expect(child.traceId).toBe(parent.traceId);
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(child.spanId).not.toBe(parent.spanId);
  });

  it("merges attributes", () => {
    const parent = createTraceContext({ attributes: { env: "test" } });
    const child = createChildSpan(parent, { step: "build" });
    expect(child.attributes.env).toBe("test");
    expect(child.attributes.step).toBe("build");
  });
});

describe("withTraceContext / currentTraceContext", () => {
  it("returns undefined outside context", () => {
    expect(currentTraceContext()).toBeUndefined();
    expect(currentTraceId()).toBeUndefined();
  });

  it("propagates context within callback", () => {
    const ctx = createTraceContext();
    withTraceContext(ctx, () => {
      expect(currentTraceContext()).toBe(ctx);
      expect(currentTraceId()).toBe(ctx.traceId);
    });
  });

  it("nests contexts correctly", () => {
    const outer = createTraceContext();
    const inner = createChildSpan(outer);
    withTraceContext(outer, () => {
      expect(currentTraceId()).toBe(outer.traceId);
      withTraceContext(inner, () => {
        expect(currentTraceContext()).toBe(inner);
      });
      expect(currentTraceContext()).toBe(outer);
    });
  });
});

describe("elapsed", () => {
  it("returns non-negative duration", () => {
    const ctx = createTraceContext();
    const ms = elapsed(ctx);
    expect(ms).toBeGreaterThanOrEqual(0);
  });
});
