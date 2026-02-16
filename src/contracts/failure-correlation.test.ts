import { describe, expect, it } from "vitest";
import { ErrorTaxonomy } from "./error-taxonomy.js";
import { FailureCorrelator } from "./failure-correlation.js";

describe("FailureCorrelator", () => {
  it("detects cascade when threshold exceeded", () => {
    const fc = new FailureCorrelator({
      cascadeThreshold: 3,
      clusterThreshold: 10,
      windowMs: 60_000,
    });
    fc.recordFailure({ taskId: "t1", taxonomy: ErrorTaxonomy.MODEL_FAILURE, message: "fail1" });
    fc.recordFailure({ taskId: "t2", taxonomy: ErrorTaxonomy.TOOL_FAILURE, message: "fail2" });
    const alerts = fc.recordFailure({
      taskId: "t3",
      taxonomy: ErrorTaxonomy.TIMEOUT,
      message: "fail3",
    });
    expect(alerts.some((a) => a.type === "cascade")).toBe(true);
    expect(fc.isCascading()).toBe(true);
  });

  it("detects cluster by taxonomy", () => {
    const fc = new FailureCorrelator({
      cascadeThreshold: 100,
      clusterThreshold: 2,
      windowMs: 60_000,
    });
    fc.recordFailure({ taskId: "t1", taxonomy: ErrorTaxonomy.MODEL_FAILURE, message: "a" });
    const alerts = fc.recordFailure({
      taskId: "t2",
      taxonomy: ErrorTaxonomy.MODEL_FAILURE,
      message: "b",
    });
    expect(alerts.some((a) => a.type === "cluster" && a.dimension === "taxonomy")).toBe(true);
  });

  it("detects cluster by model", () => {
    const fc = new FailureCorrelator({
      cascadeThreshold: 100,
      clusterThreshold: 2,
      windowMs: 60_000,
    });
    fc.recordFailure({
      taskId: "t1",
      taxonomy: ErrorTaxonomy.MODEL_FAILURE,
      message: "a",
      modelId: "gpt-4o",
    });
    const alerts = fc.recordFailure({
      taskId: "t2",
      taxonomy: ErrorTaxonomy.MODEL_FAILURE,
      message: "b",
      modelId: "gpt-4o",
    });
    expect(alerts.some((a) => a.dimension === "model" && a.dimensionValue === "gpt-4o")).toBe(true);
  });

  it("detects cluster by provider", () => {
    const fc = new FailureCorrelator({
      cascadeThreshold: 100,
      clusterThreshold: 2,
      windowMs: 60_000,
    });
    fc.recordFailure({
      taskId: "t1",
      taxonomy: ErrorTaxonomy.MODEL_FAILURE,
      message: "a",
      provider: "openai",
    });
    const alerts = fc.recordFailure({
      taskId: "t2",
      taxonomy: ErrorTaxonomy.MODEL_FAILURE,
      message: "b",
      provider: "openai",
    });
    expect(alerts.some((a) => a.dimension === "provider")).toBe(true);
  });

  it("detects cluster by tool", () => {
    const fc = new FailureCorrelator({
      cascadeThreshold: 100,
      clusterThreshold: 2,
      windowMs: 60_000,
    });
    fc.recordFailure({
      taskId: "t1",
      taxonomy: ErrorTaxonomy.TOOL_FAILURE,
      message: "a",
      toolName: "browser",
    });
    const alerts = fc.recordFailure({
      taskId: "t2",
      taxonomy: ErrorTaxonomy.TOOL_FAILURE,
      message: "b",
      toolName: "browser",
    });
    expect(alerts.some((a) => a.dimension === "tool")).toBe(true);
  });

  it("detects repeated message pattern", () => {
    const fc = new FailureCorrelator({
      cascadeThreshold: 100,
      clusterThreshold: 2,
      windowMs: 60_000,
    });
    fc.recordFailure({
      taskId: "t1",
      taxonomy: ErrorTaxonomy.MODEL_FAILURE,
      message: "same error",
    });
    const alerts = fc.recordFailure({
      taskId: "t2",
      taxonomy: ErrorTaxonomy.MODEL_FAILURE,
      message: "same error",
    });
    expect(alerts.some((a) => a.type === "pattern")).toBe(true);
  });

  it("is not cascading when below threshold", () => {
    const fc = new FailureCorrelator({ cascadeThreshold: 10 });
    fc.recordFailure({ taskId: "t1", taxonomy: ErrorTaxonomy.MODEL_FAILURE, message: "fail" });
    expect(fc.isCascading()).toBe(false);
  });

  it("deduplicates alerts", () => {
    const fc = new FailureCorrelator({
      cascadeThreshold: 2,
      clusterThreshold: 100,
      windowMs: 60_000,
    });
    fc.recordFailure({ taskId: "t1", taxonomy: ErrorTaxonomy.MODEL_FAILURE, message: "a" });
    fc.recordFailure({ taskId: "t2", taxonomy: ErrorTaxonomy.TOOL_FAILURE, message: "b" });
    fc.recordFailure({ taskId: "t3", taxonomy: ErrorTaxonomy.TIMEOUT, message: "c" });
    // Should only have 1 cascade alert, not multiple
    const cascades = fc.getAlerts().filter((a) => a.type === "cascade");
    expect(cascades).toHaveLength(1);
  });

  it("resets all state", () => {
    const fc = new FailureCorrelator();
    fc.recordFailure({ taskId: "t1", taxonomy: ErrorTaxonomy.MODEL_FAILURE, message: "fail" });
    fc.reset();
    expect(fc.getEvents()).toHaveLength(0);
    expect(fc.getAlerts()).toHaveLength(0);
  });

  it("trims old events beyond maxEvents", () => {
    const fc = new FailureCorrelator({ maxEvents: 3 });
    for (let i = 0; i < 5; i++) {
      fc.recordFailure({
        taskId: `t${i}`,
        taxonomy: ErrorTaxonomy.MODEL_FAILURE,
        message: `fail${i}`,
      });
    }
    expect(fc.getEvents()).toHaveLength(3);
  });
});
