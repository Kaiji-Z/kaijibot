import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAuthHandlers, seedProviderModelsFromManifest } from "./auth.js";
import type { PluginManifestRegistry } from "../../plugins/manifest-registry.js";

const writeConfigFileMock = vi.fn().mockResolvedValue(undefined);
const loadConfigMock = vi.fn(() => ({ models: { providers: {} } }));

vi.mock("../../agents/auth-profiles/store.js", () => ({
  loadAuthProfileStoreForSecretsRuntime: vi.fn(() => ({
    profiles: {
      "zai:default": { type: "api_key", provider: "zai", key: "test-key" },
      "ollama:default": { type: "api_key", provider: "ollama", key: "ollama-local" },
    },
  })),
}));

const upsertAuthProfileMock = vi.fn();

vi.mock("../../agents/auth-profiles/profiles.js", () => ({
  listProfilesForProvider: vi.fn(),
  upsertAuthProfile: (...args: unknown[]) => upsertAuthProfileMock(...args),
}));

vi.mock("../../config/io.js", () => ({
  writeConfigFile: (cfg: unknown) => {
    writeConfigFileMock(cfg);
    return Promise.resolve();
  },
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

const listAgentIdsMock = vi.fn((_cfg: unknown) => ["main"]);
const resolveAgentDirMock = vi.fn((_cfg: unknown, agentId: string) => `/test/agents/${agentId}/agent`);

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: (cfg: unknown) => listAgentIdsMock(cfg),
  resolveAgentDir: (cfg: unknown, agentId: string) => resolveAgentDirMock(cfg, agentId),
}));

function mockRespond() {
  let ok: boolean | undefined;
  let payload: unknown;
  let error: unknown;
  return {
    respond: (isOk: boolean, p?: unknown, e?: unknown) => {
      ok = isOk;
      payload = p;
      error = e;
    },
    getResult: () => ({ ok, payload, error }),
  };
}

