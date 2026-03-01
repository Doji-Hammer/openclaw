/**
 * Context Budgeter — allocates a model's context window across categories.
 *
 * Default allocation:
 *   - system prompt: 20%
 *   - hot state: 0% (carved from history if needed)
 *   - conversation history: 50%
 *   - tool results: 15%
 *   - output reserve: 15%
 */

export type BudgetCategory =
  | "systemPrompt"
  | "hotState"
  | "history"
  | "toolResults"
  | "outputReserve";

export type BudgetAllocation = Record<BudgetCategory, number>;

export type BudgetOverride = Partial<Record<BudgetCategory, number>>;

export type BudgetViolation = {
  category: BudgetCategory;
  allocated: number;
  actual: number;
  overBy: number;
};

const DEFAULT_RATIOS: Record<BudgetCategory, number> = {
  systemPrompt: 0.2,
  hotState: 0.0,
  history: 0.5,
  toolResults: 0.15,
  outputReserve: 0.15,
};

/**
 * Allocate context budget across categories.
 *
 * @param contextWindow - Total context window size in tokens
 * @param options - Optional ratio overrides (must sum to ≤ 1.0)
 * @returns Token budget per category
 */
export function allocateBudget(
  contextWindow: number,
  options?: { ratios?: BudgetOverride },
): BudgetAllocation {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    throw new Error(`Invalid context window: ${contextWindow}`);
  }

  const ratios = { ...DEFAULT_RATIOS, ...options?.ratios };

  // Validate ratios
  const total = Object.values(ratios).reduce((sum, r) => sum + r, 0);
  if (total > 1.0 + 1e-9) {
    throw new Error(`Budget ratios sum to ${total}, which exceeds 1.0`);
  }
  for (const [key, val] of Object.entries(ratios)) {
    if (val < 0) {
      throw new Error(`Negative ratio for ${key}: ${val}`);
    }
  }

  const allocation: Partial<BudgetAllocation> = {};
  for (const key of Object.keys(ratios) as BudgetCategory[]) {
    allocation[key] = Math.floor(contextWindow * ratios[key]);
  }

  return allocation as BudgetAllocation;
}

/**
 * Check which categories are over budget.
 *
 * @param allocated - Budget allocation from `allocateBudget`
 * @param actual - Actual token counts per category
 * @returns Array of violations (empty if all within budget)
 */
export function checkBudget(
  allocated: BudgetAllocation,
  actual: Partial<Record<BudgetCategory, number>>,
): BudgetViolation[] {
  const violations: BudgetViolation[] = [];

  for (const category of Object.keys(allocated) as BudgetCategory[]) {
    const budgeted = allocated[category];
    const used = actual[category] ?? 0;
    if (used > budgeted) {
      violations.push({
        category,
        allocated: budgeted,
        actual: used,
        overBy: used - budgeted,
      });
    }
  }

  return violations;
}
