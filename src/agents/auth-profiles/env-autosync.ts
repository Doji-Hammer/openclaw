import { normalizeProviderId } from "../model-selection.js";
import { KNOWN_ENV_PROVIDERS, resolveEnvVarCredentialForProvider } from "../provider-env.js";
import { log } from "./constants.js";
import { listProfilesForProvider } from "./profiles.js";
import { updateAuthProfileStoreWithLock } from "./store.js";
import type { AuthProfileCredential, AuthProfileStore } from "./types.js";

export type EnvAutosyncResult = {
  mutated: boolean;
  added: Array<{ provider: string; profileId: string; envVar: string; mode: "api-key" | "token" }>;
};

function toCredential(params: {
  provider: string;
  mode: "api-key" | "token";
  value: string;
}): AuthProfileCredential {
  if (params.mode === "token") {
    return {
      type: "token",
      provider: params.provider,
      token: params.value,
    };
  }
  return {
    type: "api_key",
    provider: params.provider,
    key: params.value,
  };
}

/**
 * Scan environment variables for known provider credential keys and add missing
 * providers to auth-profiles.json.
 *
 * Safety invariants:
 * - fail-closed: if anything looks off, do nothing (no partial overwrites)
 * - never overwrite existing profile entries
 * - only adds a provider if there are currently ZERO profiles for that provider
 */
export async function autosyncEnvCredentialsToAuthProfiles(params?: {
  agentDir?: string;
}): Promise<EnvAutosyncResult> {
  const added: EnvAutosyncResult["added"] = [];

  const updated = await updateAuthProfileStoreWithLock({
    agentDir: params?.agentDir,
    updater: (store) => {
      let mutated = false;

      for (const providerRaw of KNOWN_ENV_PROVIDERS) {
        const provider = normalizeProviderId(providerRaw);

        // Only add env-backed profiles when the provider is missing entirely.
        const existing = listProfilesForProvider(store, provider);
        if (existing.length > 0) {
          continue;
        }

        const resolved = resolveEnvVarCredentialForProvider(provider);
        if (!resolved) {
          continue;
        }

        const profileId = `${provider}:env`;
        if (store.profiles[profileId]) {
          // Do not overwrite.
          continue;
        }

        const cred = toCredential({ provider, mode: resolved.mode, value: resolved.value });
        if (!cred) {
          continue;
        }

        store.profiles[profileId] = cred;
        mutated = true;
        added.push({
          provider,
          profileId,
          envVar: resolved.envVar,
          mode: resolved.mode,
        });
      }

      return mutated;
    },
  });

  const mutated = Boolean(updated) && added.length > 0;
  if (mutated) {
    // Keep logs coarse: don't leak key material.
    for (const entry of added) {
      log.info("autosynced env credentials into auth-profiles", {
        provider: entry.provider,
        profileId: entry.profileId,
        envVar: entry.envVar,
        mode: entry.mode,
      });
    }
  }

  return { mutated, added };
}

export function __applyEnvAutosyncForTest(store: AuthProfileStore): EnvAutosyncResult {
  // Pure helper for unit tests (no file IO / locking).
  const added: EnvAutosyncResult["added"] = [];
  let mutated = false;

  for (const providerRaw of KNOWN_ENV_PROVIDERS) {
    const provider = normalizeProviderId(providerRaw);
    const existing = listProfilesForProvider(store, provider);
    if (existing.length > 0) {
      continue;
    }
    const resolved = resolveEnvVarCredentialForProvider(provider);
    if (!resolved) {
      continue;
    }
    const profileId = `${provider}:env`;
    if (store.profiles[profileId]) {
      continue;
    }
    store.profiles[profileId] = toCredential({
      provider,
      mode: resolved.mode,
      value: resolved.value,
    });
    mutated = true;
    added.push({ provider, profileId, envVar: resolved.envVar, mode: resolved.mode });
  }

  return { mutated, added };
}
