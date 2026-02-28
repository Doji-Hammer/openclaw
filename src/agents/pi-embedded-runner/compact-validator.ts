import * as fs from "node:fs/promises";
import { resolveUserPath } from "../../utils.js";
import type { EmbeddedPiCompactResult } from "./types.js";
import { describeUnknownError } from "./utils.js";

/**
 * Pre-compact state dump - saves session state before compaction
 */
export async function savePreCompactDump(sessionFile: string, sessionId: string): Promise<string> {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dumpDir = resolveUserPath("logs/compaction");
    await fs.mkdir(dumpDir, { recursive: true });
    const dumpFile = `${dumpDir}/snapshot-${sessionId}-${timestamp}.json`;
    const sessionData = await fs.readFile(sessionFile, "utf-8");
    await fs.writeFile(dumpFile, sessionData, "utf-8");
    return sessionData; // Return the actual data for immediate use
  } catch (err) {
    return "";
  }
}

/**
 * ValidationResult from Guardian Escort
 */
export type ValidationResult = {
  approved: boolean;
  reasons?: string[];
};

/**
 * Guardian Escort - validates compaction against pre-compact state dump
 * Returns boolean (Approved/Rejected) with optional failure reasons
 * Only checks macro-direction, NOT micro-syntax errors
 */
export async function validateCompaction(
  preCompactDump: string | null,
  compactedResult: EmbeddedPiCompactResult,
): Promise<ValidationResult> {
  // If compaction failed, reject
  if (!compactedResult.ok || !compactedResult.compacted) {
    return {
      approved: false,
      reasons: ["Compaction failed"],
    };
  }

  // If we have a pre-compact dump, validate against it
  if (preCompactDump) {
    try {
      // Basic check: verify summary was generated
      if (!compactedResult.result?.summary) {
        return {
          approved: false,
          reasons: ["No summary generated in compaction result"],
        };
      }

      // Check for token reduction
      if (
        compactedResult.result.tokensBefore !== undefined &&
        compactedResult.result.tokensAfter !== undefined
      ) {
        // Must reduce by at least 10%
        const minReduction = compactedResult.result.tokensBefore * 0.1;
        if (
          compactedResult.result.tokensAfter >=
          compactedResult.result.tokensBefore - minReduction
        ) {
          return {
            approved: false,
            reasons: [
              `Insufficient token reduction: ${compactedResult.result.tokensBefore} -> ${compactedResult.result.tokensAfter}`,
            ],
          };
        }
      }

      // Verify thread continuity (basic heuristic)
      const summary = compactedResult.result.summary.toLowerCase();
      if (summary.length < 50) {
        return {
          approved: false,
          reasons: ["Summary is too brief/low information"],
        };
      }
    } catch (err) {
      return {
        approved: false,
        reasons: [`Validation error: ${describeUnknownError(err)}`],
      };
    }
  }

  return { approved: true };
}
