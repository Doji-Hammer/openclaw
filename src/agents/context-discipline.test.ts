import { describe, expect, it } from "vitest";
import { enforceContextDiscipline } from "./context-discipline.js";
import type { HistoryMessage } from "./history-budget.js";

const msg = (role: HistoryMessage["role"], content: string): HistoryMessage => ({ role, content });

describe("enforceContextDiscipline", () => {
  it("returns unchanged context when everything fits", () => {
    const result = enforceContextDiscipline({
      contextWindow: 100_000,
      systemPrompt: "You are helpful.",
      messages: [msg("user", "hi"), msg("assistant", "hello")],
      toolResults: [{ id: "1", content: "result" }],
    });
    expect(result.messages).toHaveLength(2);
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0].wasTruncated).toBe(false);
    expect(result.actions).toContain("All context within budget — no adjustments needed");
  });

  it("truncates tool results when they exceed budget", () => {
    const result = enforceContextDiscipline({
      contextWindow: 1000,
      systemPrompt: "sys",
      messages: [msg("user", "hi")],
      toolResults: [{ id: "1", content: "a".repeat(5000) }],
    });
    expect(result.toolResults[0].wasTruncated).toBe(true);
    expect(result.actions.some((a) => a.includes("Truncated"))).toBe(true);
  });

  it("prunes history when it exceeds budget", () => {
    const messages: HistoryMessage[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push(msg("user", `message ${i} ${"x".repeat(200)}`));
      messages.push(msg("assistant", `reply ${i} ${"x".repeat(200)}`));
    }
    const result = enforceContextDiscipline({
      contextWindow: 1000,
      systemPrompt: "sys",
      messages,
    });
    expect(result.messages.length).toBeLessThan(40);
    expect(result.actions.some((a) => a.includes("Pruned"))).toBe(true);
  });

  it("warns about system prompt overbudget", () => {
    const result = enforceContextDiscipline({
      contextWindow: 100,
      systemPrompt: "x".repeat(500),
      messages: [msg("user", "hi")],
    });
    expect(result.actions.some((a) => a.includes("System prompt"))).toBe(true);
  });

  it("handles empty messages and tool results", () => {
    const result = enforceContextDiscipline({
      contextWindow: 100_000,
      systemPrompt: "sys",
      messages: [],
    });
    expect(result.messages).toEqual([]);
    expect(result.toolResults).toEqual([]);
  });

  it("returns budget allocation", () => {
    const result = enforceContextDiscipline({
      contextWindow: 100_000,
      systemPrompt: "sys",
      messages: [],
    });
    expect(result.budget.systemPrompt).toBe(20_000);
    expect(result.budget.history).toBe(50_000);
  });

  it("respects budget overrides", () => {
    const result = enforceContextDiscipline({
      contextWindow: 100_000,
      systemPrompt: "sys",
      messages: [],
      budgetOverrides: { systemPrompt: 0.1, history: 0.6 },
    });
    expect(result.budget.systemPrompt).toBe(10_000);
    expect(result.budget.history).toBe(60_000);
  });

  it("handles hot state", () => {
    const result = enforceContextDiscipline({
      contextWindow: 100,
      systemPrompt: "sys",
      hotState: "x".repeat(500),
      messages: [],
    });
    expect(result.actions.some((a) => a.includes("System prompt") || a.includes("hot state"))).toBe(
      true,
    );
  });

  it("applies both tool truncation and history pruning when needed", () => {
    const messages: HistoryMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push(msg("user", `msg ${i} ${"x".repeat(200)}`));
      messages.push(msg("assistant", `reply ${i} ${"x".repeat(200)}`));
    }
    const result = enforceContextDiscipline({
      contextWindow: 500,
      systemPrompt: "sys",
      messages,
      toolResults: [{ id: "1", content: "a".repeat(3000) }],
    });
    expect(result.toolResults[0].wasTruncated).toBe(true);
    expect(result.messages.length).toBeLessThan(20);
  });
});
