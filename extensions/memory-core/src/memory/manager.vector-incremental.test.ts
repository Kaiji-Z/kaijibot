import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { KaijiBotConfig } from "kaijibot/plugin-sdk/memory-core-host-engine-foundation";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryIndexManager } from "./manager.js";

// No test-runtime-mocks import here: the real sqlite-vec extension must load so
// vector.available is true while the FTS-only database has no chunks_vec table.
vi.mock("./embeddings.js", () => ({
  createEmbeddingProvider: async () => ({
    requestedProvider: "auto",
    provider: null,
    providerUnavailableReason: "No embeddings provider available.",
  }),
  resolveEmbeddingProviderFallbackModel: () => "fts-only",
}));

type MemoryIndexModule = typeof import("./index.js");

describe("memory manager incremental sync with loadable sqlite-vec and no provider", () => {
  let fixtureRoot = "";
  let caseId = 0;
  let workspaceDir = "";
  let indexPath = "";
  let manager: MemoryIndexManager | null = null;
  let getMemorySearchManager: MemoryIndexModule["getMemorySearchManager"];
  let closeAllMemorySearchManagers: MemoryIndexModule["closeAllMemorySearchManagers"];

  beforeAll(async () => {
    vi.resetModules();
    ({ getMemorySearchManager, closeAllMemorySearchManagers } = await import("./index.js"));
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-mem-vec-incr-"));
  });

  beforeEach(async () => {
    workspaceDir = path.join(fixtureRoot, `case-${caseId++}`);
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "Root note about alpha.");
    await fs.writeFile(path.join(workspaceDir, "memory", "one.md"), "One topic details.");
    indexPath = path.join(workspaceDir, "index.sqlite");
  });

  afterEach(async () => {
    if (manager) {
      await manager.close();
      manager = null;
    }
    await closeAllMemorySearchManagers();
  });

  afterAll(async () => {
    if (!fixtureRoot) {
      vi.resetModules();
      return;
    }
    await fs.rm(fixtureRoot, { recursive: true, force: true });
    vi.resetModules();
  });

  async function createManager(): Promise<MemoryIndexManager> {
    const cfg = {
      memory: { backend: "builtin" },
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "auto",
            model: "",
            store: { path: indexPath },
            cache: { enabled: false },
            sync: { watch: false, onSessionStart: false, onSearch: false },
          },
        },
        list: [{ id: "main", default: true }],
      },
    } as KaijiBotConfig;
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    if (!result.manager) {
      throw new Error(result.error ?? "manager missing");
    }
    manager = result.manager as unknown as MemoryIndexManager;
    return manager;
  }

  function vectorTableExists(): boolean {
    const db = new DatabaseSync(indexPath);
    try {
      return (
        db
          .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chunks_vec'`)
          .get() !== undefined
      );
    } finally {
      db.close();
    }
  }

  it("survives incremental sync after a forced FTS-only reindex dropped chunks_vec", async () => {
    const first = await createManager();
    await first.sync({ force: true });
    expect(first.status().chunks).toBeGreaterThan(0);
    expect(vectorTableExists()).toBe(false);
    await first.close();
    manager = null;
    await closeAllMemorySearchManagers();

    // A fresh process starts with dirty=true (resolveInitialMemoryDirty), so an
    // incremental sync actually reaches syncMemoryFiles — mirroring the CLI.
    const second = await createManager();
    await expect(second.sync()).resolves.toBeUndefined();

    const results = await second.search("alpha");
    expect(results.length).toBeGreaterThan(0);
  });
});
