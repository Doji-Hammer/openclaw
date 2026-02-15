import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWorkflowsTool } from "./lobster-tool.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
}));

const OPTS = {
  lobsterDir: "/fake/lobster",
  workflowsDir: "/fake/workflows",
  stateDir: "/fake/state",
};

describe("workflows tool", () => {
  let tool: ReturnType<typeof createWorkflowsTool>;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = createWorkflowsTool(OPTS);
  });

  it("has correct name and description", () => {
    expect(tool.name).toBe("workflows");
    expect(tool.description).toContain("Lobster");
  });

  describe("list action", () => {
    it("returns workflow files", async () => {
      vi.mocked(readdir).mockResolvedValue([
        { name: "pr-monitor.lobster", isFile: () => true, isDirectory: () => false },
        { name: "deploy.yaml", isFile: () => true, isDirectory: () => false },
        { name: "README.md", isFile: () => true, isDirectory: () => false },
        { name: "subdir", isFile: () => false, isDirectory: () => true },
      ] as any);

      const result = await tool.execute("call-1", { action: "list" });
      const data = JSON.parse(result.content[0].text);

      expect(data.ok).toBe(true);
      expect(data.workflows).toEqual(["pr-monitor.lobster", "deploy.yaml"]);
      expect(data.count).toBe(2);
    });

    it("handles empty directory", async () => {
      vi.mocked(readdir).mockRejectedValue(new Error("ENOENT"));

      const result = await tool.execute("call-2", { action: "list" });
      const data = JSON.parse(result.content[0].text);

      expect(data.ok).toBe(true);
      expect(data.workflows).toEqual([]);
    });
  });

  describe("run action", () => {
    it("runs a workflow file", async () => {
      const envelope = { protocolVersion: 1, ok: true, status: "ok", output: [{ x: 1 }] };
      vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, JSON.stringify(envelope), "");
        return {} as any;
      });

      const result = await tool.execute("call-3", {
        action: "run",
        name: "pr-monitor.lobster",
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.ok).toBe(true);
      expect(data.status).toBe("ok");

      // Verify CLI args
      const callArgs = vi.mocked(execFile).mock.calls[0];
      expect(callArgs[1]).toContain("--mode");
      expect(callArgs[1]).toContain("tool");
      expect(callArgs[1]).toContain("--file");
      expect(callArgs[1]).toContain("/fake/workflows/pr-monitor.lobster");
    });

    it("errors without name", async () => {
      const result = await tool.execute("call-4", { action: "run" });
      const data = JSON.parse(result.content[0].text);
      expect(data.ok).toBe(false);
      expect(data.error).toContain("name is required");
    });

    it("passes argsJson", async () => {
      const envelope = { protocolVersion: 1, ok: true, status: "ok", output: [] };
      vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, JSON.stringify(envelope), "");
        return {} as any;
      });

      await tool.execute("call-5", {
        action: "run",
        name: "deploy.lobster",
        argsJson: '{"env":"prod"}',
      });

      const callArgs = vi.mocked(execFile).mock.calls[0];
      expect(callArgs[1]).toContain("--args-json");
      expect(callArgs[1]).toContain('{"env":"prod"}');
    });

    it("handles approval gate", async () => {
      const envelope = {
        protocolVersion: 1,
        ok: true,
        status: "needs_approval",
        output: [],
        requiresApproval: {
          prompt: "Deploy to production?",
          resumeToken: "abc123",
        },
      };
      vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, JSON.stringify(envelope), "");
        return {} as any;
      });

      const result = await tool.execute("call-6", {
        action: "run",
        name: "deploy.lobster",
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.status).toBe("needs_approval");
      expect(data.requiresApproval.prompt).toBe("Deploy to production?");
      expect(data.requiresApproval.resumeToken).toBe("abc123");
    });
  });

  describe("resume action", () => {
    it("resumes with approval", async () => {
      const envelope = { protocolVersion: 1, ok: true, status: "ok", output: [{ done: true }] };
      vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, JSON.stringify(envelope), "");
        return {} as any;
      });

      const result = await tool.execute("call-7", {
        action: "resume",
        resumeToken: "abc123",
        approved: true,
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.ok).toBe(true);

      const callArgs = vi.mocked(execFile).mock.calls[0];
      expect(callArgs[1]).toContain("resume");
      expect(callArgs[1]).toContain("--token");
      expect(callArgs[1]).toContain("abc123");
      expect(callArgs[1]).toContain("--approve");
      expect(callArgs[1]).toContain("yes");
    });

    it("resumes with rejection", async () => {
      const envelope = { protocolVersion: 1, ok: true, status: "cancelled", output: [] };
      vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, JSON.stringify(envelope), "");
        return {} as any;
      });

      await tool.execute("call-8", {
        action: "resume",
        resumeToken: "abc123",
        approved: false,
      });

      const callArgs = vi.mocked(execFile).mock.calls[0];
      expect(callArgs[1]).toContain("no");
    });

    it("errors without token", async () => {
      const result = await tool.execute("call-9", { action: "resume" });
      const data = JSON.parse(result.content[0].text);
      expect(data.ok).toBe(false);
      expect(data.error).toContain("resumeToken is required");
    });
  });

  it("errors on unknown action", async () => {
    const result = await tool.execute("call-10", { action: "bogus" });
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("Unknown action");
  });
});
