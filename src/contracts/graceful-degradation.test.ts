import { describe, expect, it } from "vitest";
import type { SystemHealth } from "./graceful-degradation.js";
import { DegradationManager, DegradationLevel } from "./graceful-degradation.js";

const healthy: SystemHealth = {
  failureRate: 0,
  circuitOpen: false,
  cascading: false,
  costBudgetUsed: 0,
  errorCount: 0,
};

describe("DegradationManager", () => {
  it("starts at NORMAL level", () => {
    const mgr = new DegradationManager();
    expect(mgr.getLevel()).toBe(DegradationLevel.NORMAL);
  });

  it("stays NORMAL when healthy", () => {
    const mgr = new DegradationManager();
    const result = mgr.evaluate(healthy);
    expect(result.level).toBe(DegradationLevel.NORMAL);
    expect(result.changed).toBe(false);
    expect(result.disabledFeatures).toHaveLength(0);
  });

  it("degrades to REDUCED on moderate failure rate", () => {
    const mgr = new DegradationManager();
    const result = mgr.evaluate({ ...healthy, failureRate: 0.35 });
    expect(result.level).toBe(DegradationLevel.REDUCED);
    expect(result.changed).toBe(true);
    expect(result.disabledFeatures).toContain("browser");
  });

  it("degrades to MINIMAL on cascading failure", () => {
    const mgr = new DegradationManager();
    const result = mgr.evaluate({ ...healthy, cascading: true });
    expect(result.level).toBe(DegradationLevel.MINIMAL);
    expect(result.disabledFeatures).toContain("tool_execution");
  });

  it("degrades to EMERGENCY on high failure + open circuit", () => {
    const mgr = new DegradationManager();
    const result = mgr.evaluate({ ...healthy, failureRate: 0.6, circuitOpen: true });
    expect(result.level).toBe(DegradationLevel.EMERGENCY);
    expect(result.disabledFeatures).toContain("complex_planning");
  });

  it("degrades to MINIMAL on high cost budget usage", () => {
    const mgr = new DegradationManager();
    const result = mgr.evaluate({ ...healthy, costBudgetUsed: 0.95 });
    expect(result.level).toBe(DegradationLevel.MINIMAL);
  });

  it("degrades on high error count", () => {
    const mgr = new DegradationManager();
    const result = mgr.evaluate({ ...healthy, errorCount: 15 });
    expect(result.level).toBe(DegradationLevel.REDUCED);
  });

  it("recovers to NORMAL when health improves", () => {
    const mgr = new DegradationManager();
    mgr.evaluate({ ...healthy, failureRate: 0.4 });
    expect(mgr.getLevel()).toBe(DegradationLevel.REDUCED);
    const result = mgr.evaluate(healthy);
    expect(result.level).toBe(DegradationLevel.NORMAL);
    expect(result.changed).toBe(true);
  });

  it("checks feature availability", () => {
    const mgr = new DegradationManager();
    mgr.evaluate({ ...healthy, cascading: true });
    expect(mgr.isFeatureAvailable("browser")).toBe(false);
    expect(mgr.isFeatureAvailable("memory")).toBe(true);
  });

  it("tracks history", () => {
    const mgr = new DegradationManager();
    mgr.evaluate({ ...healthy, failureRate: 0.4 });
    mgr.evaluate(healthy);
    const history = mgr.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it("supports force level", () => {
    const mgr = new DegradationManager();
    mgr.forceLevel(DegradationLevel.EMERGENCY, "manual override");
    expect(mgr.getLevel()).toBe(DegradationLevel.EMERGENCY);
    expect(mgr.getHistory().at(-1)?.reason).toContain("FORCED");
  });

  it("resets to NORMAL", () => {
    const mgr = new DegradationManager();
    mgr.evaluate({ ...healthy, cascading: true });
    mgr.reset();
    expect(mgr.getLevel()).toBe(DegradationLevel.NORMAL);
    expect(mgr.getDisabledFeatures()).toHaveLength(0);
  });

  it("supports custom rules", () => {
    const mgr = new DegradationManager([
      {
        condition: { errorCountThreshold: 1 },
        level: DegradationLevel.EMERGENCY,
        disabledFeatures: ["everything"],
        description: "custom rule",
      },
    ]);
    const result = mgr.evaluate({ ...healthy, errorCount: 2 });
    expect(result.level).toBe(DegradationLevel.EMERGENCY);
    expect(result.disabledFeatures).toContain("everything");
  });
});
