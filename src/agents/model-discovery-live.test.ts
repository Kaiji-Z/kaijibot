import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — hoisted by vitest before imports.
// ---------------------------------------------------------------------------

vi.mock("./model-discovery-modelsdev.js", () => ({
  readModelsDevDiskCache: vi.fn(),
  triggerModelsDevBackgroundRefresh: vi.fn(),
  buildModelsDevIndex: vi.fn(),
  lookupModelMetadata: vi.fn(),
  MODELS_DEV_DISK_TTL_MS: 24 * 60 * 60 * 1000,
}));

vi.mock("./model-discovery-providers.js", () => ({
  SKIP_DISCOVERY_APIS: new Set(["bedrock-converse-stream"]),
  extractMajorVersionFamily: vi.fn(),
  fetchProviderModelIds: vi.fn(),
  findFamilyEntry: vi.fn(),
}));

vi.mock("./model-auth-env.js", () => ({
  resolveEnvApiKey: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks are in place.
// ---------------------------------------------------------------------------

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEnvApiKey } from "./model-auth-env.js";
import type { ModelCatalogEntry } from "./model-catalog.js";
import {
  discoverLiveModels,
  EMPTY_LIVE_RESULT,
  inferModelEntry,
  resetLiveDiscoveryCacheForTest,
  type ProviderRuntimeInfo,
} from "./model-discovery-live.js";
import {
  buildModelsDevIndex,
  lookupModelMetadata,
  readModelsDevDiskCache,
  triggerModelsDevBackgroundRefresh,
  type ModelsDevCatalog,
  type ModelsDevModelIndex,
} from "./model-discovery-modelsdev.js";
import { fetchProviderModelIds, findFamilyEntry } from "./model-discovery-providers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal valid ModelsDevModelIndex (lookups are mocked so contents don't matter). */
function mockIndex(): ModelsDevModelIndex {
  return {
    byProviderId: new Map(),
    byBaseUrlHost: new Map(),
    allModelsById: new Map(),
    allModelsByLastSegment: new Map(),
  };
}

/** A warm disk-cache result with a small catalog. */
function warmDiskCache() {
  const catalog: ModelsDevCatalog = {
    zai: {
      id: "zai",
      name: "Zhipu AI",
      api: "https://open.bigmodel.cn/api/paas/v4",
      models: {
        "glm-5": { id: "glm-5", name: "GLM-5" },
      },
    },
  };
  return { catalog, fetchedAt: Date.now() };
}

/** A single-provider runtime map with an OpenAI-compatible endpoint. */
function zaiRuntime(): ReadonlyMap<string, ProviderRuntimeInfo> {
  return new Map([
    [
      "zai",
      {
        provider: "zai",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        api: "openai-completions",
      },
    ],
  ]);
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetLiveDiscoveryCacheForTest();
  rmSync("/tmp/agent/cache", { recursive: true, force: true });
  vi.mocked(readModelsDevDiskCache).mockReset();
  vi.mocked(triggerModelsDevBackgroundRefresh).mockReset();
  vi.mocked(buildModelsDevIndex).mockReset();
  vi.mocked(lookupModelMetadata).mockReset();
  vi.mocked(fetchProviderModelIds).mockReset();
  vi.mocked(findFamilyEntry).mockReset();
  vi.mocked(resolveEnvApiKey).mockReset();
});

afterEach(() => {
  resetLiveDiscoveryCacheForTest();
});

// ---------------------------------------------------------------------------
// R21 — test-environment gate
// ---------------------------------------------------------------------------

describe("R21: discoverLiveModels gates on VITEST env", () => {
  it("returns EMPTY_LIVE_RESULT without touching disk or network", async () => {
    const result = await discoverLiveModels({
      agentDir: "/nonexistent/agent-dir",
      env: { VITEST: "1" },
      existingCatalog: [],
      providerRuntimeInfo: new Map(),
    });

    expect(result).toBe(EMPTY_LIVE_RESULT);
    expect(readModelsDevDiskCache).not.toHaveBeenCalled();
    expect(fetchProviderModelIds).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R22 — explicit disable gate
// ---------------------------------------------------------------------------

describe("R22: discoverLiveModels gates on KAIJIBOT_DISABLE_LIVE_MODEL_DISCOVERY", () => {
  it("returns EMPTY_LIVE_RESULT when disabled", async () => {
    const result = await discoverLiveModels({
      agentDir: "/nonexistent/agent-dir",
      env: { KAIJIBOT_DISABLE_LIVE_MODEL_DISCOVERY: "1" },
      existingCatalog: [],
      providerRuntimeInfo: new Map(),
    });

    expect(result).toBe(EMPTY_LIVE_RESULT);
    expect(readModelsDevDiskCache).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R23 — disk cache absent triggers background refresh
// ---------------------------------------------------------------------------

describe("R23: absent disk cache triggers background refresh", () => {
  it("returns EMPTY_LIVE_RESULT and fires triggerModelsDevBackgroundRefresh", async () => {
    vi.mocked(readModelsDevDiskCache).mockResolvedValue(null);

    const result = await discoverLiveModels({
      agentDir: "/tmp/agent",
      env: {},
      existingCatalog: [],
      providerRuntimeInfo: zaiRuntime(),
    });

    expect(result).toBe(EMPTY_LIVE_RESULT);
    expect(triggerModelsDevBackgroundRefresh).toHaveBeenCalledTimes(1);
    expect(triggerModelsDevBackgroundRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ cachePath: expect.stringContaining("models-dev.json") }),
    );
    expect(fetchProviderModelIds).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R24 — warm cache + endpoint → new entries
// ---------------------------------------------------------------------------

describe("R24: warm cache with one endpoint discovers new models", () => {
  it("returns entries not already in existingCatalog", async () => {
    vi.mocked(readModelsDevDiskCache).mockResolvedValue(warmDiskCache());
    vi.mocked(buildModelsDevIndex).mockReturnValue(mockIndex());
    vi.mocked(resolveEnvApiKey).mockReturnValue({ apiKey: "test-key", source: "env" });
    vi.mocked(fetchProviderModelIds).mockResolvedValue(["glm-future-new"]);
    vi.mocked(lookupModelMetadata).mockReturnValue(null);
    vi.mocked(findFamilyEntry).mockReturnValue(null);

    const existingCatalog: ModelCatalogEntry[] = [{ id: "glm-5", provider: "zai", name: "GLM-5" }];

    const result = await discoverLiveModels({
      agentDir: "/tmp/agent",
      env: {},
      existingCatalog,
      providerRuntimeInfo: zaiRuntime(),
    });

    expect(result.discoveredCount).toBe(1);
    const found = result.entries.find((e) => e.id === "glm-future-new");
    expect(found).toBeDefined();
    expect(found?.provider).toBe("zai");

    // Existing model should NOT be re-added
    const existing = result.entries.find((e) => e.id === "glm-5");
    expect(existing).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// R25 — dedup: model already in existingCatalog
// ---------------------------------------------------------------------------

describe("R25: duplicate model id is not re-added", () => {
  it("returns empty entries when fetched model already exists", async () => {
    vi.mocked(readModelsDevDiskCache).mockResolvedValue(warmDiskCache());
    vi.mocked(buildModelsDevIndex).mockReturnValue(mockIndex());
    vi.mocked(resolveEnvApiKey).mockReturnValue({ apiKey: "test-key", source: "env" });
    vi.mocked(fetchProviderModelIds).mockResolvedValue(["glm-5"]);
    vi.mocked(lookupModelMetadata).mockReturnValue(null);
    vi.mocked(findFamilyEntry).mockReturnValue(null);

    const existingCatalog: ModelCatalogEntry[] = [{ id: "glm-5", provider: "zai", name: "GLM-5" }];

    const result = await discoverLiveModels({
      agentDir: "/tmp/agent",
      env: {},
      existingCatalog,
      providerRuntimeInfo: zaiRuntime(),
    });

    expect(result.entries).toHaveLength(0);
    expect(result.discoveredCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R26 — discovery failure isolation
// ---------------------------------------------------------------------------

describe("R26: provider fetch failure does not throw", () => {
  it("returns empty-shaped result when fetchProviderModelIds rejects", async () => {
    vi.mocked(readModelsDevDiskCache).mockResolvedValue(warmDiskCache());
    vi.mocked(buildModelsDevIndex).mockReturnValue(mockIndex());
    vi.mocked(resolveEnvApiKey).mockReturnValue({ apiKey: "test-key", source: "env" });
    vi.mocked(fetchProviderModelIds).mockRejectedValue(new Error("network down"));
    vi.mocked(lookupModelMetadata).mockReturnValue(null);
    vi.mocked(findFamilyEntry).mockReturnValue(null);

    const result = await discoverLiveModels({
      agentDir: "/tmp/agent",
      env: {},
      existingCatalog: [],
      providerRuntimeInfo: zaiRuntime(),
    });

    expect(result.entries).toHaveLength(0);
    expect(result.discoveredCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R27 — budget cutoff
// ---------------------------------------------------------------------------

describe("R27: budget cutoff drops slow endpoints", () => {
  it("only includes models from the fast endpoint within budget", async () => {
    vi.mocked(readModelsDevDiskCache).mockResolvedValue(warmDiskCache());
    vi.mocked(buildModelsDevIndex).mockReturnValue(mockIndex());
    vi.mocked(resolveEnvApiKey).mockReturnValue({ apiKey: "key", source: "env" });
    vi.mocked(lookupModelMetadata).mockReturnValue(null);
    vi.mocked(findFamilyEntry).mockReturnValue(null);

    vi.mocked(fetchProviderModelIds).mockImplementation(async (params) => {
      if (params.provider === "fast") {
        return ["fast-model"];
      }
      if (params.provider === "slow") {
        await new Promise((r) => setTimeout(r, 500));
        return ["slow-model"];
      }
      return [];
    });

    const providerRuntimeInfo = new Map<string, ProviderRuntimeInfo>([
      [
        "fast",
        { provider: "fast", baseUrl: "https://fast.example.com/v1", api: "openai-completions" },
      ],
      [
        "slow",
        { provider: "slow", baseUrl: "https://slow.example.com/v1", api: "openai-completions" },
      ],
    ]);

    const result = await discoverLiveModels({
      agentDir: "/tmp/agent",
      env: {},
      existingCatalog: [],
      providerRuntimeInfo,
      budgetMs: 50,
    });

    const ids = result.entries.map((e) => e.id);
    expect(ids).toContain("fast-model");
    expect(ids).not.toContain("slow-model");
  });
});

// ---------------------------------------------------------------------------
// R28 — in-memory cache
// ---------------------------------------------------------------------------

describe("R28: in-memory cache avoids re-fetch within TTL", () => {
  it("calls fetchProviderModelIds only once across two calls", async () => {
    vi.mocked(readModelsDevDiskCache).mockResolvedValue(warmDiskCache());
    vi.mocked(buildModelsDevIndex).mockReturnValue(mockIndex());
    vi.mocked(resolveEnvApiKey).mockReturnValue({ apiKey: "key", source: "env" });
    vi.mocked(fetchProviderModelIds).mockResolvedValue(["cached-model"]);
    vi.mocked(lookupModelMetadata).mockReturnValue(null);
    vi.mocked(findFamilyEntry).mockReturnValue(null);

    const params = {
      agentDir: "/tmp/agent",
      env: {},
      existingCatalog: [] as ModelCatalogEntry[],
      providerRuntimeInfo: zaiRuntime(),
    };

    const r1 = await discoverLiveModels(params);
    const r2 = await discoverLiveModels(params);

    expect(r1).toBe(r2); // referential equality — cached
    expect(r1.entries.find((e) => e.id === "cached-model")).toBeDefined();
    expect(fetchProviderModelIds).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// R29 — inferModelEntry precedence
// ---------------------------------------------------------------------------

describe("R29: inferModelEntry resolution cascade", () => {
  const existingCatalog: ModelCatalogEntry[] = [
    { id: "glm-5", provider: "zai", name: "GLM-5", contextWindow: 128000, reasoning: false },
  ];

  it("R29a: models.dev hit → contextWindow from models.dev", () => {
    vi.mocked(lookupModelMetadata).mockReturnValue({
      name: "GLM Future",
      contextWindow: 200000,
      reasoning: true,
      input: ["text", "image"],
    });
    vi.mocked(findFamilyEntry).mockReturnValue(null);

    const entry = inferModelEntry({
      provider: "zai",
      modelId: "glm-future",
      index: mockIndex(),
      existingCatalog,
    });

    expect(entry.contextWindow).toBe(200000);
    expect(entry.reasoning).toBe(true);
    expect(entry.name).toBe("GLM Future");
    expect(entry.input).toEqual(["text", "image"]);
    // findFamilyEntry should NOT be consulted when models.dev hits
    expect(findFamilyEntry).not.toHaveBeenCalled();
  });

  it("R29b: models.dev miss + family match → contextWindow from family", () => {
    vi.mocked(lookupModelMetadata).mockReturnValue(null);
    vi.mocked(findFamilyEntry).mockReturnValue({
      contextWindow: 256000,
      reasoning: true,
      input: ["text"],
    });

    const entry = inferModelEntry({
      provider: "zai",
      modelId: "glm-5-turbo",
      index: mockIndex(),
      existingCatalog,
    });

    expect(entry.contextWindow).toBe(256000);
    expect(entry.reasoning).toBe(true);
    expect(entry.name).toBe("glm-5-turbo"); // name defaults to modelId
  });

  it("R29c: both miss → defaults (contextWindow 128000, input ['text'])", () => {
    vi.mocked(lookupModelMetadata).mockReturnValue(null);
    vi.mocked(findFamilyEntry).mockReturnValue(null);

    const entry = inferModelEntry({
      provider: "zai",
      modelId: "unknown-model",
      index: mockIndex(),
      existingCatalog,
    });

    expect(entry.contextWindow).toBe(128000);
    expect(entry.input).toEqual(["text"]);
    expect(entry.reasoning).toBeUndefined();
    expect(entry.name).toBe("unknown-model");
  });
});

describe("Provider disk cache", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "live-disco-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function setupWarmMocks() {
    vi.mocked(readModelsDevDiskCache).mockResolvedValue(warmDiskCache());
    vi.mocked(buildModelsDevIndex).mockReturnValue(mockIndex());
    vi.mocked(lookupModelMetadata).mockReturnValue(null);
    vi.mocked(findFamilyEntry).mockReturnValue(null);
    vi.mocked(resolveEnvApiKey).mockReturnValue({ apiKey: "test-key", source: "env" });
  }

  function writeProviderCache(
    providers: Record<string, { modelIds: string[]; fetchedAt: number }>,
  ) {
    mkdirSync(join(tempDir, "cache"), { recursive: true });
    writeFileSync(join(tempDir, "cache", "provider-models.json"), JSON.stringify({ providers }));
  }

  it("skips provider API when disk cache is fresh (<12h)", async () => {
    setupWarmMocks();
    writeProviderCache({
      zai: { modelIds: ["glm-cached-model"], fetchedAt: Date.now() },
    });

    const result = await discoverLiveModels({
      agentDir: tempDir,
      env: {},
      existingCatalog: [],
      providerRuntimeInfo: zaiRuntime(),
    });

    expect(fetchProviderModelIds).not.toHaveBeenCalled();
    expect(result.discoveredCount).toBe(1);
    expect(result.entries[0]?.id).toBe("glm-cached-model");
  });

  it("refetches provider API when disk cache is stale (>12h)", async () => {
    setupWarmMocks();
    vi.mocked(fetchProviderModelIds).mockResolvedValue(["glm-fresh-model"]);
    writeProviderCache({
      zai: {
        modelIds: ["glm-stale-model"],
        fetchedAt: Date.now() - 13 * 60 * 60 * 1000,
      },
    });

    const result = await discoverLiveModels({
      agentDir: tempDir,
      env: {},
      existingCatalog: [],
      providerRuntimeInfo: zaiRuntime(),
    });

    expect(fetchProviderModelIds).toHaveBeenCalledTimes(1);
    expect(result.discoveredCount).toBe(1);
    expect(result.entries[0]?.id).toBe("glm-fresh-model");
  });

  it("falls back to stale cache IDs when provider API returns empty", async () => {
    setupWarmMocks();
    vi.mocked(fetchProviderModelIds).mockResolvedValue([]);
    writeProviderCache({
      zai: {
        modelIds: ["glm-stale-fallback"],
        fetchedAt: Date.now() - 13 * 60 * 60 * 1000,
      },
    });

    const result = await discoverLiveModels({
      agentDir: tempDir,
      env: {},
      existingCatalog: [],
      providerRuntimeInfo: zaiRuntime(),
    });

    expect(fetchProviderModelIds).toHaveBeenCalledTimes(1);
    expect(result.discoveredCount).toBe(1);
    expect(result.entries[0]?.id).toBe("glm-stale-fallback");
  });
});
