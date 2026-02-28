import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUTH_STORE_VERSION } from "./constants.js";
import { autosyncEnvCredentialsToAuthProfiles } from "./env-autosync.js";
import { ensureAuthProfileStore } from "./store.js";

async function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    const next = vars[key];
    if (next === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = next;
    }
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(vars)) {
      const value = prev[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("auth-profiles env autosync", () => {
  it("adds an :env profile for a missing provider when env var exists", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-env-autosync-"));
    try {
      await withEnv({ OPENAI_API_KEY: "sk-test-openai" }, async () => {
        const result = await autosyncEnvCredentialsToAuthProfiles({ agentDir });
        expect(result.mutated).toBe(true);
        expect(result.added.find((e) => e.provider === "openai")?.profileId).toBe("openai:env");

        const store = ensureAuthProfileStore(agentDir);
        expect(store.profiles["openai:env"]).toEqual({
          type: "api_key",
          provider: "openai",
          key: "sk-test-openai",
        });
      });
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("does not overwrite or add when provider already has profiles", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-env-autosync-"));
    try {
      fs.writeFileSync(
        path.join(agentDir, "auth-profiles.json"),
        `${JSON.stringify(
          {
            version: AUTH_STORE_VERSION,
            profiles: {
              "openai:default": {
                type: "api_key",
                provider: "openai",
                key: "existing",
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      await withEnv({ OPENAI_API_KEY: "sk-should-not-be-imported" }, async () => {
        await autosyncEnvCredentialsToAuthProfiles({ agentDir });

        const store = ensureAuthProfileStore(agentDir);
        expect(store.profiles["openai:default"]).toMatchObject({ key: "existing" });
        expect(store.profiles["openai:env"]).toBeUndefined();
      });
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("imports oauth-token env vars as token profiles", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-env-autosync-"));
    try {
      await withEnv({ ANTHROPIC_OAUTH_TOKEN: "oauth-token" }, async () => {
        const result = await autosyncEnvCredentialsToAuthProfiles({ agentDir });
        expect(result.mutated).toBe(true);

        const store = ensureAuthProfileStore(agentDir);
        expect(store.profiles["anthropic:env"]).toEqual({
          type: "token",
          provider: "anthropic",
          token: "oauth-token",
        });
      });
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });
});
