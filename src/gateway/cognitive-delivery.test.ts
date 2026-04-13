import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findSessionKeyForUserId } from "./cognitive-delivery.js";

describe("findSessionKeyForUserId", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cognitive-delivery-test-"));
    originalHome = process.env.KAIJIBOT_HOME;
    process.env.KAIJIBOT_HOME = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalHome !== undefined) {
      process.env.KAIJIBOT_HOME = originalHome;
    } else {
      delete process.env.KAIJIBOT_HOME;
    }
  });

  function writeSessionStore(entries: Record<string, unknown>): string {
    const sessionsDir = join(tempDir, "sessions", "main");
    mkdirSync(sessionsDir, { recursive: true });
    const storePath = join(sessionsDir, "sessions.json");
    writeFileSync(storePath, JSON.stringify(entries), "utf-8");
    return storePath;
  }

  function makeCfg(storePath: string) {
    return { session: { store: storePath } } as never;
  }

  it("returns direct key when agent:main:{userId} entry exists", () => {
    const storePath = writeSessionStore({
      "agent:main:kaijibot-tui": { lastChannel: "tui" },
    });
    const result = findSessionKeyForUserId(makeCfg(storePath), "kaijibot-tui");
    expect(result).toBe("agent:main:kaijibot-tui");
  });

  it("returns channel-routed key for Feishu session", () => {
    const storePath = writeSessionStore({
      "agent:main:feishu:direct:ou_abc123": { lastChannel: "feishu", lastTo: "ou_abc123" },
    });
    const result = findSessionKeyForUserId(makeCfg(storePath), "ou_abc123");
    expect(result).toBe("agent:main:feishu:direct:ou_abc123");
  });

  it("prefers direct match over channel-routed match", () => {
    const storePath = writeSessionStore({
      "agent:main:simple-user": { lastChannel: "cli" },
      "agent:main:feishu:direct:simple-user": { lastChannel: "feishu" },
    });
    const result = findSessionKeyForUserId(makeCfg(storePath), "simple-user");
    expect(result).toBe("agent:main:simple-user");
  });

  it("returns undefined when no matching session exists", () => {
    const storePath = writeSessionStore({
      "agent:main:feishu:direct:ou_other": { lastChannel: "feishu" },
    });
    const result = findSessionKeyForUserId(makeCfg(storePath), "ou_nonexistent");
    expect(result).toBeUndefined();
  });

  it("returns undefined when session store file does not exist", () => {
    const cfg = makeCfg(join(tempDir, "sessions", "{agentId}", "sessions.json"));
    const result = findSessionKeyForUserId(cfg, "any-user");
    expect(result).toBeUndefined();
  });

  it("skips subagent session keys", () => {
    const storePath = writeSessionStore({
      "agent:main:sub:ou_abc123": { lastChannel: "feishu" },
    });
    const result = findSessionKeyForUserId(makeCfg(storePath), "ou_abc123");
    expect(result).toBeUndefined();
  });

  it("skips cron session keys", () => {
    const storePath = writeSessionStore({
      "agent:main:cron:ou_abc123": { lastChannel: "feishu" },
    });
    const result = findSessionKeyForUserId(makeCfg(storePath), "ou_abc123");
    expect(result).toBeUndefined();
  });

  it("returns undefined when cfg is undefined", () => {
    const result = findSessionKeyForUserId(undefined, "any-user");
    expect(result).toBeUndefined();
  });
});
