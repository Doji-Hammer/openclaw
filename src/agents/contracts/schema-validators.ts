/**
 * Schema Validators — Contract Enforcement
 *
 * Zod validators for key internal data shapes flowing between components.
 * Provides validateOrThrow() and validateOrLog() helpers with structured error reporting.
 */

import { z } from "zod";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("contracts");

// ─── Schemas ───────────────────────────────────────────────────────────

/**
 * PlanRequest: a request to plan work (e.g., from orchestrator to planner).
 */
export const PlanRequestSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().optional(),
  goal: z.string().min(1),
  constraints: z.array(z.string()).optional(),
  context: z.record(z.unknown()).optional(),
  maxSteps: z.number().int().positive().optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
  priority: z.enum(["low", "normal", "high", "critical"]).optional(),
});

export type PlanRequest = z.infer<typeof PlanRequestSchema>;

/**
 * PlanArtifact: output from planning — a structured plan or step list.
 */
export const PlanArtifactSchema = z.object({
  planId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().optional(),
  steps: z.array(
    z.object({
      stepId: z.string().min(1),
      description: z.string().min(1),
      tool: z.string().optional(),
      params: z.record(z.unknown()).optional(),
      dependsOn: z.array(z.string()).optional(),
    }),
  ),
  estimatedTokens: z.number().int().nonnegative().optional(),
  createdAt: z.string(),
  status: z.enum(["draft", "approved", "executing", "completed", "failed"]).optional(),
});

export type PlanArtifact = z.infer<typeof PlanArtifactSchema>;

/**
 * TaskEnvelope: wraps a unit of work for execution.
 */
export const TaskEnvelopeSchema = z.object({
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().optional(),
  traceId: z.string().optional(),
  type: z.string().min(1),
  payload: z.unknown(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string(),
  timeoutMs: z.number().int().positive().optional(),
  retryPolicy: z
    .object({
      maxRetries: z.number().int().nonnegative(),
      backoffMs: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type TaskEnvelope = z.infer<typeof TaskEnvelopeSchema>;

/**
 * Result: outcome of executing a task or step.
 */
export const ResultSchema = z.object({
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().optional(),
  traceId: z.string().optional(),
  success: z.boolean(),
  output: z.unknown().optional(),
  error: z
    .object({
      message: z.string(),
      code: z.string().optional(),
      category: z
        .enum([
          "rate_limit",
          "auth",
          "timeout",
          "invalid_request",
          "server_error",
          "network",
          "unknown",
        ])
        .optional(),
    })
    .optional(),
  latencyMs: z.number().nonnegative().optional(),
  tokens: z
    .object({
      input: z.number().int().nonnegative().optional(),
      output: z.number().int().nonnegative().optional(),
      total: z.number().int().nonnegative().optional(),
    })
    .optional(),
  completedAt: z.string(),
});

export type Result = z.infer<typeof ResultSchema>;

/**
 * EscalationSignal: raised when retries are exhausted or a critical failure occurs.
 */
export const EscalationSignalSchema = z.object({
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().optional(),
  traceId: z.string().optional(),
  category: z.enum([
    "rate_limit",
    "auth",
    "timeout",
    "invalid_request",
    "server_error",
    "network",
    "unknown",
  ]),
  provider: z.string().min(1),
  model: z.string().min(1),
  retryCount: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),
  errorMessage: z.string(),
  errorCode: z.string().optional(),
  httpStatus: z.number().int().optional(),
  escalatedAt: z.string(),
});

export type EscalationSignal = z.infer<typeof EscalationSignalSchema>;

// ─── Validation Helpers ────────────────────────────────────────────────

export type ValidationError = {
  path: (string | number)[];
  message: string;
  code: string;
};

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: ValidationError[] };

function formatZodErrors(error: z.ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Validate data against a Zod schema. Throws a structured error on failure.
 */
export function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown, label?: string): T {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  const errors = formatZodErrors(result.error);
  const prefix = label ? `[${label}] ` : "";
  const summary = errors.map((e) => `  ${e.path.join(".")}: ${e.message} (${e.code})`).join("\n");
  throw new ContractValidationError(`${prefix}Validation failed:\n${summary}`, errors, label);
}

/**
 * Validate data against a Zod schema. Logs warnings on failure, returns result.
 */
export function validateOrLog<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  label?: string,
): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = formatZodErrors(result.error);
  const prefix = label ? `[${label}] ` : "";
  const summary = errors.map((e) => `  ${e.path.join(".")}: ${e.message} (${e.code})`).join("\n");
  log.warn(`${prefix}Validation failed:\n${summary}`, { label, errors });
  return { success: false, errors };
}

/**
 * Structured error for contract validation failures.
 */
export class ContractValidationError extends Error {
  readonly errors: ValidationError[];
  readonly label: string | undefined;

  constructor(message: string, errors: ValidationError[], label?: string) {
    super(message);
    this.name = "ContractValidationError";
    this.errors = errors;
    this.label = label;
  }
}
