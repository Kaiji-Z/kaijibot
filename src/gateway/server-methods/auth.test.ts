import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAuthHandlers } from "./auth.js";
import type { PluginManifestRegistry } from "../../plugins/manifest-registry.js";

vi.mock("../../agents/auth-profiles/store.js", () => ({
  loadAuthProfileStoreForSecretsRuntime: vi.fn(() => ({
    profiles: {
      "zai:default": { type: "api_key", provider: "zai", key: "test-key" },
      "ollama:default": { type: "api_key", provider: "ollama", key: "ollama-local" },
    },
  })),
}));

vi.mock("../../agents/auth-profiles/profiles.js", () => ({
  listProfilesForProvider: vi.fn(),
  upsertAuthProfile: vi.fn(),
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
});
