import { describe, expect, it } from "vitest";
import { allocateBudget, checkBudget } from "./context-budgeter.js";

describe("allocateBudget", () => {
  it("allocates default ratios for 100k context", () => {
    const budget = allocateBudget(100_000);
    expect(budget.systemPrompt).toBe(20_000);
    expect(budget.history).toBe(50_000);
    expect(budget.toolResults).toBe(15_000);
    expect(budget.outputReserve).toBe(15_000);
    expect(budget.hotState).toBe(0);
  });

  it("allocates default ratios for 200k context", () => {
    const budget = allocateBudget(200_000);
    expect(budget.systemPrompt).toBe(40_000);
    expect(budget.history).toBe(100_000);
  });

  it("respects custom ratios", () => {
    const budget = allocateBudget(100_000, {
      ratios: { systemPrompt: 0.1, history: 0.55, hotState: 0.05 },
    });
    expect(budget.systemPrompt).toBe(10_000);
    expect(budget.history).toBe(55_000);
    expect(budget.hotState).toBe(5_000);
    expect(budget.toolResults).toBe(15_000); // default preserved
  });

  it("throws on invalid context window", () => {
    expect(() => allocateBudget(0)).toThrow();
    expect(() => allocateBudget(-1)).toThrow();
    expect(() => allocateBudget(NaN)).toThrow();
  });

  it("throws when ratios exceed 1.0", () => {
    expect(() => allocateBudget(100_000, { ratios: { systemPrompt: 0.5, history: 0.6 } })).toThrow(
      "exceeds 1.0",
    );
  });

  it("throws on negative ratios", () => {
    expect(() => allocateBudget(100_000, { ratios: { history: -0.1 } })).toThrow("Negative");
  });

  it("floors fractional token counts", () => {
    const budget = allocateBudget(333);
    expect(Number.isInteger(budget.systemPrompt)).toBe(true);
    expect(Number.isInteger(budget.history)).toBe(true);
  });

  it("handles small context windows", () => {
    const budget = allocateBudget(100);
    expect(budget.systemPrompt).toBe(20);
    expect(budget.history).toBe(50);
  });

  it("allows ratios summing to less than 1.0", () => {
    const budget = allocateBudget(100_000, {
      ratios: {
        systemPrompt: 0.1,
        history: 0.3,
        toolResults: 0.1,
        outputReserve: 0.1,
        hotState: 0.1,
      },
    });
    expect(
      budget.systemPrompt +
        budget.history +
        budget.toolResults +
        budget.outputReserve +
        budget.hotState,
    ).toBe(70_000);
  });
});

describe("checkBudget", () => {
  const budget = allocateBudget(100_000);

  it("returns empty array when within budget", () => {
    const violations = checkBudget(budget, {
      systemPrompt: 15_000,
      history: 40_000,
      toolResults: 10_000,
    });
    expect(violations).toEqual([]);
  });

  it("detects single violation", () => {
    const violations = checkBudget(budget, { history: 60_000 });
    expect(violations).toHaveLength(1);
    expect(violations[0].category).toBe("history");
    expect(violations[0].overBy).toBe(10_000);
  });

  it("detects multiple violations", () => {
    const violations = checkBudget(budget, {
      systemPrompt: 25_000,
      history: 55_000,
    });
    expect(violations).toHaveLength(2);
  });

  it("treats missing categories as zero", () => {
    const violations = checkBudget(budget, {});
    expect(violations).toEqual([]);
  });

  it("exact budget is not a violation", () => {
    const violations = checkBudget(budget, { history: 50_000 });
    expect(violations).toEqual([]);
  });
});
