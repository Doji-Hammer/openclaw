/**
 * Contract enforcement schemas for OpenClaw.
 *
 * This module exports strict validators for all internal message types
 * to ensure deterministic failure on schema violations.
 *
 * @module contracts
 */

export {
  // Schemas
  PlanRequestSchema,
  PlanArtifactSchema,
  TaskEnvelopeSchema,
  ResultSchema,
  EscalationSignalSchema,
  MemoryWriteSchema,
  // Types
  type PlanRequest,
  type PlanArtifact,
  type TaskEnvelope,
  type Result,
  type EscalationSignal,
  type MemoryWrite,
  // Validators (throwing)
  validatePlanRequest,
  validatePlanArtifact,
  validateTaskEnvelope,
  validateResult,
  validateEscalationSignal,
  validateMemoryWrite,
  // Safe validators (return result)
  safeParsePlanRequest,
  safeParsePlanArtifact,
  safeParseTaskEnvelope,
  safeParseResult,
  safeParseEscalationSignal,
  safeParseMemoryWrite,
} from "./schemas.js";

// Export Failure Economics - Error Taxonomy (Milestone D)
export {
  // Enums (D1)
  ErrorTaxonomy,
  ErrorSeverity,
  EscalationReason,
  EscalationAction,
  // Error classes (D2-D6)
  OpenClawError,
  SchemaViolationError,
  ModelFailureError,
  ToolFailureError,
  ResourceExhaustionError,
  InvariantViolationError,
  ContextOverflowError,
  TimeoutError,
  AbortError,
  // Response mapping (D7)
  ERROR_RESPONSE_MAP,
  getErrorResponseConfig,
  isRetryable,
  shouldEscalate,
  // Type guards
  isOpenClawError,
  isErrorTaxonomy,
  getErrorTaxonomy,
  // Types
  type ErrorResponseConfig,
} from "./error-taxonomy.js";

// Export Retry Budget / Circuit Breaker (D3)
export {
  CircuitState,
  CircuitBreaker,
  RetryBudgetManager,
  type RetryAttempt,
  type RetryBudgetEntry,
  type CircuitBreakerConfig,
  type CircuitBreakerState,
} from "./retry-budget.js";

// Export Cost Tracking (D5)
export {
  CostTracker,
  estimateCost,
  type AttemptCost,
  type TaskCostSummary,
  type CostBudget,
} from "./cost-tracking.js";

// Export Dead Letter Queue (D6)
export {
  DLQEntryStatus,
  DeadLetterQueue,
  type DLQEntry,
  type DLQStats,
} from "./dead-letter-queue.js";

// Export Failure Correlation (D7)
export {
  FailureCorrelator,
  type FailureEvent,
  type CorrelationAlert,
  type CorrelationConfig,
} from "./failure-correlation.js";

// Export Graceful Degradation (D8)
export {
  DegradationLevel,
  DegradationManager,
  type DegradationRule,
  type DegradationCondition,
  type SystemHealth,
} from "./graceful-degradation.js";

// Export Failure Reporting (D9)
export {
  FailureReportBuilder,
  type FailureReport,
  type ErrorSummary,
  type RetrySummary,
  type CostSummary,
  type CircuitSummary,
} from "./failure-reporting.js";
