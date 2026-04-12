import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";
import { resolveStorePath, resolveSessionTranscriptsDirForAgent } from "../config/sessions.js";
import { noteStateIntegrity } from "./doctor-state-integrity.js";

const noteMock = vi.fn();

type EnvSnapshot = {
  HOME?: string;
  KAIJIBOT_HOME?: string;
  KAIJIBOT_STATE_DIR?: string;
  KAIJIBOT_OAUTH_DIR?: string;
};

function captureEnv(): EnvSnapshot {
  return {
    HOME: process.env.HOME,
    KAIJIBOT_HOME: process.env.KAIJIBOT_HOME,
    KAIJIBOT_STATE_DIR: process.env.KAIJIBOT_STATE_DIR,
    KAIJIBOT_OAUTH_DIR: process.env.KAIJIBOT_OAUTH_DIR,
  };
}

function restoreEnv(snapshot: EnvSnapshot) {
  for (const key of Object.keys(snapshot) as Array<keyof EnvSnapshot>) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function setupSessionState(cfg: KaijiBotConfig, env: NodeJS.ProcessEnv, homeDir: string) {
  const agentId = "main";
  const sessionsDir = resolveSessionTranscriptsDirForAgent(agentId, env, () => homeDir);
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
}

function stateIntegrityText(): string {
  return noteMock.mock.calls
    .filter((call) => call[1] === "State integrity")
    .map((call) => String(call[0]))
    .join("\n");
}

const OAUTH_PROMPT_MATCHER = expect.objectContaining({
  message: expect.stringContaining("Create OAuth dir at"),
});

async function runStateIntegrity(cfg: KaijiBotConfig) {
  setupSessionState(cfg, process.env, process.env.HOME ?? "");
  const confirmRuntimeRepair = vi.fn(async () => false);
  await noteStateIntegrity(cfg, { confirmRuntimeRepair, note: noteMock });
  return confirmRuntimeRepair;
}

function writeSessionStore(
  cfg: KaijiBotConfig,
  sessions: Record<string, { sessionId: string; updatedAt: number }>,
) {
  setupSessionState(cfg, process.env, process.env.HOME ?? "");
  const storePath = resolveStorePath(cfg.session?.store, { agentId: "main" });
  fs.writeFileSync(storePath, JSON.stringify(sessions, null, 2));
}

async function runStateIntegrityText(cfg: KaijiBotConfig): Promise<string> {
  await noteStateIntegrity(cfg, { confirmRuntimeRepair: vi.fn(async () => false), note: noteMock });
  return stateIntegrityText();
}

describe("doctor state integrity oauth dir checks", () => {
  let envSnapshot: EnvSnapshot;
  let tempHome = "";

  beforeEach(() => {
    envSnapshot = captureEnv();
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "kaijibot-doctor-state-integrity-"));
    process.env.HOME = tempHome;
    process.env.KAIJIBOT_HOME = tempHome;
    process.env.KAIJIBOT_STATE_DIR = path.join(tempHome, ".kaijibot");
    delete process.env.KAIJIBOT_OAUTH_DIR;
    fs.mkdirSync(process.env.KAIJIBOT_STATE_DIR, { recursive: true, mode: 0o700 });
    noteMock.mockClear();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it("does not prompt for oauth dir when no whatsapp/pairing config is active", async () => {
    const cfg: KaijiBotConfig = {};
    const confirmRuntimeRepair = await runStateIntegrity(cfg);
    expect(confirmRuntimeRepair).not.toHaveBeenCalledWith(OAUTH_PROMPT_MATCHER);
    const text = stateIntegrityText();
    expect(text).toContain("OAuth dir not present");
    expect(text).not.toContain("CRITICAL: OAuth dir missing");
  });

  it("does not prompt for oauth dir when whatsapp is configured without persisted auth state", async () => {
    const cfg: KaijiBotConfig = {
      channels: {
        whatsapp: {},
      },
    };
    const confirmRuntimeRepair = await runStateIntegrity(cfg);
    expect(confirmRuntimeRepair).not.toHaveBeenCalledWith(OAUTH_PROMPT_MATCHER);
    expect(stateIntegrityText()).toContain("OAuth dir not present");
    expect(stateIntegrityText()).not.toContain("CRITICAL: OAuth dir missing");
  });

  it("prompts for oauth dir when a channel dmPolicy is pairing", async () => {
    const cfg: KaijiBotConfig = {
      channels: {
        telegram: {
          dmPolicy: "pairing",
        },
      },
    };
    const confirmRuntimeRepair = await runStateIntegrity(cfg);
    expect(confirmRuntimeRepair).toHaveBeenCalledWith(OAUTH_PROMPT_MATCHER);
  });

  it("prompts for oauth dir when KAIJIBOT_OAUTH_DIR is explicitly configured", async () => {
    process.env.KAIJIBOT_OAUTH_DIR = path.join(tempHome, ".oauth");
    const cfg: KaijiBotConfig = {};
    const confirmRuntimeRepair = await runStateIntegrity(cfg);
    expect(confirmRuntimeRepair).toHaveBeenCalledWith(OAUTH_PROMPT_MATCHER);
    expect(stateIntegrityText()).toContain("CRITICAL: OAuth dir missing");
  });

  it("detects orphan transcripts and offers archival remediation", async () => {
    const cfg: KaijiBotConfig = {};
    setupSessionState(cfg, process.env, process.env.HOME ?? "");
    const sessionsDir = resolveSessionTranscriptsDirForAgent("main", process.env, () => tempHome);
    fs.writeFileSync(path.join(sessionsDir, "orphan-session.jsonl"), '{"type":"session"}\n');
    const confirmRuntimeRepair = vi.fn(async (params: { message: string }) =>
      params.message.includes("This only renames them to *.deleted.<timestamp>."),
    );
    await noteStateIntegrity(cfg, { confirmRuntimeRepair, note: noteMock });
    expect(stateIntegrityText()).toContain(
      "These .jsonl files are no longer referenced by sessions.json",
    );
    expect(stateIntegrityText()).toContain("Examples: orphan-session.jsonl");
    expect(confirmRuntimeRepair).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("This only renames them to *.deleted.<timestamp>."),
      }),
    );
    const files = fs.readdirSync(sessionsDir);
    expect(files.some((name) => name.startsWith("orphan-session.jsonl.deleted."))).toBe(true);
  });

  it("suppresses orphan transcript warnings when QMD sessions are enabled", async () => {
    const cfg: KaijiBotConfig = {
      memory: {
        backend: "qmd",
        qmd: {
          sessions: { enabled: true },
        },
      },
    };
    setupSessionState(cfg, process.env, process.env.HOME ?? "");
    const sessionsDir = resolveSessionTranscriptsDirForAgent("main", process.env, () => tempHome);
    fs.writeFileSync(path.join(sessionsDir, "orphan-session.jsonl"), '{"type":"session"}\n');

    const confirmRuntimeRepair = vi.fn(async () => false);
    await noteStateIntegrity(cfg, { confirmRuntimeRepair, note: noteMock });

    expect(stateIntegrityText()).not.toContain(
      "These .jsonl files are no longer referenced by sessions.json",
    );
    expect(confirmRuntimeRepair).not.toHaveBeenCalled();
  });

  it("still detects orphan transcripts when QMD sessions are disabled", async () => {
    const cfg: KaijiBotConfig = {
      memory: {
        backend: "qmd",
        qmd: {
          sessions: { enabled: false },
        },
      },
    };
    setupSessionState(cfg, process.env, process.env.HOME ?? "");
    const sessionsDir = resolveSessionTranscriptsDirForAgent("main", process.env, () => tempHome);
    fs.writeFileSync(path.join(sessionsDir, "orphan-session.jsonl"), '{"type":"session"}\n');

    const confirmRuntimeRepair = vi.fn(async () => false);
    await noteStateIntegrity(cfg, { confirmRuntimeRepair, note: noteMock });

    expect(stateIntegrityText()).toContain(
      "These .jsonl files are no longer referenced by sessions.json",
    );
    expect(confirmRuntimeRepair).toHaveBeenCalled();
  });

  it("prints kaijibot-only verification hints when recent sessions are missing transcripts", async () => {
    const cfg: KaijiBotConfig = {};
    writeSessionStore(cfg, {
      "agent:main:main": {
        sessionId: "missing-transcript",
        updatedAt: Date.now(),
      },
    });
    const text = await runStateIntegrityText(cfg);
    expect(text).toContain("recent sessions are missing transcripts");
    expect(text).toMatch(/kaijibot sessions --store ".*sessions\.json"/);
    expect(text).toMatch(/kaijibot sessions cleanup --store ".*sessions\.json" --dry-run/);
    expect(text).toMatch(
      /kaijibot sessions cleanup --store ".*sessions\.json" --enforce --fix-missing/,
    );
    expect(text).not.toContain("--active");
    expect(text).not.toContain(" ls ");
  });

  it("ignores slash-routing sessions for recent missing transcript warnings", async () => {
    const cfg: KaijiBotConfig = {};
    writeSessionStore(cfg, {
      "agent:main:telegram:slash:6790081233": {
        sessionId: "missing-slash-transcript",
        updatedAt: Date.now(),
      },
    });
    const text = await runStateIntegrityText(cfg);
    expect(text).not.toContain("recent sessions are missing transcripts");
  });
});
