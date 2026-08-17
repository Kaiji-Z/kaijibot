import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { KaijiBotConfig } from "kaijibot/plugin-sdk/memory-core-host-engine-foundation";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryIndexManager } from "./manager.js";
import "./test-runtime-mocks.js";

vi.mock("./embeddings.js", () => ({
  createEmbeddingProvider: async () => ({
    requestedProvider: "auto",
    provider: null,
    providerUnavailableReason: "No embeddings provider available.",
  }),
  resolveEmbeddingProviderFallbackModel: () => "fts-only",
}));

const logWarnMock = vi.fn();

vi.mock("kaijibot/plugin-sdk/memory-core-host-engine-foundation", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("kaijibot/plugin-sdk/memory-core-host-engine-foundation")>();
  return {
    ...actual,
    createSubsystemLogger: () => {
      const logger = {
        warn: logWarnMock,
        debug: vi.fn(),
        info: vi.fn(),
        child: () => logger,
      };
      return logger;
    },
  };
});

const META_KEY = "memory_index_meta_v1";

type MemoryIndexModule = typeof import("./index.js");

describe("memory manager meta persistence", () => {
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
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-mem-meta-"));
  });

  beforeEach(async () => {
    logWarnMock.mockClear();
    workspaceDir = path.join(fixtureRoot, `case-${caseId++}`);
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "Root note about alpha.");
    await fs.writeFile(path.join(workspaceDir, "memory", "one.md"), "One topic details.");
    await fs.writeFile(path.join(workspaceDir, "memory", "two.md"), "Two topic details.");
    await fs.writeFile(path.join(workspaceDir, "memory", "three.md"), "Three topic details.");
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
      memory: {
        backend: "builtin",
      },
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

  function readMetaRow(): { value: string } | undefined {
    const db = new DatabaseSync(indexPath);
    try {
      return db.prepare(`SELECT value FROM meta WHERE key = ?`).get(META_KEY) as
        | { value: string }
        | undefined;
    } finally {
      db.close();
    }
  }

  function snapshotChunkTimestamps(): Array<[string, number]> {
    const db = new DatabaseSync(indexPath);
    try {
      const rows = db.prepare(`SELECT id, updated_at FROM chunks ORDER BY id`).all() as Array<{
        id: string;
        updated_at: number;
      }>;
      return rows.map((row) => [row.id, row.updated_at]);
    } finally {
      db.close();
    }
  }

  function countVectorDegradationWarnings(): number {
    return logWarnMock.mock.calls.filter(([message]) =>
      String(message).includes("without vector embeddings"),
    ).length;
  }

  it("persists index meta across repeated forced reindexes", async () => {
    const memoryManager = await createManager();

    await memoryManager.sync({ force: true });
    const firstMeta = readMetaRow();
    expect(firstMeta).toBeDefined();
    expect(JSON.parse(firstMeta!.value)).toMatchObject({ model: "fts-only", provider: "none" });

    await memoryManager.sync({ force: true });
    const secondMeta = readMetaRow();
    expect(secondMeta).toBeDefined();
    expect(JSON.parse(secondMeta!.value)).toMatchObject({ model: "fts-only", provider: "none" });
  });

  it("does not cascade into a full reindex after a repeated forced reindex", async () => {
    const memoryManager = await createManager();

    await memoryManager.sync({ force: true });
    await memoryManager.sync({ force: true });
    const before = snapshotChunkTimestamps();
    expect(before.length).toBeGreaterThan(0);

    await memoryManager.sync();
    const after = snapshotChunkTimestamps();
    expect(after).toEqual(before);
  });

  it("warns about missing vector embeddings once per failure reason, not per file", async () => {
    const memoryManager = await createManager();

    await memoryManager.sync({ force: true });

    const status = memoryManager.status();
    expect(status.chunks).toBeGreaterThan(0);
    expect(countVectorDegradationWarnings()).toBe(1);
  });
});
