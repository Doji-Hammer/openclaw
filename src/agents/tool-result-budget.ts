/**
 * Tool Result Truncation — intelligently truncate tool results that exceed budget.
 *
 * Preserves first N and last M characters with a "[truncated X chars]" marker.
 * Attempts to preserve JSON structure boundaries when possible.
 */

/**
 * Truncate a tool result string to fit within a character budget.
 *
 * @param content - The tool result content
 * @param maxChars - Maximum allowed characters
 * @param options - Tuning options
 * @returns Truncated content, or original if within budget
 */
export function truncateToolResult(
  content: string,
  maxChars: number,
  options?: {
    /** Fraction of budget for the head portion (default 0.6) */
    headRatio?: number;
    /** Whether to try JSON-aware truncation (default true) */
    jsonAware?: boolean;
  },
): string {
  if (content.length <= maxChars) {
    return content;
  }

  if (maxChars <= 0) {
    return "[truncated entire content]";
  }

  const headRatio = options?.headRatio ?? 0.6;
  const jsonAware = options?.jsonAware !== false;
  const markerTemplate = `\n[… truncated 00000 chars …]\n`;
  const markerOverhead = markerTemplate.length + 10; // extra room for large numbers

  const available = maxChars - markerOverhead;
  if (available <= 0) {
    const truncated = content.length - maxChars;
    return (
      content.slice(0, Math.max(maxChars, 0)) +
      (truncated > 0 ? `\n[… truncated ${content.length} chars …]` : "")
    );
  }

  let headLen = Math.floor(available * headRatio);
  let tailLen = available - headLen;

  // JSON-aware: try to break at structure boundaries
  if (jsonAware && looksLikeJson(content)) {
    headLen = adjustToJsonBoundary(content, headLen, "head");
    tailLen = adjustToJsonBoundary(content, tailLen, "tail");
  }

  // Ensure we don't exceed content length
  headLen = Math.min(headLen, content.length);
  tailLen = Math.min(tailLen, content.length - headLen);

  const truncatedCount = content.length - headLen - tailLen;
  if (truncatedCount <= 0) {
    return content;
  }

  const head = content.slice(0, headLen);
  const tail = content.slice(content.length - tailLen);
  return `${head}\n[… truncated ${truncatedCount} chars …]\n${tail}`;
}

/**
 * Truncate multiple tool results to fit within a total budget.
 * Distributes budget proportionally based on original sizes.
 */
export function truncateToolResults(
  results: Array<{ id: string; content: string }>,
  totalBudgetChars: number,
): Array<{ id: string; content: string; wasTruncated: boolean }> {
  const totalOriginal = results.reduce((sum, r) => sum + r.content.length, 0);

  if (totalOriginal <= totalBudgetChars) {
    return results.map((r) => ({ ...r, wasTruncated: false }));
  }

  return results.map((r) => {
    const proportion = totalOriginal > 0 ? r.content.length / totalOriginal : 1 / results.length;
    const budget = Math.floor(totalBudgetChars * proportion);
    const truncated = truncateToolResult(r.content, budget);
    return {
      id: r.id,
      content: truncated,
      wasTruncated: truncated !== r.content,
    };
  });
}

function looksLikeJson(content: string): boolean {
  const trimmed = content.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/**
 * Adjust a cut position to avoid cutting mid-JSON-object.
 * Scans backwards (for head) or forwards (for tail) to find a line break
 * near a closing brace/bracket.
 */
function adjustToJsonBoundary(
  content: string,
  targetLen: number,
  direction: "head" | "tail",
): number {
  const scanRange = Math.min(200, Math.floor(targetLen * 0.15));

  if (direction === "head") {
    // Scan backwards from targetLen to find a good break point
    for (let i = targetLen; i > targetLen - scanRange && i > 0; i--) {
      const ch = content[i];
      if (ch === "\n" || ch === "," || ch === "}" || ch === "]") {
        return i + 1;
      }
    }
  } else {
    // For tail, we want to find the start position of the tail
    const startFrom = content.length - targetLen;
    for (let i = startFrom; i < startFrom + scanRange && i < content.length; i++) {
      const ch = content[i];
      if (ch === "\n" || ch === "{" || ch === "[") {
        return content.length - i;
      }
    }
  }

  return targetLen;
}
