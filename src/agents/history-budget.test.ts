import { describe, expect, it } from "vitest";
import {
  estimateHistoryTokens,
  estimateMessageTokens,
  pruneHistory,
  type HistoryMessage,
} from "./history-budget.js";

const msg = (role: HistoryMessage["role"], content: string): HistoryMessage => ({ role, content });

describe("estimateMessageTokens", () => {
  it("returns positive for non-empty message", () => {
    expect(estimateMessageTokens(msg("user", "hello"))).toBeGreaterThan(0);
  });

  it("scales with content length", () => {
    const short = estimateMessageTokens(msg("user", "hi"));
    const long = estimateMessageTokens(msg("user", "a".repeat(1000)));
    expect(long).toBeGreaterThan(short);
  });

  it("handles array content", () => {
    const m: HistoryMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hello world" }],
    };
    expect(estimateMessageTokens(m)).toBeGreaterThan(0);
  });

  it("handles non-text content parts", () => {
    const m: HistoryMessage = {
      role: "assistant",
      content: [{ type: "image", url: "data:..." }],
    };
    expect(estimateMessageTokens(m)).toBeGreaterThan(0);
  });
});

describe("estimateHistoryTokens", () => {
  it("sums across messages", () => {
    const msgs = [msg("user", "hello"), msg("assistant", "hi there")];
    const total = estimateHistoryTokens(msgs);
    const sum = estimateMessageTokens(msgs[0]) + estimateMessageTokens(msgs[1]);
    expect(total).toBe(sum);
  });

  it("returns 0 for empty array", () => {
    expect(estimateHistoryTokens([])).toBe(0);
  });
});

describe("pruneHistory", () => {
  it("returns all messages when within budget", () => {
    const msgs = [msg("user", "hi"), msg("assistant", "hello")];
    const result = pruneHistory(msgs, 10_000);
    expect(result.messages).toHaveLength(2);
    expect(result.prunedCount).toBe(0);
  });

  it("prunes oldest messages first", () => {
    const msgs = [
      msg("user", "old message 1"),
      msg("assistant", "old reply 1"),
      msg("user", "old message 2"),
      msg("assistant", "old reply 2"),
      msg("user", "recent 1"),
      msg("assistant", "recent reply 1"),
      msg("user", "recent 2"),
      msg("assistant", "recent reply 2"),
      msg("user", "recent 3"),
      msg("assistant", "recent reply 3"),
      msg("user", "recent 4"),
      msg("assistant", "recent reply 4"),
    ];
    // Set budget so old messages must be pruned
    const fullTokens = estimateHistoryTokens(msgs);
    const result = pruneHistory(msgs, Math.floor(fullTokens * 0.7));
    expect(result.prunedCount).toBeGreaterThan(0);
    // Recent messages should be preserved
    expect(result.messages[result.messages.length - 1].content).toBe("recent reply 4");
  });

  it("keeps system messages always", () => {
    const msgs = [
      msg("system", "You are a helpful assistant"),
      msg("user", "old" + "x".repeat(500)),
      msg("assistant", "old reply" + "x".repeat(500)),
      msg("user", "recent"),
      msg("assistant", "recent reply"),
    ];
    const result = pruneHistory(msgs, 50);
    expect(result.messages.some((m) => m.role === "system")).toBe(true);
  });

  it("respects minRecentTurns", () => {
    const msgs: HistoryMessage[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push(msg("user", `message ${i} ${"x".repeat(100)}`));
      msgs.push(msg("assistant", `reply ${i} ${"x".repeat(100)}`));
    }
    const result = pruneHistory(msgs, 100, { minRecentTurns: 2 });
    // Should keep at least 2 user turns from the end
    const keptUserMsgs = result.messages.filter((m) => m.role === "user");
    expect(keptUserMsgs.length).toBeGreaterThanOrEqual(2);
  });

  it("handles empty history", () => {
    const result = pruneHistory([], 1000);
    expect(result.messages).toEqual([]);
    expect(result.prunedCount).toBe(0);
  });

  it("reports correct token counts", () => {
    const msgs = [
      msg("user", "a".repeat(400)),
      msg("assistant", "b".repeat(400)),
      msg("user", "c".repeat(400)),
      msg("assistant", "d".repeat(400)),
    ];
    const result = pruneHistory(msgs, 50);
    expect(result.tokensBefore).toBeGreaterThan(result.tokensAfter);
  });

  it("handles all system messages", () => {
    const msgs = [msg("system", "sys1"), msg("system", "sys2")];
    const result = pruneHistory(msgs, 5);
    // System messages are protected; can't prune them
    expect(result.messages).toHaveLength(2);
  });
});
