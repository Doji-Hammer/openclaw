import { updateSessionStoreEntry } from "../../config/sessions.js";
import type { OpenClawConfig } from "../../config/types.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { logWarn } from "../../logger.js";

export type SessionTokenWarningConfig = {
  enabled?: boolean;
  /** Warn when totalTokens exceeds this absolute count (default: 120_000). */
  thresholdTokens?: number;
  /** Warn when totalTokens/contextTokens exceeds this ratio (default: 0.8). */
  thresholdContextRatio?: number;
  /** Minimum time between warnings for the same session (default: 10 minutes). */
  minIntervalMs?: number;
};

function resolveSessionTokenWarningConfig(
  cfg: OpenClawConfig,
): Required<SessionTokenWarningConfig> {
  const raw =
    (cfg.agents?.defaults as { safeguards?: { sessionTokenWarning?: SessionTokenWarningConfig } })
      ?.safeguards?.sessionTokenWarning ?? {};
  return {
    enabled: raw.enabled ?? true,
    thresholdTokens: raw.thresholdTokens ?? 120_000,
    thresholdContextRatio: raw.thresholdContextRatio ?? 0.8,
    minIntervalMs: raw.minIntervalMs ?? 10 * 60 * 1000,
  };
}

export async function maybeWarnSessionTokenPressure(params: {
  cfg: OpenClawConfig;
  storePath?: string;
  sessionKey?: string;
  /** Optional label for log/event prefixing. */
  logLabel?: string;
  /** When true (default), enqueue a system event for dashboard/prompt prefixing. */
  emitSystemEvent?: boolean;
}): Promise<{ warned: boolean; message?: string }> {
  const { cfg, storePath, sessionKey } = params;
  const emitSystemEvent = params.emitSystemEvent ?? true;
  if (!storePath || !sessionKey) {
    return { warned: false };
  }

  const warningCfg = resolveSessionTokenWarningConfig(cfg);
  if (!warningCfg.enabled) {
    return { warned: false };
  }

  const now = Date.now();
  let message: string | undefined;
  let warned = false;

  await updateSessionStoreEntry({
    storePath,
    sessionKey,
    update: async (entry) => {
      const totalTokens = entry.totalTokens ?? 0;
      const contextTokens = entry.contextTokens ?? 0;
      if (!(totalTokens > 0) || !(contextTokens > 0)) {
        return null;
      }

      const ratio = contextTokens > 0 ? totalTokens / contextTokens : 0;
      const hitAbsolute = totalTokens >= warningCfg.thresholdTokens;
      const hitRatio = ratio >= warningCfg.thresholdContextRatio;
      if (!hitAbsolute && !hitRatio) {
        return null;
      }

      const lastAt = entry.sessionTokenWarningLastAt ?? 0;
      const lastAtTokens = entry.sessionTokenWarningLastAtTokens ?? 0;
      if (lastAt > 0 && now - lastAt < warningCfg.minIntervalMs) {
        return null;
      }
      // Avoid repeating a warning at the same token count after a restart.
      if (totalTokens <= lastAtTokens) {
        return null;
      }

      const ratioPct = Math.round(ratio * 100);
      const label = params.logLabel ? `${params.logLabel}: ` : "";
      message = `${label}session token pressure: ${totalTokens.toLocaleString()} / ${contextTokens.toLocaleString()} tokens (${ratioPct}%). Consider /new or compaction soon.`;
      warned = true;

      return {
        sessionTokenWarningLastAt: now,
        sessionTokenWarningLastAtTokens: totalTokens,
        updatedAt: now,
      };
    },
  });

  if (!warned || !message) {
    return { warned: false };
  }

  logWarn(message);
  if (emitSystemEvent) {
    enqueueSystemEvent(message, { sessionKey });
  }
  return { warned: true, message };
}
