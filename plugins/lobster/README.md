# Lobster Plugin for OpenClaw

Wraps the Lobster workflow engine as an OpenClaw agent tool.

## Setup

Add to your OpenClaw config (`openclaw.yaml` or equivalent):

```yaml
plugins:
  entries:
    lobster:
      enabled: true
      path: ./plugins/lobster
      config:
        lobsterDir: /Users/2mas/Projects/lobster
        workflowsDir: /Users/2mas/.openclaw/workspace/workflows
        stateDir: /Users/2mas/.openclaw/workspace/.lobster-state
```

Or add the plugin path to `plugins.load.paths`:

```yaml
plugins:
  load:
    paths:
      - ./plugins/lobster
```

## Tool: `workflows`

### Actions

| Action   | Description                   | Required params |
| -------- | ----------------------------- | --------------- |
| `list`   | List available workflow files | —               |
| `run`    | Execute a workflow            | `name`          |
| `resume` | Resume a halted workflow      | `resumeToken`   |

### Approval Gates

When a workflow hits an approval gate, the tool returns `status: "needs_approval"` with a `resumeToken` and `prompt`. The agent presents the prompt to the user, then calls `resume` with the token and `approved: true/false`.

## Tests

```bash
cd plugins/lobster && npx vitest run
```
