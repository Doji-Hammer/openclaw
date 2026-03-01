import { describe, expect, it } from "vitest";
import { truncateToolResult, truncateToolResults } from "./tool-result-budget.js";

describe("truncateToolResult", () => {
  it("returns original when within budget", () => {
    expect(truncateToolResult("short", 100)).toBe("short");
  });

  it("truncates long content with marker", () => {
    const content = "a".repeat(1000);
    const result = truncateToolResult(content, 200);
    expect(result.length).toBeLessThan(1000);
    expect(result).toContain("truncated");
    expect(result).toContain("chars");
  });

  it("preserves head and tail", () => {
    const content = "HEAD" + "x".repeat(1000) + "TAIL";
    const result = truncateToolResult(content, 200);
    expect(result.startsWith("HEAD")).toBe(true);
    expect(result.endsWith("TAIL")).toBe(true);
  });

  it("handles zero budget", () => {
    const result = truncateToolResult("hello", 0);
    expect(result).toContain("truncated");
  });

  it("handles content exactly at budget", () => {
    const content = "exact";
    expect(truncateToolResult(content, 5)).toBe("exact");
  });

  it("includes truncated char count in marker", () => {
    const content = "a".repeat(500);
    const result = truncateToolResult(content, 100);
    const match = result.match(/truncated (\d+) chars/);
    expect(match).not.toBeNull();
    const count = parseInt(match![1], 10);
    expect(count).toBeGreaterThan(0);
  });

  it("respects custom headRatio", () => {
    const content = "a".repeat(1000);
    const result1 = truncateToolResult(content, 200, { headRatio: 0.8 });
    const result2 = truncateToolResult(content, 200, { headRatio: 0.2 });
    // With higher headRatio, more content before the marker
    const marker1 = result1.indexOf("[…");
    const marker2 = result2.indexOf("[…");
    expect(marker1).toBeGreaterThan(marker2);
  });

  it("handles JSON content with jsonAware", () => {
    const json = JSON.stringify(
      {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: i,
          name: `item-${i}`,
          value: "x".repeat(20),
        })),
      },
      null,
      2,
    );
    const result = truncateToolResult(json, Math.floor(json.length / 2));
    expect(result).toContain("truncated");
  });

  it("can disable JSON awareness", () => {
    const json = '{"key": "value"}' + "x".repeat(500);
    const result = truncateToolResult(json, 100, { jsonAware: false });
    expect(result).toContain("truncated");
  });
});

describe("truncateToolResults", () => {
  it("returns originals when all fit", () => {
    const results = [
      { id: "1", content: "short" },
      { id: "2", content: "also short" },
    ];
    const output = truncateToolResults(results, 1000);
    expect(output).toHaveLength(2);
    expect(output[0].wasTruncated).toBe(false);
    expect(output[1].wasTruncated).toBe(false);
  });

  it("truncates proportionally", () => {
    const results = [
      { id: "1", content: "a".repeat(800) },
      { id: "2", content: "b".repeat(200) },
    ];
    const output = truncateToolResults(results, 200);
    expect(output[0].wasTruncated).toBe(true);
    expect(output[1].wasTruncated).toBe(true);
    // Larger original gets larger budget
    expect(output[0].content.length).toBeGreaterThan(output[1].content.length);
  });

  it("handles empty results array", () => {
    const output = truncateToolResults([], 1000);
    expect(output).toEqual([]);
  });

  it("handles single result", () => {
    const results = [{ id: "1", content: "a".repeat(500) }];
    const output = truncateToolResults(results, 100);
    expect(output).toHaveLength(1);
    expect(output[0].wasTruncated).toBe(true);
  });

  it("preserves IDs", () => {
    const results = [{ id: "tool-abc", content: "a".repeat(500) }];
    const output = truncateToolResults(results, 100);
    expect(output[0].id).toBe("tool-abc");
  });
});
