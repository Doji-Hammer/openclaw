import { describe, expect, test } from "vitest";
import { escalate, formatEscalation, type EscalationInfo } from "./escalation.js";
import { FailoverError } from "./failover-error.js";

describe("escalate", () => {
  test("produces structured info from FailoverError", () => {
    const err = new FailoverError("rate limited", { reason: "rate_limit", status: 429 });
    const info = escalate(err, {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      retryCount: 1,
      startedAt: Date.now() - 500,
    });
    expect(info.category).toBe("rate_limit");
    expect(info.provider).toBe("anthropic");
    expect(info.model).toBe("claude-sonnet-4-20250514");
    expect(info.retryCount).toBe(1);
    expect(info.latencyMs).toBeGreaterThanOrEqual(0);
    expect(info.errorMessage).toBe("rate limited");
    expect(info.httpStatus).toBe(429);
    expect(info.escalatedAt).toBeTruthy();
  });

  test("produces info from plain Error with status", () => {
    const err = Object.assign(new Error("bad gateway"), { status: 502, code: "BAD_GATEWAY" });
    const info = escalate(err, {
      provider: "openai",
      model: "gpt-4",
      retryCount: 0,
      startedAt: Date.now(),
    });
    expect(info.category).toBe("server_error");
    expect(info.httpStatus).toBe(502);
    expect(info.errorCode).toBe("BAD_GATEWAY");
  });

  test("handles plain string error", () => {
    const info = escalate("something broke", {
      provider: "google",
      model: "gemini-pro",
      retryCount: 0,
      startedAt: Date.now(),
    });
    expect(info.category).toBe("unknown");
    expect(info.errorMessage).toBe("something broke");
    expect(info.httpStatus).toBeUndefined();
    expect(info.errorCode).toBeUndefined();
  });

  test("handles network error", () => {
    const err = Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" });
    const info = escalate(err, {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      retryCount: 1,
      startedAt: Date.now() - 1000,
    });
    expect(info.category).toBe("network");
    expect(info.errorCode).toBe("ECONNREFUSED");
  });

  test("escalatedAt is valid ISO string", () => {
    const info = escalate(new Error("test"), {
      provider: "p",
      model: "m",
      retryCount: 0,
      startedAt: Date.now(),
    });
    expect(() => new Date(info.escalatedAt)).not.toThrow();
    expect(new Date(info.escalatedAt).toISOString()).toBe(info.escalatedAt);
  });
});

describe("formatEscalation", () => {
  test("formats basic escalation info", () => {
    const info: EscalationInfo = {
      category: "timeout",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      latencyMs: 5000,
      retryCount: 1,
      errorMessage: "request timed out",
      escalatedAt: new Date().toISOString(),
    };
    const formatted = formatEscalation(info);
    expect(formatted).toContain("[ESCALATION]");
    expect(formatted).toContain("category=timeout");
    expect(formatted).toContain("provider=anthropic");
    expect(formatted).toContain("latency=5000ms");
    expect(formatted).toContain("retries=1");
  });

  test("includes http status and code when present", () => {
    const info: EscalationInfo = {
      category: "server_error",
      provider: "openai",
      model: "gpt-4",
      latencyMs: 200,
      retryCount: 0,
      errorMessage: "internal error",
      httpStatus: 500,
      errorCode: "INTERNAL",
      escalatedAt: new Date().toISOString(),
    };
    const formatted = formatEscalation(info);
    expect(formatted).toContain("http=500");
    expect(formatted).toContain("code=INTERNAL");
  });

  test("omits http status and code when absent", () => {
    const info: EscalationInfo = {
      category: "unknown",
      provider: "test",
      model: "test-model",
      latencyMs: 100,
      retryCount: 0,
      errorMessage: "mystery",
      escalatedAt: new Date().toISOString(),
    };
    const formatted = formatEscalation(info);
    expect(formatted).not.toContain("http=");
    expect(formatted).not.toContain("code=");
  });
});
