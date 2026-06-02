import { describe, it, expect } from "vitest";
import { TopicRegistry, type TopicRegistryDeps, type TopicMeta } from "./topic-registry.js";

// ---------------------------------------------------------------------------
// In-memory fs mock (same pattern as topic-manager.test.ts)
// ---------------------------------------------------------------------------

function createMemoryFs() {
  const files = new Map<string, string>();

  const deps: TopicRegistryDeps["fs"] & { unlink: (filePath: string) => Promise<void> } = {
    readFile: async (filePath: string) => {
      const content = files.get(filePath);
      if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
      return content;
    },
    writeFile: async (filePath: string, data: string) => {
      files.set(filePath, data);
    },
    mkdir: async () => {
      // no-op for in-memory fs
    },
    readdir: async (dirPath: string) => {
      const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const slashIdx = rest.indexOf("/");
          names.add(slashIdx >= 0 ? rest.slice(0, slashIdx) : rest);
        }
      }
      return [...names];
    },
    stat: async (filePath: string) => {
      const content = files.get(filePath);
      if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
      return { mtimeMs: Date.now(), size: content.length };
    },
    rename: async (oldPath: string, newPath: string) => {
      const content = files.get(oldPath);
      if (content === undefined) throw new Error(`ENOENT: ${oldPath}`);
      files.delete(oldPath);
      files.set(newPath, content);
    },
    unlink: async (filePath: string) => {
      files.delete(filePath);
    },
  };

  return { files, deps };
}

function createRegistry(workspaceDir = "/test-workspace") {
  const memFs = createMemoryFs();
  const registry = new TopicRegistry({ workspaceDir, fs: memFs.deps });
  return { registry, files: memFs.files };
}

function makeMeta(overrides: Partial<TopicMeta> & { name: string }): TopicMeta {
  return {
    description: "Test topic",
    entryCount: 0,
    lastUpdated: "2026-06-01",
    createdAt: "2026-05-20",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TopicRegistry", () => {
  it("creates registry file on first upsert", async () => {
    const { registry, files } = createRegistry();
    await registry.upsertTopic(makeMeta({ name: "philosophy" }));

    const registryPath = "/test-workspace/memory/topics/registry.json";
    expect(files.has(registryPath) || [...files.keys()].some((k) => k.includes("registry.json"))).toBe(true);

    // Verify JSON content
    const raw = await registry.getTopic("philosophy");
    expect(raw).not.toBeNull();
    expect(raw!.name).toBe("philosophy");
  });

  it("upsert creates new entry", async () => {
    const { registry } = createRegistry();
    await registry.upsertTopic(makeMeta({ name: "rust-lang", description: "Rust programming language topics" }));

    const list = await registry.listTopics();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("rust-lang");
    expect(list[0]!.description).toBe("Rust programming language topics");
  });

  it("upsert updates existing entry", async () => {
    const { registry } = createRegistry();
    await registry.upsertTopic(makeMeta({ name: "ai", description: "Old description" }));
    await registry.upsertTopic(makeMeta({ name: "ai", description: "Updated description" }));

    const topic = await registry.getTopic("ai");
    expect(topic).not.toBeNull();
    expect(topic!.description).toBe("Updated description");
  });

  it("removeTopic removes entry", async () => {
    const { registry } = createRegistry();
    await registry.upsertTopic(makeMeta({ name: "temp" }));
    await registry.removeTopic("temp");

    const topic = await registry.getTopic("temp");
    expect(topic).toBeNull();
  });

  it("getTopic returns null for missing topic", async () => {
    const { registry } = createRegistry();
    const topic = await registry.getTopic("nonexistent");
    expect(topic).toBeNull();
  });

  it("listTopics returns sorted by name", async () => {
    const { registry } = createRegistry();
    await registry.upsertTopic(makeMeta({ name: "zen" }));
    await registry.upsertTopic(makeMeta({ name: "alpha" }));
    await registry.upsertTopic(makeMeta({ name: "middle" }));

    const list = await registry.listTopics();
    expect(list.map((t) => t.name)).toEqual(["alpha", "middle", "zen"]);
  });

  it("refreshStats updates counts", async () => {
    const { registry } = createRegistry();
    await registry.upsertTopic(makeMeta({ name: "coding", entryCount: 3, lastUpdated: "2026-05-20" }));
    await registry.refreshStats("coding", 5, "2026-06-01");

    const topic = await registry.getTopic("coding");
    expect(topic!.entryCount).toBe(5);
    expect(topic!.lastUpdated).toBe("2026-06-01");
  });

  it("syncFromDisk populates from topic files", async () => {
    const { registry, files } = createRegistry();
    const topicsDir = "/test-workspace/memory/topics";

    // Create topic files on mock fs
    files.set(`${topicsDir}/philosophy.md`, [
      "---",
      "subject: philosophy",
      "created: 2026-05-20",
      "updated: 2026-06-01",
      "entries: 5",
      "---",
      "",
      "## Some entry (2026-05-20)",
      "content here",
    ].join("\n"));

    files.set(`${topicsDir}/rust.md`, [
      "---",
      "subject: rust",
      "created: 2026-04-10",
      "updated: 2026-05-30",
      "entries: 3",
      "---",
      "",
      "## Rust entry (2026-04-10)",
      "rust content",
    ].join("\n"));

    const added = await registry.syncFromDisk();
    expect(added).toBe(2);

    const list = await registry.listTopics();
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.name)).toEqual(["philosophy", "rust"]);

    const phil = await registry.getTopic("philosophy");
    expect(phil!.entryCount).toBe(5);
    expect(phil!.createdAt).toBe("2026-05-20");
    expect(phil!.lastUpdated).toBe("2026-06-01");
  });

  it("syncFromDisk doesn't overwrite existing entries", async () => {
    const { registry, files } = createRegistry();
    const topicsDir = "/test-workspace/memory/topics";

    // Pre-populate registry with an entry
    await registry.upsertTopic(makeMeta({
      name: "philosophy",
      description: "Existing description",
      entryCount: 10,
    }));

    // Create topic file on disk with different data
    files.set(`${topicsDir}/philosophy.md`, [
      "---",
      "subject: philosophy",
      "created: 2026-01-01",
      "updated: 2026-01-02",
      "entries: 1",
      "---",
      "",
    ].join("\n"));

    const added = await registry.syncFromDisk();
    expect(added).toBe(0);

    // Original entry preserved
    const topic = await registry.getTopic("philosophy");
    expect(topic!.description).toBe("Existing description");
    expect(topic!.entryCount).toBe(10);
  });

  it("empty registry returns empty list", async () => {
    const { registry } = createRegistry();
    const list = await registry.listTopics();
    expect(list).toEqual([]);
  });

  it("getDescriptionList for LLM prompts", async () => {
    const { registry } = createRegistry();
    await registry.upsertTopic(makeMeta({ name: "beta", description: "Beta desc" }));
    await registry.upsertTopic(makeMeta({ name: "alpha", description: "Alpha desc" }));

    const descList = await registry.getDescriptionList();
    expect(descList).toEqual([
      { name: "alpha", description: "Alpha desc" },
      { name: "beta", description: "Beta desc" },
    ]);
  });
});
