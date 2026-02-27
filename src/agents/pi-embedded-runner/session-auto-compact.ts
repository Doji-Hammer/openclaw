import fs from "node:fs/promises";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { estimateTokens } from "@mariozechner/pi-coding-agent";
import type { OpenClawConfig } from "../../config/config.js";
import { SAFETY_MARGIN } from "../compaction.js";

export type SessionAutoCompactConfig = {
  enabled?: boolean;
  /** Auto-compact when totalTokens/contextTokens exceeds this ratio (default: 0.5). */
  thresholdContextRatio?: number;
  /** Minimum time between auto-compactions for the same session (default: 10 minutes). */
  minIntervalMs?: number;
};

export type ResolvedSessionAutoCompactConfig = Required<SessionAutoCompactConfig>;

export function resolveSessionAutoCompactConfig(
  cfg?: OpenClawConfig,
): ResolvedSessionAutoCompactConfig {
  const raw =
    (cfg?.agents?.defaults as { safeguards?: { sessionAutoCompact?: SessionAutoCompactConfig } })
      ?.safeguards?.sessionAutoCompact ?? {};

  return {
    // Default off: compaction is disruptive and should be explicitly enabled.
    enabled: raw.enabled ?? false,
    thresholdContextRatio:
      typeof raw.thresholdContextRatio === "number" && Number.isFinite(raw.thresholdContextRatio)
        ? raw.thresholdContextRatio
        : 0.5,
    minIntervalMs:
      typeof raw.minIntervalMs === "number" && Number.isFinite(raw.minIntervalMs)
        ? Math.floor(raw.minIntervalMs)
        : 10 * 60 * 1000,
  };
}

export type SessionAutoCompactDecision =
  | { shouldCompact: false; reason: string }
  | { shouldCompact: true; reason: string };

export function decideSessionAutoCompact(params: {
  cfg: ResolvedSessionAutoCompactConfig;
  totalTokens: number;
  contextTokens: number;
  now: number;
  lastAutoCompactAt: number;
  lastAutoCompactAtTokens: number;
}): SessionAutoCompactDecision {
  const { cfg, totalTokens, contextTokens, now, lastAutoCompactAt, lastAutoCompactAtTokens } =
    params;

  if (!cfg.enabled) {
    return { shouldCompact: false, reason: "disabled" };
  }

  if (!(totalTokens > 0) || !(contextTokens > 0)) {
    return { shouldCompact: false, reason: "missing-token-metrics" };
  }

  const ratio = totalTokens / contextTokens;
  if (!(ratio >= cfg.thresholdContextRatio)) {
    return { shouldCompact: false, reason: "below-threshold" };
  }

  if (lastAutoCompactAt > 0 && now - lastAutoCompactAt < cfg.minIntervalMs) {
    return { shouldCompact: false, reason: "rate-limited" };
  }

  // Avoid repeated compactions at the same token count (e.g. after a restart).
  if (totalTokens <= lastAutoCompactAtTokens) {
    return { shouldCompact: false, reason: "no-token-growth" };
  }

  return { shouldCompact: true, reason: "threshold-hit" };
}

export function hasOversizedMessageForSummary(
  messages: AgentMessage[],
  contextWindowTokens: number,
): boolean {
  const limit = contextWindowTokens * 0.5;
  for (const msg of messages) {
    const tokens = estimateTokens(msg) * SAFETY_MARGIN;
    if (tokens > limit) {
      return true;
    }
  }
  return false;
}

export async function readSessionMessagesFromJsonl(sessionFile: string): Promise<AgentMessage[]> {
  const raw = await fs.readFile(sessionFile, "utf-8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const messages: AgentMessage[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") {
      continue;
    }
    const rec = parsed as { type?: unknown; message?: unknown };
    if (rec.type !== "message" || !rec.message || typeof rec.message !== "object") {
      continue;
    }
    messages.push(rec.message as AgentMessage);
  }
  return messages;
}

export function estimateSessionTotalTokens(messages: AgentMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateTokens(message);
  }
  return total;
}

// Process-local rate-limit state (avoid compaction loops).
// Keyed by sessionKey/sessionId label.
const AUTO_COMPACT_STATE = new Map<
  string,
  {
    lastAt: number;
    lastAtTokens: number;
  }
>();

export function getAutoCompactState(key: string): { lastAt: number; lastAtTokens: number } {
  const found = AUTO_COMPACT_STATE.get(key);
  return found ?? { lastAt: 0, lastAtTokens: 0 };
}

export function setAutoCompactState(
  key: string,
  next: { lastAt: number; lastAtTokens: number },
): void {
  AUTO_COMPACT_STATE.set(key, next);
}
