/**
 * History Pruning Strategy — prune conversation history to fit within budget.
 *
 * Strategy:
 * - Keep system messages always
 * - Keep the most recent N turns intact
 * - Prune oldest non-system turns first
 * - Uses character-based token estimation (≈4 chars per token)
 */

export type HistoryMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
};

export type PruneResult = {
  messages: HistoryMessage[];
  prunedCount: number;
  tokensBefore: number;
  tokensAfter: number;
};

const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count for a single message.
 */
export function estimateMessageTokens(message: HistoryMessage): number {
  let charCount: number;
  if (typeof message.content === "string") {
    charCount = message.content.length;
  } else {
    charCount = message.content.reduce((sum, part) => {
      if (part.type === "text" && typeof part.text === "string") {
        return sum + part.text.length;
      }
      // Non-text parts: rough estimate
      return sum + 100;
    }, 0);
  }
  // Add overhead for role, formatting
  return Math.ceil((charCount + 10) / CHARS_PER_TOKEN);
}

/**
 * Estimate tokens for all messages.
 */
export function estimateHistoryTokens(messages: HistoryMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

/**
 * Prune conversation history to fit within a token budget.
 *
 * @param messages - Full conversation history
 * @param budgetTokens - Maximum tokens for history
 * @param options - Configuration
 * @returns Pruned messages and metadata
 */
export function pruneHistory(
  messages: HistoryMessage[],
  budgetTokens: number,
  options?: {
    /** Minimum number of recent turns to keep (default 4) */
    minRecentTurns?: number;
  },
): PruneResult {
  const minRecent = options?.minRecentTurns ?? 4;
  const tokensBefore = estimateHistoryTokens(messages);

  if (tokensBefore <= budgetTokens) {
    return { messages: [...messages], prunedCount: 0, tokensBefore, tokensAfter: tokensBefore };
  }

  // Separate system messages and non-system messages
  const systemMessages: Array<{ index: number; msg: HistoryMessage }> = [];
  const nonSystemMessages: Array<{ index: number; msg: HistoryMessage }> = [];

  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "system") {
      systemMessages.push({ index: i, msg: messages[i] });
    } else {
      nonSystemMessages.push({ index: i, msg: messages[i] });
    }
  }

  // Count recent "turns" (user messages) from the end
  let recentTurnCount = 0;
  let recentCutoff = nonSystemMessages.length;
  for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
    if (nonSystemMessages[i].msg.role === "user") {
      recentTurnCount++;
      if (recentTurnCount >= minRecent) {
        recentCutoff = i;
        break;
      }
    }
  }

  // Protected messages: system + recent turns
  const protectedIndices = new Set<number>();
  for (const s of systemMessages) protectedIndices.add(s.index);
  for (let i = recentCutoff; i < nonSystemMessages.length; i++) {
    protectedIndices.add(nonSystemMessages[i].index);
  }

  // Prune from oldest non-protected until within budget
  const kept = [...messages];
  const pruneIndices: number[] = [];

  // Collect pruneable indices (oldest first)
  for (let i = 0; i < messages.length; i++) {
    if (!protectedIndices.has(i)) {
      pruneIndices.push(i);
    }
  }

  // Remove messages one at a time until within budget
  const removedSet = new Set<number>();
  let currentTokens = tokensBefore;

  for (const idx of pruneIndices) {
    if (currentTokens <= budgetTokens) break;
    currentTokens -= estimateMessageTokens(messages[idx]);
    removedSet.add(idx);
  }

  const result = messages.filter((_, i) => !removedSet.has(i));
  const tokensAfter = estimateHistoryTokens(result);

  return {
    messages: result,
    prunedCount: removedSet.size,
    tokensBefore,
    tokensAfter,
  };
}
