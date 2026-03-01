import { describe, it, expect } from "vitest";
import {
  PlanRequestSchema,
  PlanArtifactSchema,
  TaskEnvelopeSchema,
  ResultSchema,
  EscalationSignalSchema,
  validateOrThrow,
  validateOrLog,
  ContractValidationError,
  type PlanRequest,
  type PlanArtifact,
  type TaskEnvelope,
  type Result,
  type EscalationSignal,
} from "./schema-validators.js";

// ─── Fixtures ──────────────────────────────────────────────────────────

const validPlanRequest: PlanRequest = {
  sessionId: "sess-1",
  goal: "Deploy feature X",
  constraints: ["no downtime"],
  maxSteps: 5,
  priority: "high",
};

const validPlanArtifact: PlanArtifact = {
  planId: "plan-1",
  sessionId: "sess-1",
  steps: [
    { stepId: "s1", description: "Build", tool: "exec" },
    { stepId: "s2", description: "Test", dependsOn: ["s1"] },
  ],
  createdAt: new Date().toISOString(),
  status: "draft",
};

const validTaskEnvelope: TaskEnvelope = {
  taskId: "task-1",
  sessionId: "sess-1",
  type: "llm_call",
  payload: { prompt: "hello" },
  createdAt: new Date().toISOString(),
  timeoutMs: 30000,
};

const validResult: Result = {
  taskId: "task-1",
  sessionId: "sess-1",
  success: true,
  output: "done",
  latencyMs: 123,
  tokens: { input: 10, output: 20, total: 30 },
  completedAt: new Date().toISOString(),
};

const validEscalation: EscalationSignal = {
  taskId: "task-1",
  sessionId: "sess-1",
  category: "rate_limit",
  provider: "openai",
  model: "gpt-4",
  retryCount: 3,
  latencyMs: 5000,
  errorMessage: "Too many requests",
  escalatedAt: new Date().toISOString(),
};

// ─── PlanRequest ───────────────────────────────────────────────────────

describe("PlanRequestSchema", () => {
  it("accepts valid plan request", () => {
    expect(PlanRequestSchema.parse(validPlanRequest)).toEqual(validPlanRequest);
  });

  it("accepts minimal plan request", () => {
    expect(PlanRequestSchema.parse({ sessionId: "s", goal: "g" })).toBeTruthy();
  });

  it("rejects missing sessionId", () => {
    expect(() => PlanRequestSchema.parse({ goal: "g" })).toThrow();
  });

  it("rejects empty goal", () => {
    expect(() => PlanRequestSchema.parse({ sessionId: "s", goal: "" })).toThrow();
  });

  it("rejects invalid priority", () => {
    expect(() =>
      PlanRequestSchema.parse({ sessionId: "s", goal: "g", priority: "mega" }),
    ).toThrow();
  });
});

// ─── PlanArtifact ──────────────────────────────────────────────────────

describe("PlanArtifactSchema", () => {
  it("accepts valid plan artifact", () => {
    expect(PlanArtifactSchema.parse(validPlanArtifact)).toEqual(validPlanArtifact);
  });

  it("rejects step with empty description", () => {
    const bad = {
      ...validPlanArtifact,
      steps: [{ stepId: "s1", description: "" }],
    };
    expect(() => PlanArtifactSchema.parse(bad)).toThrow();
  });
});

// ─── TaskEnvelope ──────────────────────────────────────────────────────

describe("TaskEnvelopeSchema", () => {
  it("accepts valid task envelope", () => {
    expect(TaskEnvelopeSchema.parse(validTaskEnvelope)).toEqual(validTaskEnvelope);
  });

  it("accepts envelope with retry policy", () => {
    const withRetry = {
      ...validTaskEnvelope,
      retryPolicy: { maxRetries: 2, backoffMs: 1000 },
    };
    expect(TaskEnvelopeSchema.parse(withRetry)).toBeTruthy();
  });

  it("rejects zero timeout", () => {
    expect(() => TaskEnvelopeSchema.parse({ ...validTaskEnvelope, timeoutMs: 0 })).toThrow();
  });
});

// ─── Result ────────────────────────────────────────────────────────────

describe("ResultSchema", () => {
  it("accepts valid success result", () => {
    expect(ResultSchema.parse(validResult)).toEqual(validResult);
  });

  it("accepts failure result with error", () => {
    const fail: Result = {
      taskId: "t1",
      sessionId: "s1",
      success: false,
      error: { message: "boom", category: "timeout" },
      completedAt: new Date().toISOString(),
    };
    expect(ResultSchema.parse(fail)).toBeTruthy();
  });

  it("rejects missing completedAt", () => {
    expect(() => ResultSchema.parse({ taskId: "t1", sessionId: "s1", success: true })).toThrow();
  });
});

// ─── EscalationSignal ──────────────────────────────────────────────────

describe("EscalationSignalSchema", () => {
  it("accepts valid escalation", () => {
    expect(EscalationSignalSchema.parse(validEscalation)).toEqual(validEscalation);
  });

  it("rejects invalid category", () => {
    expect(() =>
      EscalationSignalSchema.parse({ ...validEscalation, category: "banana" }),
    ).toThrow();
  });

  it("accepts all valid categories", () => {
    for (const cat of [
      "rate_limit",
      "auth",
      "timeout",
      "invalid_request",
      "server_error",
      "network",
      "unknown",
    ]) {
      expect(EscalationSignalSchema.parse({ ...validEscalation, category: cat })).toBeTruthy();
    }
  });
});

// ─── validateOrThrow ───────────────────────────────────────────────────

describe("validateOrThrow", () => {
  it("returns parsed data on success", () => {
    const data = validateOrThrow(PlanRequestSchema, validPlanRequest, "test");
    expect(data.sessionId).toBe("sess-1");
  });

  it("throws ContractValidationError on failure", () => {
    expect(() => validateOrThrow(PlanRequestSchema, {}, "PlanRequest")).toThrow(
      ContractValidationError,
    );
  });

  it("error contains structured errors", () => {
    try {
      validateOrThrow(PlanRequestSchema, {}, "test");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ContractValidationError);
      const cve = err as ContractValidationError;
      expect(cve.errors.length).toBeGreaterThan(0);
      expect(cve.errors[0].path).toBeDefined();
      expect(cve.errors[0].message).toBeDefined();
      expect(cve.errors[0].code).toBeDefined();
      expect(cve.label).toBe("test");
    }
  });

  it("works without label", () => {
    expect(() => validateOrThrow(PlanRequestSchema, {})).toThrow(ContractValidationError);
  });
});

// ─── validateOrLog ─────────────────────────────────────────────────────

describe("validateOrLog", () => {
  it("returns success result on valid data", () => {
    const result = validateOrLog(PlanRequestSchema, validPlanRequest, "test");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.goal).toBe("Deploy feature X");
    }
  });

  it("returns failure result on invalid data", () => {
    const result = validateOrLog(PlanRequestSchema, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("does not throw on invalid data", () => {
    expect(() => validateOrLog(ResultSchema, {})).not.toThrow();
  });

  it("works with label", () => {
    const result = validateOrLog(ResultSchema, {}, "Result");
    expect(result.success).toBe(false);
  });
});
