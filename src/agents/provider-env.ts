import { getEnvApiKey } from "@mariozechner/pi-ai";
import { getShellEnvAppliedKeys } from "../infra/shell-env.js";
import { normalizeProviderId } from "./model-selection.js";

export type EnvCredentialMode = "api-key" | "token";

export type EnvVarCredential = {
  provider: string;
  envVar: string;
  value: string;
  /** Human readable source label (includes shell-env prefix when applicable). */
  source: string;
  mode: EnvCredentialMode;
};

function resolveEnvSourceLabel(params: { applied: Set<string>; envVar: string }): string {
  const prefix = params.applied.has(params.envVar) ? "shell env: " : "env: ";
  return `${prefix}${params.envVar}`;
}

/**
 * Resolve an API key/token for a specific provider from environment variables.
 *
 * This intentionally mirrors the provider/env mapping used for model auth.
 * It returns only env-var backed credentials (not gcloud ADC / aws-sdk chains).
 */
export function resolveEnvVarCredentialForProvider(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
): EnvVarCredential | null {
  const normalized = normalizeProviderId(provider);
  const applied = new Set(getShellEnvAppliedKeys());

  const pick = (envVar: string, mode: EnvCredentialMode): EnvVarCredential | null => {
    const value = env[envVar]?.trim();
    if (!value) {
      return null;
    }
    return {
      provider: normalized,
      envVar,
      value,
      source: resolveEnvSourceLabel({ applied, envVar }),
      mode,
    };
  };

  if (normalized === "github-copilot") {
    return (
      pick("COPILOT_GITHUB_TOKEN", "token") ??
      pick("GH_TOKEN", "token") ??
      pick("GITHUB_TOKEN", "token")
    );
  }

  if (normalized === "anthropic") {
    return pick("ANTHROPIC_OAUTH_TOKEN", "token") ?? pick("ANTHROPIC_API_KEY", "api-key");
  }

  if (normalized === "chutes") {
    return pick("CHUTES_OAUTH_TOKEN", "token") ?? pick("CHUTES_API_KEY", "api-key");
  }

  if (normalized === "zai") {
    return pick("ZAI_API_KEY", "api-key") ?? pick("Z_AI_API_KEY", "api-key");
  }

  // google-vertex uses gcloud ADC (not an env var) -> do not expose as env-var credential.
  if (normalized === "google-vertex") {
    return null;
  }

  if (normalized === "opencode") {
    return pick("OPENCODE_API_KEY", "api-key") ?? pick("OPENCODE_ZEN_API_KEY", "api-key");
  }

  if (normalized === "qwen-portal") {
    return pick("QWEN_OAUTH_TOKEN", "token") ?? pick("QWEN_PORTAL_API_KEY", "api-key");
  }

  if (normalized === "minimax-portal") {
    return pick("MINIMAX_OAUTH_TOKEN", "token") ?? pick("MINIMAX_API_KEY", "api-key");
  }

  if (normalized === "kimi-coding") {
    return pick("KIMI_API_KEY", "api-key") ?? pick("KIMICODE_API_KEY", "api-key");
  }

  const envMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    google: "GEMINI_API_KEY",
    voyage: "VOYAGE_API_KEY",
    groq: "GROQ_API_KEY",
    deepgram: "DEEPGRAM_API_KEY",
    cerebras: "CEREBRAS_API_KEY",
    xai: "XAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
    "cloudflare-ai-gateway": "CLOUDFLARE_AI_GATEWAY_API_KEY",
    moonshot: "MOONSHOT_API_KEY",
    minimax: "MINIMAX_API_KEY",
    xiaomi: "XIAOMI_API_KEY",
    synthetic: "SYNTHETIC_API_KEY",
    venice: "VENICE_API_KEY",
    mistral: "MISTRAL_API_KEY",
    ollama: "OLLAMA_API_KEY",
  };

  const envVar = envMap[normalized];
  if (!envVar) {
    return null;
  }
  return pick(envVar, "api-key");
}

export type EnvApiKeyResult = { apiKey: string; source: string };

/**
 * Backwards-compatible helper for model-auth: resolves env-var credentials and
 * special non-env sources (e.g. gcloud ADC for google-vertex).
 */
export function resolveEnvApiKey(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
): EnvApiKeyResult | null {
  const normalized = normalizeProviderId(provider);

  if (normalized === "google-vertex") {
    const envKey = getEnvApiKey(normalized);
    if (!envKey) {
      return null;
    }
    return { apiKey: envKey, source: "gcloud adc" };
  }

  const resolved = resolveEnvVarCredentialForProvider(normalized, env);
  if (!resolved) {
    return null;
  }
  return { apiKey: resolved.value, source: resolved.source };
}

export const KNOWN_ENV_PROVIDERS: readonly string[] = [
  // Special cases
  "github-copilot",
  "anthropic",
  "chutes",
  "zai",
  "opencode",
  "qwen-portal",
  "minimax-portal",
  "kimi-coding",

  // Map-driven providers
  "openai",
  "google",
  "voyage",
  "groq",
  "deepgram",
  "cerebras",
  "xai",
  "openrouter",
  "vercel-ai-gateway",
  "cloudflare-ai-gateway",
  "moonshot",
  "minimax",
  "xiaomi",
  "synthetic",
  "venice",
  "mistral",
  "ollama",
] as const;
