import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
};

type LobsterToolOptions = {
  lobsterDir: string;
  workflowsDir: string;
  stateDir: string;
};

function jsonResult(payload: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function errorResult(message: string): ToolResult {
  return jsonResult({ ok: false, error: message });
}

function execLobster(
  lobsterDir: string,
  args: string[],
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const bin = join(lobsterDir, "bin", "lobster.js");
    const child = execFile(
      "node",
      [bin, ...args],
      {
        cwd: lobsterDir,
        env: { ...process.env, ...env },
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error ? ((error as any).code ?? 1) : 0,
        });
      },
    );
  });
}

function parseToolEnvelope(stdout: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stdout.trim());
    if (parsed && typeof parsed === "object" && "protocolVersion" in parsed) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function createWorkflowsTool(opts: LobsterToolOptions) {
  return {
    label: "Workflows",
    name: "workflows",
    description: `Run Lobster workflow pipelines and manage workflow execution.

ACTIONS:
- list: List available workflow files in the workflows directory
- run: Execute a workflow by name or pipeline string
- resume: Resume a halted workflow after approval

PARAMETERS:
- action: "list" | "run" | "resume" (required)
- name: Workflow name or pipeline string (for run)
- argsJson: JSON string of arguments (for run, optional)
- resumeToken: Base64 resume token (for resume)
- approved: Whether to approve and continue (for resume, default true)

EXAMPLES:
  { "action": "list" }
  { "action": "run", "name": "my-workflow.lobster" }
  { "action": "run", "name": "my-workflow.lobster", "argsJson": "{\\"repo\\": \\"foo/bar\\"}" }
  { "action": "run", "name": "exec --json 'echo [1,2,3]' | json" }
  { "action": "resume", "resumeToken": "<token>", "approved": true }

When a workflow needs approval, the result will contain status "needs_approval" with a resumeToken and prompt. Present the prompt to the user, then call resume with the token and their decision.`,

    parameters: {
      type: "object" as const,
      properties: {
        action: {
          type: "string" as const,
          enum: ["list", "run", "resume"],
          description: "Action to perform",
        },
        name: {
          type: "string" as const,
          description: "Workflow name/file or pipeline string (for run)",
        },
        argsJson: {
          type: "string" as const,
          description: "JSON arguments for the workflow (for run)",
        },
        resumeToken: {
          type: "string" as const,
          description: "Resume token from a halted workflow (for resume)",
        },
        approved: {
          type: "boolean" as const,
          description: "Whether to approve the halted workflow (for resume)",
        },
      },
      required: ["action"],
    },

    execute: async (_toolCallId: string, args: Record<string, unknown>): Promise<ToolResult> => {
      const action = typeof args.action === "string" ? args.action : "";

      switch (action) {
        case "list":
          return await handleList(opts);
        case "run":
          return await handleRun(opts, args);
        case "resume":
          return await handleResume(opts, args);
        default:
          return errorResult(`Unknown action: ${action}. Use list, run, or resume.`);
      }
    },
  };
}

async function handleList(opts: LobsterToolOptions): Promise<ToolResult> {
  try {
    const entries = await readdir(opts.workflowsDir, { withFileTypes: true }).catch(() => []);
    const workflows = entries
      .filter((e) => e.isFile() && /\.(lobster|ya?ml|json)$/i.test(e.name))
      .map((e) => e.name);

    return jsonResult({
      ok: true,
      workflowsDir: opts.workflowsDir,
      workflows,
      count: workflows.length,
    });
  } catch (err: any) {
    return errorResult(`Failed to list workflows: ${err?.message ?? String(err)}`);
  }
}

async function handleRun(
  opts: LobsterToolOptions,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) {
    return errorResult("name is required for run action");
  }

  const cliArgs = ["run", "--mode", "tool"];

  // Check if it looks like a workflow file reference (has extension or no pipes)
  const isFilePath = /\.(lobster|ya?ml|json)$/i.test(name) || !name.includes("|");
  if (isFilePath && !name.startsWith("/")) {
    // Try to resolve relative to workflows dir
    const filePath = join(opts.workflowsDir, name);
    cliArgs.push("--file", filePath);
  } else if (isFilePath && name.startsWith("/")) {
    cliArgs.push("--file", name);
  } else {
    // It's a pipeline string
    cliArgs.push(name);
  }

  if (typeof args.argsJson === "string" && args.argsJson.trim()) {
    cliArgs.push("--args-json", args.argsJson);
  }

  const env: Record<string, string> = {
    LOBSTER_STATE_DIR: opts.stateDir,
  };

  const result = await execLobster(opts.lobsterDir, cliArgs, env);
  const envelope = parseToolEnvelope(result.stdout);

  if (!envelope) {
    // Non-JSON output — return raw
    return jsonResult({
      ok: false,
      error: "Unexpected output from Lobster CLI",
      stdout: result.stdout.slice(0, 4000),
      stderr: result.stderr.slice(0, 2000),
      exitCode: result.exitCode,
    });
  }

  return jsonResult(envelope);
}

async function handleResume(
  opts: LobsterToolOptions,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const token = typeof args.resumeToken === "string" ? args.resumeToken.trim() : "";
  if (!token) {
    return errorResult("resumeToken is required for resume action");
  }

  const approved = args.approved !== false; // default true

  const cliArgs = ["resume", "--token", token, "--approve", approved ? "yes" : "no"];

  const env: Record<string, string> = {
    LOBSTER_STATE_DIR: opts.stateDir,
  };

  const result = await execLobster(opts.lobsterDir, cliArgs, env);
  const envelope = parseToolEnvelope(result.stdout);

  if (!envelope) {
    return jsonResult({
      ok: false,
      error: "Unexpected output from Lobster CLI",
      stdout: result.stdout.slice(0, 4000),
      stderr: result.stderr.slice(0, 2000),
      exitCode: result.exitCode,
    });
  }

  return jsonResult(envelope);
}
