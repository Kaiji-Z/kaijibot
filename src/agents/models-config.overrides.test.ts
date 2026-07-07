import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";
import { resolveDiscoveryOverrides } from "./models-config.overrides.js";
import { planKaijiBotModelsJsonWithDeps, type ModelsJsonPlan } from "./models-config.plan.js";

function writeModelsDevCache(agentDir: string) {
  mkdirSync(join(agentDir, "cache"), { recursive: true });
  writeFileSync(
    join(agentDir, "cache", "models-dev.json"),
    JSON.stringify({
      fetchedAt: Date.now(),
      source: "models.dev",
      data: {
        zai: {
          id: "zai",
          name: "ZAI",
          models: {
            "glm-5.2": {
              id: "glm-5.2",
              name: "GLM-5.2",
              reasoning: true,
              limit: { context: 1000000, output: 131072 },
              modalities: { input: ["text"], output: ["text"] },
            },
            "glm-4.7": {
              id: "glm-4.7",
              name: "GLM-4.7",
              reasoning: true,
              limit: { context: 204800, output: 131072 },
              modalities: { input: ["text"], output: ["text"] },
            },
          },
        },
      },
    }),
  );
}

function writeProviderModelsCache(agentDir: string, providers: Record<string, string[]>) {
  mkdirSync(join(agentDir, "cache"), { recursive: true });
  const entries: Record<string, { modelIds: string[]; fetchedAt: number }> = {};
  for (const [p, ids] of Object.entries(providers)) {
    entries[p] = { modelIds: ids, fetchedAt: Date.now() };
  }
  writeFileSync(
    join(agentDir, "cache", "provider-models.json"),
    JSON.stringify({ providers: entries }),
  );
}

describe("resolveDiscoveryOverrides", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "overrides-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns empty when no cache files exist", async () => {
    const result = await resolveDiscoveryOverrides(tempDir);
    expect(result).toEqual({});
  });

  it("returns empty when models-dev cache exists but provider cache missing", async () => {
    writeModelsDevCache(tempDir);
    const result = await resolveDiscoveryOverrides(tempDir);
    expect(result).toEqual({});
  });

  it("returns contextWindow from models.dev for cached provider models", async () => {
    writeModelsDevCache(tempDir);
    writeProviderModelsCache(tempDir, { zai: ["glm-5.2", "glm-4.7"] });

    const result = await resolveDiscoveryOverrides(tempDir);
    expect(result.zai?.["glm-5.2"]?.contextWindow).toBe(1000000);
    expect(result.zai?.["glm-5.2"]?.reasoning).toBe(true);
    expect(result.zai?.["glm-4.7"]?.contextWindow).toBe(204800);
  });

  it("skips models not in models.dev", async () => {
    writeModelsDevCache(tempDir);
    writeProviderModelsCache(tempDir, { zai: ["glm-5.2", "unknown-future-model"] });

    const result = await resolveDiscoveryOverrides(tempDir);
    expect(result.zai?.["glm-5.2"]).toBeDefined();
    expect(result.zai?.["unknown-future-model"]).toBeUndefined();
  });

  it("handles missing provider gracefully", async () => {
    writeModelsDevCache(tempDir);
    writeProviderModelsCache(tempDir, { openai: ["gpt-4o"] });

    const result = await resolveDiscoveryOverrides(tempDir);
    expect(result.openai?.["gpt-4o"]).toBeUndefined();
  });
});

describe("planKaijiBotModelsJson with discovery overrides", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "plan-ov-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function minimalConfig(): KaijiBotConfig {
    return {
      models: {
        providers: {
          zai: {
            baseUrl: "https://open.bigmodel.cn/api/paas/v4",
            apiKey: "test-key",
            api: "openai-completions",
            models: [
              {
                id: "glm-5.2",
                name: "GLM-5.2",
                reasoning: true,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 200000,
                maxTokens: 131072,
              },
            ],
          },
        },
      },
    } as unknown as KaijiBotConfig;
  }

  async function runPlan(agentDir: string, cfg: KaijiBotConfig): Promise<ModelsJsonPlan> {
    return planKaijiBotModelsJsonWithDeps(
      {
        cfg,
        agentDir,
        env: {},
        existingRaw: "",
        existingParsed: null,
      },
      {
        resolveImplicitProviders: async () => ({}),
      },
    );
  }

  it("injects modelOverrides when discovery cache exists", async () => {
    writeModelsDevCache(tempDir);
    writeProviderModelsCache(tempDir, { zai: ["glm-5.2"] });

    const plan = await runPlan(tempDir, minimalConfig());
    expect(plan.action).toBe("write");

    const parsed = JSON.parse((plan as { contents: string }).contents);
    expect(parsed.providers.zai.modelOverrides).toBeDefined();
    expect(parsed.providers.zai.modelOverrides["glm-5.2"]?.contextWindow).toBe(1000000);
  });

  it("does not inject modelOverrides when no discovery cache", async () => {
    const plan = await runPlan(tempDir, minimalConfig());
    expect(plan.action).toBe("write");

    const parsed = JSON.parse((plan as { contents: string }).contents);
    expect(parsed.providers.zai.modelOverrides).toBeUndefined();
  });

  it("produces different output when cache is added (fingerprint busts)", async () => {
    const planBefore = await runPlan(tempDir, minimalConfig());
    const parsedBefore = JSON.parse((planBefore as { contents: string }).contents);

    writeModelsDevCache(tempDir);
    writeProviderModelsCache(tempDir, { zai: ["glm-5.2"] });

    const planAfter = await runPlan(tempDir, minimalConfig());
    const parsedAfter = JSON.parse((planAfter as { contents: string }).contents);

    expect(parsedBefore.providers.zai.modelOverrides).toBeUndefined();
    expect(parsedAfter.providers.zai.modelOverrides).toBeDefined();
    expect((planBefore as { contents: string }).contents).not.toEqual(
      (planAfter as { contents: string }).contents,
    );
  });
});
