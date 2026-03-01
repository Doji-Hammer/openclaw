import { describe, expect, test } from "vitest";
import {
  categorizeError,
  isTransientCategory,
  isPermanentCategory,
  type ErrorCategory,
} from "./error-taxonomy.js";
import { FailoverError } from "./failover-error.js";

describe("categorizeError", () => {
  // --- FailoverError pass-through ---
  test("FailoverError with rate_limit reason → rate_limit", () => {
    const err = new FailoverError("rate limited", { reason: "rate_limit" });
    expect(categorizeError(err)).toBe("rate_limit");
  });

  test("FailoverError with auth reason → auth", () => {
    const err = new FailoverError("unauthorized", { reason: "auth" });
    expect(categorizeError(err)).toBe("auth");
  });

  test("FailoverError with billing reason → auth", () => {
    const err = new FailoverError("billing error", { reason: "billing" });
    expect(categorizeError(err)).toBe("auth");
  });

  test("FailoverError with timeout reason → timeout", () => {
    const err = new FailoverError("timed out", { reason: "timeout" });
    expect(categorizeError(err)).toBe("timeout");
  });

  test("FailoverError with format reason → invalid_request", () => {
    const err = new FailoverError("bad format", { reason: "format" });
    expect(categorizeError(err)).toBe("invalid_request");
  });

  test("FailoverError with unknown reason → unknown", () => {
    const err = new FailoverError("???", { reason: "unknown" });
    expect(categorizeError(err)).toBe("unknown");
  });

  // --- HTTP status codes ---
  test("429 status → rate_limit", () => {
    expect(categorizeError({ status: 429, message: "too many" })).toBe("rate_limit");
  });

  test("401 status → auth", () => {
    expect(categorizeError({ status: 401, message: "unauthorized" })).toBe("auth");
  });

  test("403 status → auth", () => {
    expect(categorizeError({ status: 403, message: "forbidden" })).toBe("auth");
  });

  test("402 status → auth (billing)", () => {
    expect(categorizeError({ status: 402, message: "payment required" })).toBe("auth");
  });

  test("408 status → timeout", () => {
    expect(categorizeError({ status: 408, message: "timeout" })).toBe("timeout");
  });

  test("500 status → server_error", () => {
    expect(categorizeError({ status: 500, message: "oops" })).toBe("server_error");
  });

  test("502 status → server_error", () => {
    expect(categorizeError({ status: 502, message: "bad gateway" })).toBe("server_error");
  });

  test("503 status → server_error", () => {
    expect(categorizeError({ status: 503, message: "unavailable" })).toBe("server_error");
  });

  // --- Network errors by code ---
  test("ENOTFOUND → network", () => {
    const err = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    expect(categorizeError(err)).toBe("network");
  });

  test("ECONNREFUSED → network", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    expect(categorizeError(err)).toBe("network");
  });

  test("EHOSTUNREACH → network", () => {
    const err = Object.assign(new Error("host unreachable"), { code: "EHOSTUNREACH" });
    expect(categorizeError(err)).toBe("network");
  });

  test("EAI_AGAIN → network", () => {
    const err = Object.assign(new Error("dns"), { code: "EAI_AGAIN" });
    expect(categorizeError(err)).toBe("network");
  });

  // --- Network errors by message ---
  test("'network error' message → network", () => {
    expect(categorizeError(new Error("network error occurred"))).toBe("network");
  });

  test("'fetch failed' message → network", () => {
    expect(categorizeError(new Error("fetch failed"))).toBe("network");
  });

  test("'socket hang up' message → network", () => {
    expect(categorizeError(new Error("socket hang up"))).toBe("network");
  });

  // --- Server error by message ---
  test("'internal server error' message → server_error", () => {
    expect(categorizeError(new Error("500 internal server error"))).toBe("server_error");
  });

  test("'service unavailable' message → server_error", () => {
    expect(categorizeError(new Error("503 service unavailable"))).toBe("server_error");
  });

  // --- Timeout via message ---
  test("'timed out' message → timeout", () => {
    expect(categorizeError(new Error("request timed out"))).toBe("timeout");
  });

  test("ETIMEDOUT code → timeout", () => {
    const err = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    expect(categorizeError(err)).toBe("timeout");
  });

  // --- Rate limit via message ---
  test("'rate limit' message → rate_limit", () => {
    expect(categorizeError(new Error("rate limit exceeded"))).toBe("rate_limit");
  });

  test("'too many requests' message → rate_limit", () => {
    expect(categorizeError(new Error("too many requests"))).toBe("rate_limit");
  });

  // --- Auth via message ---
  test("'invalid api key' message → auth", () => {
    expect(categorizeError(new Error("invalid api key provided"))).toBe("auth");
  });

  // --- Unknown fallback ---
  test("generic error → unknown", () => {
    expect(categorizeError(new Error("something weird happened"))).toBe("unknown");
  });

  test("null → unknown", () => {
    expect(categorizeError(null)).toBe("unknown");
  });

  test("undefined → unknown", () => {
    expect(categorizeError(undefined)).toBe("unknown");
  });

  test("string → uses message classification", () => {
    // a plain string won't match any pattern
    expect(categorizeError("random string")).toBe("unknown");
  });
});

describe("isTransientCategory", () => {
  test("rate_limit is transient", () => expect(isTransientCategory("rate_limit")).toBe(true));
  test("timeout is transient", () => expect(isTransientCategory("timeout")).toBe(true));
  test("server_error is transient", () => expect(isTransientCategory("server_error")).toBe(true));
  test("network is transient", () => expect(isTransientCategory("network")).toBe(true));
  test("auth is NOT transient", () => expect(isTransientCategory("auth")).toBe(false));
  test("invalid_request is NOT transient", () =>
    expect(isTransientCategory("invalid_request")).toBe(false));
  test("unknown is NOT transient", () => expect(isTransientCategory("unknown")).toBe(false));
});

describe("isPermanentCategory", () => {
  test("auth is permanent", () => expect(isPermanentCategory("auth")).toBe(true));
  test("invalid_request is permanent", () =>
    expect(isPermanentCategory("invalid_request")).toBe(true));
  test("rate_limit is NOT permanent", () => expect(isPermanentCategory("rate_limit")).toBe(false));
  test("unknown is NOT permanent", () => expect(isPermanentCategory("unknown")).toBe(false));
});
