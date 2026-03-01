/**
 * Context Discipline — orchestrator that combines budgeter + tool truncation + history pruning.
 *
 * Proactive context budgeting to complement reactive semantic compaction.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  allocateBudget,
  checkBudget,
  type BudgetAllocation,
  type BudgetOverride,
} from "./context-budgeter.js";
import { estimateHistoryTokens, pruneHistory, type HistoryMessage } from "./history-budget.js";
import { truncateToolResults } from "./tool-result-budget.js";

const log = createSubsystemLogger("context-discipline");

const CHARS_PER_TOKEN = 4;

export type ContextDisciplineParams = {
  /** Total model context window in tokens */
  contextWindow: number;
  /** System prompt text */
  systemPrompt: string;
  /** Hot state text (e.g., workspace files, injected context) */
  hotState?: string;
  /** Conversation history */
  messages: HistoryMessage[];
  /** Tool results pending inclusion */
  toolResults?: Array<{ id: string; content: string }>;
  /** Optional budget ratio overrides */
  budgetOverrides?: BudgetOverride;
  /** Minimum recent turns to preserve (default 4) */
  minRecentTurns?: number;
};

export type ContextDisciplineResult = {
  systemPrompt: string;
  messages: HistoryMessage[];
  toolResults: Array<{ id: string; content: string; wasTruncated: boolean }>;
  budget: BudgetAllocation;
  actions: string[];
};

function estimateTokensFromChars(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Enforce context discipline: budget allocation, tool result truncation, and history pruning.
 *
 * Returns a disciplined version of the context that fits within the model's window.
 */
export function enforceContextDiscipline(params: ContextDisciplineParams): ContextDisciplineResult {
  const {
    contextWindow,
    systemPrompt,
    hotState = "",
    messages,
    toolResults = [],
    budgetOverrides,
    minRecentTurns,
  } = params;

  const budget = allocateBudget(contextWindow, { ratios: budgetOverrides });
  const actions: string[] = [];

  // 1. Check system prompt + hot state fit
  const systemTokens = estimateTokensFromChars(systemPrompt);
  const hotStateTokens = estimateTokensFromChars(hotState);
  const combinedSystemTokens = systemTokens + hotStateTokens;

  if (combinedSystemTokens > budget.systemPrompt + budget.hotState) {
    actions.push(
      `System prompt + hot state (${combinedSystemTokens} tokens) exceeds budget (${budget.systemPrompt + budget.hotState} tokens)`,
    );
  }

  // 2. Truncate tool results if needed
  const toolResultTokenBudget = budget.toolResults;
  const toolResultCharBudget = toolResultTokenBudget * CHARS_PER_TOKEN;
  const processedToolResults = truncateToolResults(toolResults, toolResultCharBudget);

  const truncatedTools = processedToolResults.filter((r) => r.wasTruncated);
  if (truncatedTools.length > 0) {
    actions.push(
      `Truncated ${truncatedTools.length} tool result(s) to fit ${toolResultTokenBudget} token budget`,
    );
    log.info(`Truncated ${truncatedTools.length} tool results`, {
      ids: truncatedTools.map((t) => t.id),
    });
  }

  // 3. Prune history if needed
  const historyResult = pruneHistory(messages, budget.history, { minRecentTurns });

  if (historyResult.prunedCount > 0) {
    actions.push(
      `Pruned ${historyResult.prunedCount} message(s) from history: ${historyResult.tokensBefore} → ${historyResult.tokensAfter} tokens`,
    );
    log.info(`Pruned history`, {
      prunedCount: historyResult.prunedCount,
      tokensBefore: historyResult.tokensBefore,
      tokensAfter: historyResult.tokensAfter,
    });
  }

  // 4. Final budget check
  const actual = {
    systemPrompt: systemTokens,
    hotState: hotStateTokens,
    history: estimateHistoryTokens(historyResult.messages),
    toolResults: estimateTokensFromChars(processedToolResults.map((r) => r.content).join("")),
    outputReserve: 0,
  };

  const violations = checkBudget(budget, actual);
  if (violations.length > 0) {
    for (const v of violations) {
      actions.push(
        `Warning: ${v.category} still over budget by ${v.overBy} tokens after discipline`,
      );
    }
    log.warn(`Budget violations remain after discipline`, { violations });
  }

  if (actions.length === 0) {
    actions.push("All context within budget — no adjustments needed");
  }

  return {
    systemPrompt,
    messages: historyResult.messages,
    toolResults: processedToolResults,
    budget,
    actions,
  };
}
