import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createWorkflowsTool } from "./lobster-tool.js";

export default {
  id: "lobster",
  name: "Lobster Workflows",
  version: "0.1.0",

  activate(api: OpenClawPluginApi) {
    const workspaceDir = api.runtime?.workspaceDir ?? "/Users/2mas/.openclaw/workspace";
    const lobsterDir = process.env.LOBSTER_DIR ?? "/Users/2mas/Projects/lobster";
    const workflowsDir = process.env.LOBSTER_WORKFLOWS_DIR ?? `${workspaceDir}/workflows`;
    const stateDir = process.env.LOBSTER_STATE_DIR ?? `${workspaceDir}/.lobster-state`;

    api.registerTool(createWorkflowsTool({ lobsterDir, workflowsDir, stateDir }), {
      name: "workflows",
    });

    api.logger.info(`Lobster plugin activated (lobsterDir=${lobsterDir})`);
  },
};
