import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import {
  decideSessionAutoCompact,
  hasOversizedMessageForSummary,
  resolveSessionAutoCompactConfig,
} from "./session-auto-compact.js";

describe("session auto-compaction", () => {
  it("resolveSessionAutoCompactConfig defaults", () => {
    expect(resolveSessionAutoCompactConfig(undefined)).toEqual({
      enabled: false,
      thresholdContextRatio: 0.5,
      minIntervalMs: 10 * 60 * 1000,
    });
  });

  it("decideSessionAutoCompact respects threshold + rate limits + token growth", () => {
    const cfg = { enabled: true, thresholdContextRatio: 0.5, minIntervalMs: 1000 } as const;

    expect(
      decideSessionAutoCompact({
        cfg,
        totalTokens: 10,
        contextTokens: 100,
        now: 1_000,
        lastAutoCompactAt: 0,
        lastAutoCompactAtTokens: 0,
      }),
    ).toMatchObject({ shouldCompact: false, reason: "below-threshold" });

    expect(
      decideSessionAutoCompact({
        cfg,
        totalTokens: 50,
        contextTokens: 100,
        now: 1_000,
        lastAutoCompactAt: 900,
        lastAutoCompactAtTokens: 0,
      }),
    ).toMatchObject({ shouldCompact: false, reason: "rate-limited" });

    expect(
      decideSessionAutoCompact({
        cfg,
        totalTokens: 50,
        contextTokens: 100,
        now: 2_500,
        lastAutoCompactAt: 1_000,
        lastAutoCompactAtTokens: 60,
      }),
    ).toMatchObject({ shouldCompact: false, reason: "no-token-growth" });

    expect(
      decideSessionAutoCompact({
        cfg,
        totalTokens: 50,
        contextTokens: 100,
        now: 2_500,
        lastAutoCompactAt: 1_000,
        lastAutoCompactAtTokens: 40,
      }),
    ).toMatchObject({ shouldCompact: true, reason: "threshold-hit" });
  });

  it("hasOversizedMessageForSummary blocks compaction when a single message is huge", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "word ".repeat(800) }],
        timestamp: Date.now(),
      },
    ];

    expect(hasOversizedMessageForSummary(messages, 1000)).toBe(true);
    expect(hasOversizedMessageForSummary(messages, 50_000)).toBe(false);
  });
});