describe("createAuthHandlers", () => {
  describe("auth.listProviderAuthOptions", () => {
    it("returns providers from manifest registry when runtime registry is empty", async () => {
      const manifestReg: PluginManifestRegistry = {
        plugins: [
          {
            id: "qwen",
            providers: ["qwen"],
            providerAuthChoices: [
              {
                provider: "qwen",
                method: "standard-api-key-cn",
                choiceId: "qwen-standard-api-key-cn",
                choiceLabel: "Standard API Key (China)",
                choiceHint: "dashscope.aliyuncs.com",
              },
              {
                provider: "qwen",
                method: "standard-api-key",
                choiceId: "qwen-standard-api-key",
                choiceLabel: "Standard API Key (Global)",
              },
            ],
            channels: [],
            cliBackends: [],
            skills: [],
            hooks: [],
            origin: "bundled",
            rootDir: "/test",
            source: "bundled",
            manifestPath: "/test/kaijibot.plugin.json",
          },
          {
            id: "stepfun",
            providers: ["stepfun"],
            providerAuthChoices: [
              {
                provider: "stepfun",
                method: "api-key-cn",
                choiceId: "stepfun-api-key-cn",
                choiceLabel: "China API Key",
              },
            ],
            channels: [],
            cliBackends: [],
            skills: [],
            hooks: [],
            origin: "bundled",
            rootDir: "/test",
            source: "bundled",
            manifestPath: "/test/kaijibot.plugin.json",
          },
        ],
        diagnostics: [],
      };

      const handlers = createAuthHandlers({
        agentDir: "/test",
        getProviderRegistrations: () => [],
        getManifestRegistry: () => manifestReg,
      });

      const { respond, getResult } = mockRespond();
      await handlers["auth.listProviderAuthOptions"]({
        params: {},
        respond: respond as never,
      } as never);

      const result = getResult();
      expect(result.ok).toBe(true);
      const providers = (result.payload as { providers: Array<{ providerId: string; configured: boolean; authOptions: Array<{ id: string; label: string; hint?: string; kind: string }> }> }).providers;

      const providerIds = providers.map((p) => p.providerId);
      expect(providerIds).toContain("qwen");
      expect(providerIds).toContain("stepfun");

      const qwen = providers.find((p) => p.providerId === "qwen")!;
      expect(qwen.configured).toBe(false);
      expect(qwen.authOptions).toHaveLength(2);
      expect(qwen.authOptions[0].id).toBe("standard-api-key-cn");
      expect(qwen.authOptions[0].label).toBe("Standard API Key (China)");
      expect(qwen.authOptions[0].hint).toBe("dashscope.aliyuncs.com");
      expect(qwen.authOptions[0].kind).toBe("api_key");
    });

    it("merges runtime and manifest providers without duplicates", async () => {
      const manifestReg: PluginManifestRegistry = {
        plugins: [
          {
            id: "zai",
            providers: ["zai"],
            providerAuthChoices: [
              {
                provider: "zai",
                method: "api-key",
                choiceId: "zai-api-key",
                choiceLabel: "Z.AI API key",
              },
            ],
            channels: [],
            cliBackends: [],
            skills: [],
            hooks: [],
            origin: "bundled",
            rootDir: "/test",
            source: "bundled",
            manifestPath: "/test/kaijibot.plugin.json",
          },
          {
            id: "qwen",
            providers: ["qwen"],
            providerAuthChoices: [
              {
                provider: "qwen",
                method: "standard-api-key-cn",
                choiceId: "qwen-standard-api-key-cn",
                choiceLabel: "Qwen Standard",
              },
            ],
            channels: [],
            cliBackends: [],
            skills: [],
            hooks: [],
            origin: "bundled",
            rootDir: "/test",
            source: "bundled",
            manifestPath: "/test/kaijibot.plugin.json",
          },
        ],
        diagnostics: [],
      };

      const handlers = createAuthHandlers({
        agentDir: "/test",
        getProviderRegistrations: () => [
          {
            provider: {
              id: "zai",
              label: "Z.AI",
              auth: [
                {
                  id: "api-key",
                  label: "Z.AI API key",
                  kind: "api_key" as const,
                  run: vi.fn(),
                },
              ],
              catalog: { order: "simple", run: vi.fn() },
            },
          },
        ],
        getManifestRegistry: () => manifestReg,
      });

      const { respond, getResult } = mockRespond();
      await handlers["auth.listProviderAuthOptions"]({
        params: {},
        respond: respond as never,
      } as never);

      const result = getResult();
      expect(result.ok).toBe(true);
      const providers = (result.payload as { providers: Array<{ providerId: string; configured: boolean; providerLabel: string }> }).providers;

      const providerIds = providers.map((p) => p.providerId);
      expect(providerIds).toContain("zai");
      expect(providerIds).toContain("qwen");

      // zai comes from runtime (has full auth details, configured=true because auth store has zai)
      const zai = providers.find((p) => p.providerId === "zai")!;
      expect(zai.configured).toBe(true);
      expect(zai.providerLabel).toBe("Z.AI");

      // qwen comes from manifest only
      const qwen = providers.find((p) => p.providerId === "qwen")!;
      expect(qwen.configured).toBe(false);
    });

    it("returns empty providers when both registries are empty", async () => {
      const handlers = createAuthHandlers({
        agentDir: "/test",
        getProviderRegistrations: () => [],
        getManifestRegistry: () => ({ plugins: [], diagnostics: [] }),
      });

      const { respond, getResult } = mockRespond();
      await handlers["auth.listProviderAuthOptions"]({
        params: {},
        respond: respond as never,
      } as never);

      const result = getResult();
      expect(result.ok).toBe(true);
      expect((result.payload as { providers: unknown[] }).providers).toEqual([]);
    });
  });

  describe("auth.storeApiKey agentDir", () => {
    beforeEach(() => {
      upsertAuthProfileMock.mockClear();
    });

    it("passes undefined agentDir so upsertAuthProfile defaults to resolveKaijiBotAgentDir", async () => {
      const handlers = createAuthHandlers({
        getProviderRegistrations: () => [],
        getManifestRegistry: () => ({ plugins: [], diagnostics: [] }),
      });

      const { respond, getResult } = mockRespond();
      await handlers["auth.storeApiKey"]({
        params: { provider: "deepseek", apiKey: "sk-test" },
        respond: respond as never,
      } as never);

      const result = getResult();
      expect(result.ok).toBe(true);
      expect(upsertAuthProfileMock).toHaveBeenCalledTimes(1);
      const passedArg = upsertAuthProfileMock.mock.calls[0][0] as { agentDir?: string };
      expect(passedArg.agentDir).toBeUndefined();
    });

    it("does NOT pass a workspace-style path as agentDir", async () => {
      const handlers = createAuthHandlers({
        getProviderRegistrations: () => [],
        getManifestRegistry: () => ({ plugins: [], diagnostics: [] }),
      });

      await handlers["auth.storeApiKey"]({
        params: { provider: "zai", apiKey: "sk-test" },
        respond: vi.fn() as never,
      } as never);

      const passedArg = upsertAuthProfileMock.mock.calls[0][0] as { agentDir?: string };
      expect(passedArg.agentDir ?? "").not.toContain("workspace");
    });
  });

  describe("auth.storeApiKey multi-agent", () => {
    beforeEach(() => {
      upsertAuthProfileMock.mockClear();
      listAgentIdsMock.mockClear();
      resolveAgentDirMock.mockClear();
    });

    it("broadcasts to all agent dirs when agentId is omitted", async () => {
      listAgentIdsMock.mockReturnValue(["main", "research"]);
      resolveAgentDirMock.mockImplementation((_cfg: unknown, id: string) => `/test/agents/${id}/agent`);

      const handlers = createAuthHandlers({
        getConfig: () => ({ agents: { list: [{ id: "main" }, { id: "research" }] } }),
        getProviderRegistrations: () => [],
        getManifestRegistry: () => ({ plugins: [], diagnostics: [] }),
      });

      const { respond, getResult } = mockRespond();
      await handlers["auth.storeApiKey"]({
        params: { provider: "deepseek", apiKey: "sk-test" },
        respond: respond as never,
      } as never);

      const result = getResult();
      expect(result.ok).toBe(true);
      expect(upsertAuthProfileMock).toHaveBeenCalledTimes(2);

      const dir0 = upsertAuthProfileMock.mock.calls[0][0].agentDir as string;
      const dir1 = upsertAuthProfileMock.mock.calls[1][0].agentDir as string;
      expect(dir0).toContain("/agents/main/agent");
      expect(dir1).toContain("/agents/research/agent");
    });

    it("writes to a single agent dir when agentId is specified", async () => {
      listAgentIdsMock.mockReturnValue(["main", "research"]);
      resolveAgentDirMock.mockImplementation((_cfg: unknown, id: string) => `/test/agents/${id}/agent`);

      const handlers = createAuthHandlers({
        getConfig: () => ({ agents: { list: [{ id: "main" }, { id: "research" }] } }),
        getProviderRegistrations: () => [],
        getManifestRegistry: () => ({ plugins: [], diagnostics: [] }),
      });

      await handlers["auth.storeApiKey"]({
        params: { provider: "deepseek", apiKey: "sk-test", agentId: "research" },
        respond: vi.fn() as never,
      } as never);

      expect(upsertAuthProfileMock).toHaveBeenCalledTimes(1);
      const passedArg = upsertAuthProfileMock.mock.calls[0][0];
      expect(passedArg.agentDir).toContain("/agents/research/agent");
    });

    it("falls back to single dir when getConfig is not provided", async () => {
      const handlers = createAuthHandlers({
        getProviderRegistrations: () => [],
        getManifestRegistry: () => ({ plugins: [], diagnostics: [] }),
      });

      await handlers["auth.storeApiKey"]({
        params: { provider: "deepseek", apiKey: "sk-test" },
        respond: vi.fn() as never,
      } as never);

      expect(upsertAuthProfileMock).toHaveBeenCalledTimes(1);
      const passedArg = upsertAuthProfileMock.mock.calls[0][0] as { agentDir?: string };
      expect(passedArg.agentDir).toBeUndefined();
    });
  });

  describe("seedProviderModelsFromManifest", () => {
    beforeEach(() => {
      writeConfigFileMock.mockClear();
      loadConfigMock.mockClear();
      loadConfigMock.mockReturnValue({ models: { providers: {} } });
    });

    function makeRegistry(
      modelCatalog?: Record<string, unknown>,
    ): PluginManifestRegistry {
      return {
        plugins: [
          {
            id: "deepseek",
            providers: ["deepseek"],
            channels: [],
            cliBackends: [],
            skills: [],
            hooks: [],
            origin: "bundled",
            rootDir: "/test",
            source: "bundled",
            manifestPath: "/test/kaijibot.plugin.json",
            ...(modelCatalog ? { modelCatalog: modelCatalog as never } : {}),
          },
        ],
        diagnostics: [],
      };
    }

    const DEEPSEEK_CATALOG = {
      providers: {
        deepseek: {
          baseUrl: "https://api.deepseek.com",
          api: "openai-completions",
          models: [
            {
              id: "deepseek-chat",
              name: "DeepSeek Chat",
              reasoning: false,
              input: ["text"],
              contextWindow: 131072,
              maxTokens: 8192,
              cost: { input: 0.28, output: 0.42, cacheRead: 0.028, cacheWrite: 0 },
            },
            {
              id: "deepseek-reasoner",
              name: "DeepSeek Reasoner",
              reasoning: true,
              input: ["text"],
              contextWindow: 131072,
              maxTokens: 65536,
              cost: { input: 0.28, output: 0.42, cacheRead: 0.028, cacheWrite: 0 },
            },
          ],
        },
      },
    };

    it("seeds models into config when provider has modelCatalog but config is empty", () => {
      seedProviderModelsFromManifest("deepseek", () => makeRegistry(DEEPSEEK_CATALOG));

      expect(writeConfigFileMock).toHaveBeenCalledTimes(1);
      const writtenCfg = writeConfigFileMock.mock.calls[0][0] as {
        models: { providers: Record<string, { baseUrl: string; models: unknown[] }> };
      };
      const ds = writtenCfg.models.providers.deepseek;
      expect(ds.baseUrl).toBe("https://api.deepseek.com");
      expect(ds.models).toHaveLength(2);
      expect((ds.models[0] as { id: string }).id).toBe("deepseek-chat");
    });

    it("does NOT seed when config already has models for the provider", () => {
      loadConfigMock.mockReturnValue({
        models: {
          providers: {
            deepseek: { baseUrl: "existing", models: [{ id: "existing-model" }] },
          },
        },
      });

      seedProviderModelsFromManifest("deepseek", () => makeRegistry(DEEPSEEK_CATALOG));

      expect(writeConfigFileMock).not.toHaveBeenCalled();
    });

    it("does nothing when manifest has no modelCatalog", () => {
      seedProviderModelsFromManifest("deepseek", () => makeRegistry(undefined));
      expect(writeConfigFileMock).not.toHaveBeenCalled();
    });

    it("does nothing when getManifestRegistry is not provided", () => {
      seedProviderModelsFromManifest("deepseek", undefined);
      expect(writeConfigFileMock).not.toHaveBeenCalled();
    });

    it("does nothing when provider is not in manifest registry", () => {
      seedProviderModelsFromManifest("unknown-provider", () => makeRegistry(DEEPSEEK_CATALOG));
      expect(writeConfigFileMock).not.toHaveBeenCalled();
    });
  });
});
