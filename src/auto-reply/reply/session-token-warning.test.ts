import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { peekSystemEvents, resetSystemEventsForTest } from "../../infra/system-events.js";
import { maybeWarnSessionTokenPressure } from "./session-token-warning.js";

describe("maybeWarnSessionTokenPressure", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSystemEventsForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetSystemEventsForTest();
  });

  it("warns when totalTokens crosses the configured ratio threshold and persists metadata", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-token-warning-"));
    const storePath = path.join(dir, "sessions.json");
    const sessionKey = "agent:main:main";

    await fs.writeFile(
      storePath,
      JSON.stringify(
        {
          [sessionKey]: {
            sessionId: "sess-1",
            updatedAt: 1,
            totalTokens: 160_000,
            contextTokens: 200_000,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    vi.setSystemTime(new Date("2026-02-27T06:00:00.000Z"));

    const cfg: any = {
      agents: {
        defaults: {
          safeguards: {
            sessionTokenWarning: {
              enabled: true,
              thresholdTokens: 999_999,
              thresholdContextRatio: 0.75,
              minIntervalMs: 60_000,
            },
          },
        },
      },
    };

    const res = await maybeWarnSessionTokenPressure({
      cfg,
      storePath,
      sessionKey,
      logLabel: "test",
      emitSystemEvent: true,
    });

    expect(res.warned).toBe(true);
    expect(res.message).toContain("session token pressure");
    expect(peekSystemEvents(sessionKey).length).toBe(1);

    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed[sessionKey].sessionTokenWarningLastAt).toBe(Date.now());
    expect(parsed[sessionKey].sessionTokenWarningLastAtTokens).toBe(160_000);
  });

  it("rate-limits warnings per session using minIntervalMs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-token-warning-"));
    const storePath = path.join(dir, "sessions.json");
    const sessionKey = "agent:main:main";

    await fs.writeFile(
      storePath,
      JSON.stringify(
        {
          [sessionKey]: {
            sessionId: "sess-1",
            updatedAt: 1,
            totalTokens: 180_000,
            contextTokens: 200_000,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const cfg: any = {
      agents: {
        defaults: {
          safeguards: {
            sessionTokenWarning: {
              enabled: true,
              thresholdTokens: 1,
              thresholdContextRatio: 0,
              minIntervalMs: 10 * 60 * 1000,
            },
          },
        },
      },
    };

    vi.setSystemTime(new Date("2026-02-27T06:00:00.000Z"));
    const first = await maybeWarnSessionTokenPressure({ cfg, storePath, sessionKey });
    expect(first.warned).toBe(true);

    vi.setSystemTime(new Date("2026-02-27T06:05:00.000Z"));
    const second = await maybeWarnSessionTokenPressure({ cfg, storePath, sessionKey });
    expect(second.warned).toBe(false);

    vi.setSystemTime(new Date("2026-02-27T06:20:00.000Z"));
    // Bump token count so the "same token count" suppression doesn't block it.
    const store = JSON.parse(await fs.readFile(storePath, "utf-8"));
    store[sessionKey].totalTokens = 190_000;
    await fs.writeFile(storePath, JSON.stringify(store, null, 2), "utf-8");

    const third = await maybeWarnSessionTokenPressure({ cfg, storePath, sessionKey });
    expect(third.warned).toBe(true);
  });
});
