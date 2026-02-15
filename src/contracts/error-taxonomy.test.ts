import { describe, expect, it } from "vitest";
import {
  ErrorTaxonomy,
  ErrorSeverity,
  EscalationReason,
  EscalationAction,
  SchemaViolationError,
  ModelFailureError,
  ToolFailureError,
  ResourceExhaustionError,
  InvariantViolationError,
  ContextOverflowError,
  TimeoutError,
  AbortError,
  ERROR_RESPONSE_MAP,
  getErrorResponseConfig,
  isRetryable,
  shouldEscalate,
  isOpenClawError,
  isErrorTaxonomy,
  getErrorTaxonomy,
} from "./error-taxonomy.js";

describe("Error Taxonomy", () => {
  describe("D1: Error Taxonomy Constants", () => {
    it("has all expected error taxonomy values", () => {
      expect(ErrorTaxonomy.SCHEMA_VIOLATION).toBe("schema_violation");
      expect(ErrorTaxonomy.MODEL_FAILURE).toBe("model_failure");
      expect(ErrorTaxonomy.TOOL_FAILURE).toBe("tool_failure");
      expect(ErrorTaxonomy.RESOURCE_EXHAUSTION).toBe("resource_exhaustion");
      expect(ErrorTaxonomy.INVARIANT_VIOLATION).toBe("invariant_violation");
      expect(ErrorTaxonomy.CONTEXT_OVERFLOW).toBe("context_overflow");
      expect(ErrorTaxonomy.TIMEOUT).toBe("timeout");
      expect(ErrorTaxonomy.ABORT).toBe("abort");
      expect(ErrorTaxonomy.UNKNOWN).toBe("unknown");
    });

    it("has all expected escalation reasons", () => {
      expect(EscalationReason.REPEATED_FAILURE).toBe("repeated_failure");
      expect(EscalationReason.CONTEXT_OVERFLOW).toBe("context_overflow");
      expect(EscalationReason.MODEL_REFUSAL).toBe("model_refusal");
      expect(EscalationReason.BUDGET_EXCEEDED).toBe("budget_exceeded");
      expect(EscalationReason.INVARIANT_VIOLATION).toBe("invariant_violation");
      expect(EscalationReason.TOOL_UNAVAILABLE).toBe("tool_unavailable");
      expect(EscalationReason.USER_REQUESTED).toBe("user_requested");
    });

    it("has all expected severity levels", () => {
      expect(ErrorSeverity.LOW).toBe("low");
      expect(ErrorSeverity.MEDIUM).toBe("medium");
      expect(ErrorSeverity.HIGH).toBe("high");
      expect(ErrorSeverity.CRITICAL).toBe("critical");
    });
  });

  describe("D2: Error Classes", () => {
    it("SchemaViolationError has correct properties", () => {
      const err = new SchemaViolationError("Schema failed", {
        schemaName: "PlanRequest",
        validationErrors: ["Missing field"],
      });
      expect(err.taxonomy).toBe(ErrorTaxonomy.SCHEMA_VIOLATION);
      expect(err.severity).toBe(ErrorSeverity.MEDIUM);
      expect(err.retryable).toBe(true);
      expect(err.requiresChangedInput).toBe(true);
      expect(err.schemaName).toBe("PlanRequest");
      expect(err.validationErrors).toEqual(["Missing field"]);
    });

    it("ModelFailureError handles all failure types", () => {
      for (const ft of ["error", "refusal", "invalid_output", "hallucination"] as const) {
        const err = new ModelFailureError("fail", { failureType: ft });
        expect(err.failureType).toBe(ft);
        expect(err.taxonomy).toBe(ErrorTaxonomy.MODEL_FAILURE);
      }
    });

    it("ToolFailureError preserves tool metadata", () => {
      const err = new ToolFailureError("cmd failed", {
        toolName: "shell",
        exitCode: 1,
        stderr: "denied",
      });
      expect(err.toolName).toBe("shell");
      expect(err.exitCode).toBe(1);
      expect(err.requiresChangedInput).toBe(false);
    });

    it("ResourceExhaustionError is not retryable", () => {
      const err = new ResourceExhaustionError("out of tokens", {
        resourceType: "tokens",
        currentUsage: 100000,
        maximumAllowed: 80000,
      });
      expect(err.retryable).toBe(false);
      expect(err.resourceType).toBe("tokens");
    });

    it("InvariantViolationError is critical and non-retryable", () => {
      const err = new InvariantViolationError("breach", {
        invariant: "dispatcher_supremacy",
        violator: "executor",
      });
      expect(err.severity).toBe(ErrorSeverity.CRITICAL);
      expect(err.retryable).toBe(false);
      expect(err.suggestedAction).toBe(EscalationAction.ABORT);
    });

    it("ContextOverflowError tracks token counts", () => {
      const err = new ContextOverflowError("too big", { currentTokens: 200000, maxTokens: 180000 });
      expect(err.currentTokens).toBe(200000);
      expect(err.maxTokens).toBe(180000);
    });

    it("TimeoutError tracks timeout duration", () => {
      const err = new TimeoutError("timed out", { timeoutMs: 30000 });
      expect(err.timeoutMs).toBe(30000);
      expect(err.retryable).toBe(true);
    });

    it("AbortError is non-retryable", () => {
      const err = new AbortError("cancelled", { abortReason: "user" });
      expect(err.retryable).toBe(false);
    });

    it("serializes to JSON correctly", () => {
      const err = new SchemaViolationError("Test", {});
      const json = err.toJSON();
      expect(json.taxonomy).toBe(ErrorTaxonomy.SCHEMA_VIOLATION);
      expect(json.message).toBe("Test");
      expect(json.timestamp).toBeTypeOf("number");
    });

    it("preserves cause chain", () => {
      const cause = new Error("root");
      const err = new SchemaViolationError("wrapped", { cause });
      expect(err.cause).toBe(cause);
    });
  });

  describe("D7: Error-to-Response Mapping", () => {
    it("has config for all taxonomy types", () => {
      for (const t of Object.values(ErrorTaxonomy)) {
        const cfg = getErrorResponseConfig(t);
        expect(cfg).toBeDefined();
        expect(cfg.maxRetries).toBeTypeOf("number");
        expect(cfg.userMessage).toBeTypeOf("string");
      }
    });

    it("enforces max 1 retry for all retryable errors", () => {
      for (const [, cfg] of Object.entries(ERROR_RESPONSE_MAP)) {
        if (cfg.retryable) expect(cfg.maxRetries).toBeLessThanOrEqual(1);
      }
    });

    it("returns UNKNOWN config for invalid taxonomy", () => {
      const cfg = getErrorResponseConfig("invalid" as ErrorTaxonomy);
      expect(cfg.severity).toBe(ErrorSeverity.HIGH);
    });
  });

  describe("D2: Max 1 Retry Policy (isRetryable)", () => {
    it("allows retry when under budget", () => {
      expect(isRetryable(ErrorTaxonomy.SCHEMA_VIOLATION, 0, true)).toBe(true);
    });

    it("denies retry when budget exhausted", () => {
      expect(isRetryable(ErrorTaxonomy.SCHEMA_VIOLATION, 1, true)).toBe(false);
    });

    it("denies retry when input unchanged but required", () => {
      expect(isRetryable(ErrorTaxonomy.SCHEMA_VIOLATION, 0, false)).toBe(false);
    });

    it("allows retry for tool failures without input change", () => {
      expect(isRetryable(ErrorTaxonomy.TOOL_FAILURE, 0, false)).toBe(true);
    });

    it("denies retry for non-retryable errors", () => {
      expect(isRetryable(ErrorTaxonomy.INVARIANT_VIOLATION, 0, true)).toBe(false);
    });

    it("works with error instances", () => {
      const err = new SchemaViolationError("Test", {});
      expect(isRetryable(err, 0, true)).toBe(true);
      expect(isRetryable(err, 1, true)).toBe(false);
    });
  });

  describe("D4: Escalation on Second Failure (shouldEscalate)", () => {
    it("escalates on repeated failure", () => {
      const e1 = new SchemaViolationError("Schema failed", {});
      const e2 = new SchemaViolationError("Schema failed", {});
      const result = shouldEscalate(e2, [e1]);
      expect(result.shouldEscalate).toBe(true);
      expect(result.reason).toBe(EscalationReason.REPEATED_FAILURE);
    });

    it("does not escalate on first failure", () => {
      const err = new SchemaViolationError("Schema failed", {});
      expect(shouldEscalate(err, []).shouldEscalate).toBe(false);
    });

    it("does not escalate for different messages", () => {
      const e1 = new SchemaViolationError("First", {});
      const e2 = new SchemaViolationError("Second", {});
      expect(shouldEscalate(e2, [e1]).shouldEscalate).toBe(false);
    });

    it("escalates invariant violations immediately", () => {
      const err = new InvariantViolationError("breach", { invariant: "test" });
      const result = shouldEscalate(err, []);
      expect(result.shouldEscalate).toBe(true);
      expect(result.reason).toBe(EscalationReason.INVARIANT_VIOLATION);
    });

    it("escalates resource exhaustion immediately", () => {
      const err = new ResourceExhaustionError("out", { resourceType: "tokens" });
      expect(shouldEscalate(err, []).shouldEscalate).toBe(true);
    });
  });

  describe("Type Guards", () => {
    it("isOpenClawError works", () => {
      expect(isOpenClawError(new SchemaViolationError("x", {}))).toBe(true);
      expect(isOpenClawError(new Error("x"))).toBe(false);
      expect(isOpenClawError(null)).toBe(false);
    });

    it("isErrorTaxonomy checks correctly", () => {
      const err = new SchemaViolationError("x", {});
      expect(isErrorTaxonomy(err, ErrorTaxonomy.SCHEMA_VIOLATION)).toBe(true);
      expect(isErrorTaxonomy(err, ErrorTaxonomy.MODEL_FAILURE)).toBe(false);
    });

    it("getErrorTaxonomy extracts or returns UNKNOWN", () => {
      expect(getErrorTaxonomy(new SchemaViolationError("x", {}))).toBe(
        ErrorTaxonomy.SCHEMA_VIOLATION,
      );
      expect(getErrorTaxonomy(new Error("x"))).toBe(ErrorTaxonomy.UNKNOWN);
    });
  });
});
