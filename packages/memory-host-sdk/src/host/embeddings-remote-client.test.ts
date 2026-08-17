import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../../../../src/config/config.js";

const { hasRemoteEmbeddingCredentialSignal, resolveRemoteEmbeddingBearerClient } =
  await import("./embeddings-remote-client.js");
const { resolveGeminiEmbeddingClient } = await import("./embeddings-gemini.js");

const EMBEDDING_ENV_KEYS = [
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "VOYAGE_API_KEY",
  "MISTRAL_API_KEY",
];

function stubEnvEmpty(keys: string[]): void {
  for (const key of keys) {
    vi.stubEnv(key, "");
  }
}

function minimalConfig(): KaijiBotConfig {
  return {
    memory: { backend: "builtin" },
    agents: { defaults: {}, list: [{ id: "main", default: true }] },
  } as unknown as KaijiBotConfig;
}

function bearerOptions(
  agentDir: string,
  extra: { remote?: { apiKey?: string } } = {},
): Parameters<typeof resolveRemoteEmbeddingBearerClient>[0]["options"] {
  return {
    config: minimalConfig(),
    provider: "auto",
    model: "",
    fallback: "none",
    agentDir,
    ...extra,
  };
}

describe("remote embedding credential signal pre-check", () => {
  let fixtureRoot = "";
  let agentDir = "";
  let mainAgentDir = "";

  beforeEach(async () => {
    fixtureRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "embed-precheck-"));
    agentDir = path.join(fixtureRoot, "agent");
    mainAgentDir = path.join(fixtureRoot, "main-agent");
    await fsp.mkdir(agentDir, { recursive: true });
    await fsp.mkdir(mainAgentDir, { recursive: true });
    vi.stubEnv("KAIJIBOT_AGENT_DIR", mainAgentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", mainAgentDir);
    stubEnvEmpty(EMBEDDING_ENV_KEYS);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fsp.rm(fixtureRoot, { recursive: true, force: true });
  });

  async function writeStore(dir: string, profiles: Record<string, unknown>): Promise<void> {
    await fsp.writeFile(
      path.join(dir, "auth-profiles.json"),
      JSON.stringify({ version: 1, profiles }),
    );
  }

  it("reports no signal for a bare environment", () => {
    expect(
      hasRemoteEmbeddingCredentialSignal({
        provider: "openai",
        config: minimalConfig(),
        agentDir,
      }),
    ).toBe(false);
  });

  it("reports a signal when an env candidate is set", () => {
    vi.stubEnv("OPENAI_API_KEY", "env-key");
    expect(
      hasRemoteEmbeddingCredentialSignal({
        provider: "openai",
        config: minimalConfig(),
        agentDir,
      }),
    ).toBe(true);
  });

  it("reports a signal when the agent auth store has a profile for the provider", async () => {
    await writeStore(agentDir, {
      "openai:main": { type: "api_key", provider: "openai", key: "k" },
    });
    expect(
      hasRemoteEmbeddingCredentialSignal({
        provider: "openai",
        config: minimalConfig(),
        agentDir,
      }),
    ).toBe(true);
  });

  it("reports no signal when the agent auth store exists without a matching profile", async () => {
    await writeStore(agentDir, {
      "zai:main": { type: "api_key", provider: "zai", key: "k" },
    });
    expect(
      hasRemoteEmbeddingCredentialSignal({
        provider: "openai",
        config: minimalConfig(),
        agentDir,
      }),
    ).toBe(false);
  });

  it("reports a signal when the main agent auth store has a matching profile", async () => {
    await writeStore(mainAgentDir, {
      "voyage:main": { type: "api_key", provider: "voyage", key: "k" },
    });
    expect(
      hasRemoteEmbeddingCredentialSignal({
        provider: "voyage",
        config: minimalConfig(),
        agentDir,
      }),
    ).toBe(true);
  });

  it("reports a signal when only a legacy auth.json exists", async () => {
    await fsp.writeFile(path.join(agentDir, "auth.json"), "{}");
    expect(
      hasRemoteEmbeddingCredentialSignal({
        provider: "mistral",
        config: minimalConfig(),
        agentDir,
      }),
    ).toBe(true);
  });

  it("reports a signal when a models.providers entry exists", () => {
    const cfg = minimalConfig() as unknown as { models: { providers: Record<string, unknown> } };
    cfg.models = { providers: { openai: { baseUrl: "https://proxy.example/v1" } } };
    expect(
      hasRemoteEmbeddingCredentialSignal({
        provider: "openai",
        config: cfg as unknown as KaijiBotConfig,
        agentDir,
      }),
    ).toBe(true);
  });

  it("bearer client fails fast with the canonical missing-key error when no signal exists", async () => {
    await expect(
      resolveRemoteEmbeddingBearerClient({
        provider: "openai",
        options: bearerOptions(agentDir),
        defaultBaseUrl: "https://api.openai.com/v1",
      }),
    ).rejects.toThrow('No API key found for provider "openai"');
  });

  it("bearer client uses remote.apiKey without consulting any resolver", async () => {
    const client = await resolveRemoteEmbeddingBearerClient({
      provider: "openai",
      options: bearerOptions(agentDir, { remote: { apiKey: "remote-key" } }),
      defaultBaseUrl: "https://api.openai.com/v1",
    });
    expect(client.headers.Authorization).toBe("Bearer remote-key");
  });

  it("gemini client fails fast with the canonical missing-key error", async () => {
    await expect(
      resolveGeminiEmbeddingClient({
        config: minimalConfig(),
        provider: "auto",
        model: "",
        fallback: "none",
        agentDir,
      }),
    ).rejects.toThrow('No API key found for provider "google"');
  });
});

describe("embedding pre-check plugin hook audit guard", () => {
  const HOOK_NAMES = [
    "resolveExternalAuthProfiles",
    "resolveSyntheticAuth",
    "resolveConfigApiKey",
  ] as const;
  const ALLOWED: Array<{ plugin: string; hook: string }> = [
    { plugin: "anthropic-vertex", hook: "resolveConfigApiKey" },
  ];

  it("no bundled plugin registers auth hooks for embedding providers outside the allowlist", async () => {
    const extensionsDir = path.resolve(__dirname, "../../../../extensions");
    const entries = await fsp.readdir(extensionsDir, { withFileTypes: true });
    const violations: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "AGENTS.md") {
        continue;
      }
      const setupFiles = (await fsp.readdir(path.join(extensionsDir, entry.name))).filter((name) =>
        name.startsWith("setup-api."),
      );
      for (const setupFile of setupFiles) {
        const content = await fsp.readFile(path.join(extensionsDir, entry.name, setupFile), "utf8");
        for (const hook of HOOK_NAMES) {
          if (!content.includes(hook)) {
            continue;
          }
          if (ALLOWED.some((a) => a.plugin === entry.name && a.hook === hook)) {
            continue;
          }
          violations.push(`${entry.name}/${setupFile} implements ${hook}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
