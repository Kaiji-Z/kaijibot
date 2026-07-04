import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildModelsDevIndex,
  loadModelsDevCatalog,
  lookupModelMetadata,
  modelsDevModelToMetadata,
  readModelsDevDiskCache,
  resetModelsDevCacheForTest,
  triggerModelsDevBackgroundRefresh,
  writeModelsDevDiskCache,
  type ModelsDevCatalog,
  type ModelsDevModel,
} from "./model-discovery-modelsdev.js";

/** Build a JSON Response matching what `fetchWithTimeout` expects from a fetchFn. */
function makeJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A fetchFn that resolves to `payload` as JSON. */
function fetchReturning(payload: unknown): typeof fetch {
  return vi.fn(async () => makeJsonResponse(payload)) as unknown as typeof fetch;
}

/** A fetchFn that rejects with an Error. */
function fetchThrowing(message = "network down"): typeof fetch {
  return vi.fn(async () => {
    throw new Error(message);
  }) as unknown as typeof fetch;
}

/** Poll the disk cache until it appears, or fail after `timeoutMs`. */
async function waitForDiskCache(
  cachePath: string,
  timeoutMs = 2000,
): Promise<{ catalog: ModelsDevCatalog; fetchedAt: number }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const cached = await readModelsDevDiskCache(cachePath);
    if (cached) {
      return cached;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`disk cache never appeared at ${cachePath}`);
}

