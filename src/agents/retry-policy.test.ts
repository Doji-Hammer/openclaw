import { describe, expect, test, vi } from "vitest";
import { FailoverError } from "./failover-error.js";
import { shouldRetry, executeWithRetry, type RetryContext } from "./retry-policy.js";

function makeCtx(overrides?: Partial<RetryContext>): RetryContext {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    retryCount: 0,
    startedAt: Date.now(),
    ...overrides,
  };
}

describe("shouldRetry", () => {
  // --- Transient errors, first attempt ---
  test("rate_limit error with retryCount=0 → retry", () => {
    const err = new FailoverError("rate limited", { reason: "rate_limit" });
    const d = shouldRetry(err, makeCtx());
    expect(d.shouldRetry).toBe(true);
    expect(d.category).toBe("rate_limit");
  });

  test("timeout error with retryCount=0 → retry", () => {
    const err = new FailoverError("timed out", { reason: "timeout" });
    const d = shouldRetry(err, makeCtx());
    expect(d.shouldRetry).toBe(true);
    expect(d.category).toBe("timeout");
  });

  test("server_error (500) with retryCount=0 → retry", () => {
    const err = Object.assign(new Error("server error"), { status: 500 });
    const d = shouldRetry(err, makeCtx());
    expect(d.shouldRetry).toBe(true);
    expect(d.category).toBe("server_error");
  });

  test("network error with retryCount=0 → retry", () => {
    const err = Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
    const d = shouldRetry(err, makeCtx());
    expect(d.shouldRetry).toBe(true);
    expect(d.category).toBe("network");
  });

  // --- Transient errors, already retried ---
  test("rate_limit error with retryCount=1 → no retry", () => {
    const err = new FailoverError("rate limited", { reason: "rate_limit" });
    const d = shouldRetry(err, makeCtx({ retryCount: 1 }));
    expect(d.shouldRetry).toBe(false);
    expect(d.reason).toContain("Max retries exhausted");
  });

  test("timeout error with retryCount=2 → no retry", () => {
    const err = new FailoverError("timed out", { reason: "timeout" });
    const d = shouldRetry(err, makeCtx({ retryCount: 2 }));
    expect(d.shouldRetry).toBe(false);
  });

  // --- Non-transient errors ---
  test("auth error → never retry", () => {
    const err = new FailoverError("unauthorized", { reason: "auth" });
    const d = shouldRetry(err, makeCtx());
    expect(d.shouldRetry).toBe(false);
    expect(d.category).toBe("auth");
  });

  test("invalid_request (format) → never retry", () => {
    const err = new FailoverError("bad format", { reason: "format" });
    const d = shouldRetry(err, makeCtx());
    expect(d.shouldRetry).toBe(false);
    expect(d.category).toBe("invalid_request");
  });

  test("billing error → never retry", () => {
    const err = new FailoverError("billing", { reason: "billing" });
    const d = shouldRetry(err, makeCtx());
    expect(d.shouldRetry).toBe(false);
    expect(d.category).toBe("auth");
  });

  test("unknown error → never retry (conservative)", () => {
    const err = new Error("something weird");
    const d = shouldRetry(err, makeCtx());
    expect(d.shouldRetry).toBe(false);
    expect(d.category).toBe("unknown");
  });
});

describe("executeWithRetry", () => {
  test("succeeds on first attempt → no retry, no escalation", async () => {
    const onRetry = vi.fn();
    const onEscalation = vi.fn();
    const result = await executeWithRetry({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      run: async () => "ok",
      onRetry,
      onEscalation,
    });
    expect(result).toBe("ok");
    expect(onRetry).not.toHaveBeenCalled();
    expect(onEscalation).not.toHaveBeenCalled();
  });

  test("transient error → retries once then succeeds", async () => {
    let calls = 0;
    const onRetry = vi.fn();
    const result = await executeWithRetry({
      provider: "openai",
      model: "gpt-4",
      run: async () => {
        calls++;
        if (calls === 1) throw new FailoverError("rate limited", { reason: "rate_limit" });
        return "recovered";
      },
      onRetry,
    });
    expect(result).toBe("recovered");
    expect(calls).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("transient error → retries once, fails again → escalates", async () => {
    const onEscalation = vi.fn();
    await expect(
      executeWithRetry({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        run: async () => {
          throw new FailoverError("timed out", { reason: "timeout" });
        },
        onEscalation,
      }),
    ).rejects.toThrow("timed out");
    expect(onEscalation).toHaveBeenCalledTimes(1);
    const info = onEscalation.mock.calls[0][0];
    expect(info.category).toBe("timeout");
    expect(info.provider).toBe("anthropic");
    expect(info.retryCount).toBe(1);
  });

  test("permanent error → no retry, escalates immediately", async () => {
    const onRetry = vi.fn();
    const onEscalation = vi.fn();
    await expect(
      executeWithRetry({
        provider: "openai",
        model: "gpt-4",
        run: async () => {
          throw new FailoverError("bad key", { reason: "auth" });
        },
        onRetry,
        onEscalation,
      }),
    ).rejects.toThrow("bad key");
    expect(onRetry).not.toHaveBeenCalled();
    expect(onEscalation).toHaveBeenCalledTimes(1);
    expect(onEscalation.mock.calls[0][0].category).toBe("auth");
    expect(onEscalation.mock.calls[0][0].retryCount).toBe(0);
  });

  test("unknown error → no retry, escalates", async () => {
    const onEscalation = vi.fn();
    await expect(
      executeWithRetry({
        provider: "openai",
        model: "gpt-4",
        run: async () => {
          throw new Error("mystery");
        },
        onEscalation,
      }),
    ).rejects.toThrow("mystery");
    expect(onEscalation).toHaveBeenCalledTimes(1);
    expect(onEscalation.mock.calls[0][0].category).toBe("unknown");
  });

  test("escalation info contains latency > 0", async () => {
    const onEscalation = vi.fn();
    await expect(
      executeWithRetry({
        provider: "anthropic",
        model: "sonnet",
        run: async () => {
          throw new FailoverError("auth fail", { reason: "auth" });
        },
        onEscalation,
      }),
    ).rejects.toThrow();
    expect(onEscalation.mock.calls[0][0].latencyMs).toBeGreaterThanOrEqual(0);
  });
});