describe("model-discovery-modelsdev", () => {
  let tmpRoot: string;
  let cachePath: string;

  beforeEach(() => {
    resetModelsDevCacheForTest();
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "kaijibot-modelsdev-"));
    cachePath = path.join(tmpRoot, "cache", "models-dev.json");
  });

  afterEach(() => {
    resetModelsDevCacheForTest();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------
  // R1: missing disk cache -> null
  // ---------------------------------------------------------------------
  it("R1: readModelsDevDiskCache returns null for a missing file", async () => {
    const result = await readModelsDevDiskCache(cachePath);
    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------
  // R2: round-trip
  // ---------------------------------------------------------------------
  it("R2: writeModelsDevDiskCache then readModelsDevDiskCache round-trips", async () => {
    const catalog: ModelsDevCatalog = {
      zai: {
        id: "zai",
        name: "ZAI",
        models: {
          "glm-4.7": { id: "glm-4.7", name: "GLM-4.7", reasoning: true },
        },
      },
    };
    await writeModelsDevDiskCache(cachePath, catalog);
    const result = await readModelsDevDiskCache(cachePath);
    expect(result).not.toBeNull();
    expect(result?.fetchedAt).toBeGreaterThan(0);
    expect(result?.catalog).toEqual(catalog);
  });

  // ---------------------------------------------------------------------
  // R3: fresh cache served without fetch
  // ---------------------------------------------------------------------
  it("R3: loadModelsDevCatalog with fresh disk cache returns cached without calling fetch", async () => {
    const cached: ModelsDevCatalog = {
      zai: { id: "zai", models: { cached: { id: "cached" } } },
    };
    await writeModelsDevDiskCache(cachePath, cached);

    const spy = fetchThrowing("should not be called");
    const result = await loadModelsDevCatalog({ cachePath, fetchFn: spy });

    // Fresh cache returned as-is; fetch never invoked.
    expect(result).toEqual(cached);
    expect(spy).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // R4: absent cache -> fetch synchronously + write disk
  // ---------------------------------------------------------------------
  it("R4: loadModelsDevCatalog with absent cache fetches, writes disk, returns catalog", async () => {
    const before = Date.now();
    const payload = {
      data: {
        zai: {
          id: "zai",
          models: {
            "glm-4.7": { id: "glm-4.7", limit: { context: 200000 }, reasoning: true },
          },
        },
      },
    };
    const spy = fetchReturning(payload);

    const result = await loadModelsDevCatalog({ cachePath, fetchFn: spy });
    const after = Date.now();

    expect(result).toEqual(payload);
    expect(spy).toHaveBeenCalledTimes(1);

    const disk = await readModelsDevDiskCache(cachePath);
    expect(disk).not.toBeNull();
    expect(disk?.fetchedAt).toBeGreaterThanOrEqual(before);
    expect(disk?.fetchedAt).toBeLessThanOrEqual(after);
    expect(disk?.catalog).toEqual(payload);
  });

  // ---------------------------------------------------------------------
  // R5: fetch failure -> {} and no disk write
  // ---------------------------------------------------------------------
  it("R5: loadModelsDevCatalog on fetch failure returns empty catalog and does not write disk", async () => {
    const spy = fetchThrowing("boom");
    const result = await loadModelsDevCatalog({ cachePath, fetchFn: spy });

    expect(result).toEqual({});
    expect(spy).toHaveBeenCalledTimes(1);
    // Nothing written to disk.
    expect(await readModelsDevDiskCache(cachePath)).toBeNull();
  });

  // ---------------------------------------------------------------------
  // R6: background refresh dedupes and never rejects
  // ---------------------------------------------------------------------
  it("R6: triggerModelsDevBackgroundRefresh dedupes concurrent calls", async () => {
    const payload: ModelsDevCatalog = {
      zai: { id: "zai", models: { "glm-4.7": { id: "glm-4.7" } } },
    };
    const spy = fetchReturning(payload);

    // Two synchronous calls — must dedupe to a single fetch.
    triggerModelsDevBackgroundRefresh({ cachePath, fetchFn: spy });
    triggerModelsDevBackgroundRefresh({ cachePath, fetchFn: spy });

    await waitForDiskCache(cachePath);

    expect(spy).toHaveBeenCalledTimes(1);
    const disk = await readModelsDevDiskCache(cachePath);
    expect(disk?.catalog).toEqual(payload);
  });

  it("R6b: triggerModelsDevBackgroundRefresh never rejects when fetch throws", async () => {
    const spy = fetchThrowing("injected failure");
    // Attach an unhandled-rejection guard to catch any escaping rejection.
    const unhandled: unknown[] = [];
    const handler = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", handler);
    try {
      triggerModelsDevBackgroundRefresh({ cachePath, fetchFn: spy });
      // Allow the microtask queue + any pending work to drain.
      await new Promise((r) => setTimeout(r, 100));
      // No unhandled rejection should have been emitted.
      expect(unhandled).toHaveLength(0);
      // The refresh slot must be cleared so a future call can retry.
      // Verify by triggering again with a working fetch.
      const ok = fetchReturning({ fresh: { id: "fresh" } });
      triggerModelsDevBackgroundRefresh({ cachePath, fetchFn: ok });
      await waitForDiskCache(cachePath);
    } finally {
      process.off("unhandledRejection", handler);
    }
  });

  // ---------------------------------------------------------------------
  // R7: index building
  // ---------------------------------------------------------------------
  it("R7: buildModelsDevIndex populates all four maps", () => {
    const catalog: ModelsDevCatalog = {
      zai: {
        id: "zai",
        name: "ZAI",
        api: "https://api.z.ai/api/coding/paas/v4",
        models: {
          "glm-4.7": { id: "glm-4.7", name: "GLM-4.7", reasoning: true },
          "glm-4.6": { id: "glm-4.6" },
        },
      },
      google: {
        id: "google",
        name: "Google",
        models: {
          "google/gemini-2.5-pro": { id: "google/gemini-2.5-pro" },
        },
      },
    };

    const index = buildModelsDevIndex(catalog);

    // byProviderId — keyed by lowercase slug.
    expect(index.byProviderId.get("zai")?.id).toBe("zai");
    expect(index.byProviderId.get("google")?.id).toBe("google");
    expect(index.byProviderId.get("ZAI")).toBeUndefined(); // keys are lowercase

    // byBaseUrlHost — hostname from provider.api.
    expect(index.byBaseUrlHost.get("api.z.ai")?.id).toBe("zai");
    expect(index.byBaseUrlHost.has("google.com")).toBe(false);

    // allModelsById — keyed by lowercase full id.
    expect(index.allModelsById.get("glm-4.7")?.model.id).toBe("glm-4.7");
    expect(index.allModelsById.get("glm-4.6")?.model.id).toBe("glm-4.6");
    expect(index.allModelsById.get("google/gemini-2.5-pro")?.provider.id).toBe("google");

    // allModelsByLastSegment — substring after last "/".
    expect(index.allModelsByLastSegment.get("gemini-2.5-pro")?.model.id).toBe(
      "google/gemini-2.5-pro",
    );
    expect(index.allModelsByLastSegment.get("glm-4.7")?.model.id).toBe("glm-4.7");
  });

  // ---------------------------------------------------------------------
  // R8: provider-scoped lookup hit
  // ---------------------------------------------------------------------
  it("R8: lookupModelMetadata resolves provider-scoped hit", () => {
    const catalog: ModelsDevCatalog = {
      zai: {
        id: "zai",
        models: {
          "glm-4.7": {
            id: "glm-4.7",
            name: "GLM-4.7",
            limit: { context: 200000 },
            reasoning: true,
          },
        },
      },
    };
    const index = buildModelsDevIndex(catalog);
    const meta = lookupModelMetadata(index, { providerId: "zai", modelId: "glm-4.7" });
    expect(meta).not.toBeNull();
    expect(meta?.contextWindow).toBe(200000);
    expect(meta?.reasoning).toBe(true);
    expect(meta?.name).toBe("GLM-4.7");
  });

  // ---------------------------------------------------------------------
  // R9: global full-id fallback
  // ---------------------------------------------------------------------
  it("R9: lookupModelMetadata falls back to global full-id match", () => {
    const catalog: ModelsDevCatalog = {
      anthropic: {
        id: "anthropic",
        models: {
          "claude-sonnet-4-5": { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
        },
      },
    };
    const index = buildModelsDevIndex(catalog);
    const meta = lookupModelMetadata(index, {
      providerId: "unknown",
      modelId: "claude-sonnet-4-5",
    });
    expect(meta).not.toBeNull();
    expect(meta?.name).toBe("Claude Sonnet 4.5");
  });

  // ---------------------------------------------------------------------
  // R10: global last-segment fallback
  // ---------------------------------------------------------------------
  it("R10: lookupModelMetadata falls back to global last-segment match", () => {
    const catalog: ModelsDevCatalog = {
      google: {
        id: "google",
        models: {
          "gemini-2.5-pro": { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
        },
      },
    };
    const index = buildModelsDevIndex(catalog);
    const meta = lookupModelMetadata(index, {
      providerId: "unknown",
      modelId: "google/gemini-2.5-pro",
    });
    expect(meta).not.toBeNull();
    expect(meta?.name).toBe("Gemini 2.5 Pro");
  });

  // ---------------------------------------------------------------------
  // R11: miss -> null
  // ---------------------------------------------------------------------
  it("R11: lookupModelMetadata returns null on total miss", () => {
    const catalog: ModelsDevCatalog = {
      zai: { id: "zai", models: { "glm-4.7": { id: "glm-4.7" } } },
    };
    const index = buildModelsDevIndex(catalog);
    const meta = lookupModelMetadata(index, {
      providerId: "unknown",
      modelId: "does-not-exist",
    });
    expect(meta).toBeNull();
  });

  // ---------------------------------------------------------------------
  // R12: metadata mapping
  // ---------------------------------------------------------------------
  it("R12: modelsDevModelToMetadata maps modalities (text+image+pdf) and attachment flag", () => {
    const modelWithModalities: ModelsDevModel = {
      id: "x",
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      limit: { context: 128000 },
    };
    const meta = modelsDevModelToMetadata(modelWithModalities);
    expect(meta.input).toEqual(["text", "image", "document"]);
    expect(meta.contextWindow).toBe(128000);

    const attachmentOnly: ModelsDevModel = {
      id: "y",
      attachment: true,
      // modalities absent
    };
    const meta2 = modelsDevModelToMetadata(attachmentOnly);
    expect(meta2.input).toContain("image");
    expect(meta2.input).toContain("text");
  });
});
