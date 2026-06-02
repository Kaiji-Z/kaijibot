import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { MemoryIndexManager, type MemoryIndexDeps } from "./memory-index.js";
import { TopicRegistry, type TopicRegistryDeps } from "./topic-registry.js";
import {
  runMemoryTidy,
  isTidyEnabled,
  type MemoryTidyDeps,
} from "./tools.memory-tidy.js";
import { TopicManager, type TopicManagerDeps } from "./topic-manager.js";

// ---------------------------------------------------------------------------
// In-memory FS
// ---------------------------------------------------------------------------

function createMemoryFs() {
  const files = new Map<string, string>();

  return {
    files,
    fs: {
      readFile: async (p: string) => {
        const c = files.get(p);
        if (c === undefined) { throw new Error(`ENOENT: ${p}`); }
        return c;
      },
      writeFile: async (p: string, data: string) => {
        files.set(p, data);
      },
      mkdir: async () => {},
      readdir: async (p: string) => {
        const prefix = p.endsWith("/") ? p : `${p}/`;
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
      stat: async (p: string) => {
        const c = files.get(p);
        if (c === undefined) { throw new Error(`ENOENT: ${p}`); }
        return { mtimeMs: Date.now(), size: c.length };
      },
      rename: async (oldPath: string, newPath: string) => {
        const c = files.get(oldPath);
        if (c === undefined) { throw new Error(`ENOENT: ${oldPath}`); }
        files.delete(oldPath);
        files.set(newPath, c);
      },
    } satisfies TopicManagerDeps["fs"] & MemoryIndexDeps["fs"] & TopicRegistryDeps["fs"],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WS = "/test-ws";
const TOPICS_DIR = join(WS, "memory", "topics");

function makeTopic(
  name: string,
  subject: string,
  entries: Array<{ title: string; date: string; content: string }>,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const entryMarkdown = entries
    .map((e) => `## ${e.title} (${e.date})\n\n${e.content}`)
    .join("\n\n");
  return `---\nsubject: ${subject}\ncreated: ${today}\nupdated: ${today}\nentries: ${entries.length}\n---\n\n${entryMarkdown}\n`;
}

function makeTopicWithDate(
  name: string,
  subject: string,
  updatedDate: string,
  entries: Array<{ title: string; date: string; content: string }>,
): string {
  const entryMarkdown = entries
    .map((e) => `## ${e.title} (${e.date})\n\n${e.content}`)
    .join("\n\n");
  return `---\nsubject: ${subject}\ncreated: ${updatedDate}\nupdated: ${updatedDate}\nentries: ${entries.length}\n---\n\n${entryMarkdown}\n`;
}

interface CreateTidyDepsOptions {
  generateText?: (prompt: string) => Promise<string>;
}

function createTidyDeps(opts?: CreateTidyDepsOptions): {
  tidyDeps: MemoryTidyDeps;
  memFs: ReturnType<typeof createMemoryFs>;
} {
  const memFs = createMemoryFs();
  const topicManager = new TopicManager({ workspaceDir: WS, fs: memFs.fs });
  const indexManager = new MemoryIndexManager({ workspaceDir: WS, fs: memFs.fs });
  const registry = new TopicRegistry({ workspaceDir: WS, fs: memFs.fs });
  return {
    tidyDeps: {
      topicManager,
      indexManager,
      registry,
      fs: memFs.fs,
      workspaceDir: WS,
      generateText: opts?.generateText,
    },
    memFs,
  };
}

function writeMemoryMd(memFs: ReturnType<typeof createMemoryFs>, content: string) {
  memFs.files.set(join(WS, "MEMORY.md"), content);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("memory_tidy (unified)", () => {
  // =========================================================================
  // LLM-driven flow
  // =========================================================================
  describe("LLM-driven flow", () => {
    it("LLM suggests merge_topics → executes correctly", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockResolvedValue(JSON.stringify([
        { op: "merge_topics", from: "topic-a", into: "topic-b", reason: "same domain" },
      ]));

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });

      const contentA = makeTopic("topic-a", "user", [
        { title: "Entry A1", date: "2025-01-01", content: "Some content about feishu API calls" },
      ]);
      const contentB = makeTopic("topic-b", "user", [
        { title: "Entry B1", date: "2025-01-02", content: "Some content about feishu configuration" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "topic-a.md"), contentA);
      memFs.files.set(join(TOPICS_DIR, "topic-b.md"), contentB);
      writeMemoryMd(memFs, "# Long-Term Memory Index\n\n## Topic Pointers\n- topic-a → memory/topics/topic-a.md\n- topic-b → memory/topics/topic-b.md\n\n");

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.action).toBe("full");
      expect(result.llmUsed).toBe(true);
      expect(result.filesAffected).toBeGreaterThan(0);
      expect(result.changes.some((c) => c.includes("merge") || c.includes("merged"))).toBe(true);
      expect(mockLLM).toHaveBeenCalledTimes(1);
    });

    it("LLM suggests rename_topic → executes correctly", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockResolvedValue(JSON.stringify([
        { op: "rename_topic", from: "old-name", to: "new-name", reason: "better description" },
      ]));

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });

      const content = makeTopic("old-name", "user", [
        { title: "Entry 1", date: "2025-01-01", content: "Some content" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "old-name.md"), content);
      writeMemoryMd(memFs, "# Long-Term Memory Index\n\n## Topic Pointers\n- old-name → memory/topics/old-name.md\n\n");

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.llmUsed).toBe(true);
      expect(result.filesAffected).toBeGreaterThan(0);
      expect(result.changes.some((c) => c.includes("rename") || c.includes("renamed"))).toBe(true);
    });

    it("LLM suggests dedup_entries → executes correctly", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockResolvedValue(JSON.stringify([
        { op: "dedup_entries", topic: "cooking", keepIndex: 0, absorbIndices: [1], reason: "duplicate recipes" },
      ]));

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });

      const content = makeTopic("cooking", "user", [
        { title: "Recipe A", date: "2025-01-01", content: "How to make pasta carbonara" },
        { title: "Recipe B", date: "2025-01-02", content: "How to make pasta carbonara at home" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "cooking.md"), content);

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.llmUsed).toBe(true);
      expect(result.filesAffected).toBeGreaterThan(0);
      expect(result.entriesAffected).toBeGreaterThan(0);
    });

    it("LLM suggests archive_topic → executes correctly", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockResolvedValue(JSON.stringify([
        { op: "archive_topic", topic: "old-stuff", reason: "no longer relevant" },
      ]));

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });

      const content = makeTopic("old-stuff", "reference", [
        { title: "Old entry", date: "2025-01-01", content: "Old content" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "old-stuff.md"), content);
      writeMemoryMd(memFs, "# Long-Term Memory Index\n\n## Topic Pointers\n- old-stuff → memory/topics/old-stuff.md\n\n");

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.llmUsed).toBe(true);
      expect(result.filesAffected).toBeGreaterThan(0);
      expect(result.changes.some((c) => c.includes("archive"))).toBe(true);
    });

    it("LLM suggests clean_inline → executes correctly", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockResolvedValue(JSON.stringify([
        { op: "clean_inline", section: "⚡ Core Memory", removeLineIndices: [1], reason: "duplicate line" },
      ]));

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });

      writeMemoryMd(
        memFs,
        [
          "# Long-Term Memory",
          "",
          "## ⚡ Core Memory",
          "",
          "- 2026-05-25: User prefers TypeScript for all projects",
          "- 2026-05-25: User prefers TypeScript for all backend projects",
          "",
        ].join("\n"),
      );

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.llmUsed).toBe(true);
      expect(result.entriesAffected).toBeGreaterThan(0);
      expect(result.changes.some((c) => c.includes("clean_inline") || c.includes("inline"))).toBe(true);
    });

    it("LLM returns invalid JSON → graceful empty result", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockResolvedValue("This is not JSON at all!!!");

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });
      writeMemoryMd(memFs, "# Long-Term Memory Index\n\n");

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.llmUsed).toBe(true);
      // Should not crash; operations should be 0
      expect(result.entriesAffected).toBe(0);
    });

    it("LLM returns invalid operation (non-existent topic) → validation rejects", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockResolvedValue(JSON.stringify([
        { op: "merge_topics", from: "nonexistent-a", into: "nonexistent-b", reason: "will fail" },
      ]));

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });
      writeMemoryMd(memFs, "# Long-Term Memory Index\n\n");

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.llmUsed).toBe(true);
      expect(result.filesAffected).toBe(0);
    });

    it("Multiple operations in one call → all executed in correct order", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockResolvedValue(JSON.stringify([
        { op: "dedup_entries", topic: "multi", keepIndex: 0, absorbIndices: [1], reason: "dup" },
        { op: "archive_topic", topic: "to-archive", reason: "old" },
      ]));

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });

      const multiContent = makeTopic("multi", "user", [
        { title: "A", date: "2025-01-01", content: "Duplicate content for multi op test" },
        { title: "B", date: "2025-01-02", content: "Duplicate content for multi op test" },
      ]);
      const archiveContent = makeTopic("to-archive", "reference", [
        { title: "Old", date: "2025-01-01", content: "Old stuff" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "multi.md"), multiContent);
      memFs.files.set(join(TOPICS_DIR, "to-archive.md"), archiveContent);
      writeMemoryMd(memFs, "# Long-Term Memory Index\n\n## Topic Pointers\n- multi → memory/topics/multi.md\n- to-archive → memory/topics/to-archive.md\n\n");

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.llmUsed).toBe(true);
      expect(result.filesAffected).toBeGreaterThanOrEqual(2);
      expect(result.entriesAffected).toBeGreaterThan(0);
    });

    it("dryRun=true → no files modified, changes reported", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockResolvedValue(JSON.stringify([
        { op: "archive_topic", topic: "dry-topic", reason: "testing dry run" },
      ]));

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });

      const content = makeTopic("dry-topic", "reference", [
        { title: "Entry", date: "2025-01-01", content: "Test content" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "dry-topic.md"), content);
      writeMemoryMd(memFs, "# Long-Term Memory Index\n\n## Topic Pointers\n- dry-topic → memory/topics/dry-topic.md\n\n");

      const before = memFs.files.get(join(TOPICS_DIR, "dry-topic.md"));
      const result = await runMemoryTidy(tidyDeps, { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.changes.length).toBeGreaterThan(0);

      const after = memFs.files.get(join(TOPICS_DIR, "dry-topic.md"));
      expect(after).toBe(before);
    });

    it("focus parameter → only specified topic analyzed", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockResolvedValue(JSON.stringify([
        { op: "dedup_entries", topic: "focus-me", keepIndex: 0, absorbIndices: [1], reason: "dup" },
      ]));

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });

      const focusContent = makeTopic("focus-me", "user", [
        { title: "A", date: "2025-01-01", content: "Duplicate content for focus test" },
        { title: "B", date: "2025-01-02", content: "Duplicate content for focus test" },
      ]);
      const otherContent = makeTopic("other", "user", [
        { title: "X", date: "2025-01-01", content: "Different content entirely" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "focus-me.md"), focusContent);
      memFs.files.set(join(TOPICS_DIR, "other.md"), otherContent);

      const result = await runMemoryTidy(tidyDeps, { focus: "focus-me" });

      // The prompt should mention focus-me but NOT the "other" topic
      const promptArg = mockLLM.mock.calls[0]![0] as string;
      expect(promptArg).toContain("focus-me");
      // "other" as a topic heading — check for the topic header pattern, not substring
      // (the word "other" appears in prose like "absorbs the others")
      expect(promptArg).not.toContain('### "other"');
    });

    it("registry.syncFromDisk called at end", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockResolvedValue("[]");

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });
      writeMemoryMd(memFs, "# Long-Term Memory Index\n\n");

      const syncSpy = vi.spyOn(tidyDeps.registry, "syncFromDisk");

      await runMemoryTidy(tidyDeps, {});

      expect(syncSpy).toHaveBeenCalled();
      syncSpy.mockRestore();
    });
  });

  // =========================================================================
  // Jaccard fallback (no LLM)
  // =========================================================================
  describe("Jaccard fallback (no LLM)", () => {
    it("Entry dedup: similar entries merged via Union-Find", async () => {
      const { tidyDeps, memFs } = createTidyDeps(); // no generateText

      const content = makeTopic("dedup-test", "user", [
        { title: "Likes Python", date: "2025-01-01", content: "User prefers Python programming language for data analysis" },
        { title: "Likes Python v2", date: "2025-01-02", content: "User prefers Python programming language for data analysis tasks" },
        { title: "Likes Rust", date: "2025-01-03", content: "User also enjoys Rust for systems programming" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "dedup-test.md"), content);

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.llmUsed).toBe(false);
      expect(result.filesAffected).toBeGreaterThan(0);
      expect(result.entriesAffected).toBeGreaterThan(0);
      expect(result.changes.some((c) => c.includes("dedup") || c.includes("merged"))).toBe(true);
    });

    it("Inline dedup: duplicate lines removed from sections", async () => {
      const { tidyDeps, memFs } = createTidyDeps(); // no generateText

      writeMemoryMd(
        memFs,
        [
          "# Long-Term Memory",
          "",
          "## ⚡ Core Memory",
          "",
          "- 2026-05-25: User prefers TypeScript for all projects",
          "- 2026-05-25: User prefers TypeScript for all backend projects",
          "",
        ].join("\n"),
      );

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.llmUsed).toBe(false);
      expect(result.entriesAffected).toBeGreaterThan(0);
      expect(result.changes.some((c) => c.includes("dedup") && c.includes("⚡ Core Memory"))).toBe(true);
    });

    it("Archive: topics >90 days old archived", async () => {
      const { tidyDeps, memFs } = createTidyDeps(); // no generateText

      const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const oldContent = makeTopicWithDate("stale", "reference", oldDate, [
        { title: "Old Entry", date: oldDate, content: "Stale content" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "stale.md"), oldContent);
      writeMemoryMd(memFs, "# Long-Term Memory Index\n\n## Stale\n→ memory/topics/stale.md\n\n");

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.llmUsed).toBe(false);
      expect(result.filesAffected).toBeGreaterThan(0);
      expect(result.changes.some((c) => c.includes("archive"))).toBe(true);

      const archivedPath = join(TOPICS_DIR, "archive", "stale.md");
      expect(memFs.files.has(archivedPath)).toBe(true);
      expect(memFs.files.has(join(TOPICS_DIR, "stale.md"))).toBe(false);
    });

    it("Rebalance: MEMORY.md truncated to 8KB", async () => {
      const { tidyDeps, memFs } = createTidyDeps(); // no generateText

      const inlineLine = `- 2026-05-25: ${"User likes ".repeat(100)}programming`;
      const coreLines = Array.from({ length: 80 }, () => inlineLine).join("\n");
      writeMemoryMd(
        memFs,
        [
          "# Long-Term Memory",
          "",
          "## ⚡ Core Memory",
          "",
          coreLines,
          "",
          "## 🔥 Active Context",
          "",
          `- 2026-05-25: ${"Active context line ".repeat(100)}`,
          "",
        ].join("\n"),
      );

      const beforeBytes = new TextEncoder().encode(memFs.files.get(join(WS, "MEMORY.md")) ?? "").length;
      expect(beforeBytes).toBeGreaterThan(8192);

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.llmUsed).toBe(false);
      expect(result.action).toBe("full");
      const after = memFs.files.get(join(WS, "MEMORY.md")) ?? "";
      const afterBytes = new TextEncoder().encode(after).length;
      expect(afterBytes).toBeLessThanOrEqual(8192);
    });

    it("dryRun=true → no files modified", async () => {
      const { tidyDeps, memFs } = createTidyDeps(); // no generateText

      const dupContent = makeTopic("dry-jaccard", "user", [
        { title: "A", date: "2025-01-01", content: "Duplicate content for testing dry run" },
        { title: "B", date: "2025-01-02", content: "Duplicate content for testing dry run" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "dry-jaccard.md"), dupContent);
      writeMemoryMd(memFs, "# Long-Term Memory Index\n\n## Test\n→ memory/topics/dry-jaccard.md\n\n");

      const before = memFs.files.get(join(TOPICS_DIR, "dry-jaccard.md"));
      const result = await runMemoryTidy(tidyDeps, { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.changes.length).toBeGreaterThan(0);

      const after = memFs.files.get(join(TOPICS_DIR, "dry-jaccard.md"));
      expect(after).toBe(before);
    });

    it("registry.syncFromDisk called at end in fallback", async () => {
      const { tidyDeps, memFs } = createTidyDeps(); // no generateText
      writeMemoryMd(memFs, "# Long-Term Memory Index\n\n");

      const syncSpy = vi.spyOn(tidyDeps.registry, "syncFromDisk");

      await runMemoryTidy(tidyDeps, {});

      expect(syncSpy).toHaveBeenCalled();
      syncSpy.mockRestore();
    });
  });

  // =========================================================================
  // isTidyEnabled
  // =========================================================================
  describe("isTidyEnabled", () => {
    it("returns true when pluginConfig is undefined", () => {
      expect(isTidyEnabled(undefined)).toBe(true);
    });

    it("returns true when tidy config is not set", () => {
      expect(isTidyEnabled({})).toBe(true);
    });

    it("returns false when autoAfterConsolidation is explicitly false", () => {
      expect(isTidyEnabled({ tidy: { autoAfterConsolidation: false } })).toBe(false);
    });

    it("returns true when autoAfterConsolidation is true", () => {
      expect(isTidyEnabled({ tidy: { autoAfterConsolidation: true } })).toBe(true);
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe("edge cases", () => {
    it("Empty topic list returns empty result", async () => {
      const { tidyDeps, memFs } = createTidyDeps();
      writeMemoryMd(memFs, "# Long-Term Memory Index\n\n");

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.action).toBe("full");
      expect(result.entriesAffected).toBe(0);
      expect(result.filesAffected).toBe(0);
    });

    it("MEMORY.md not found returns empty result", async () => {
      const { tidyDeps } = createTidyDeps();
      // No MEMORY.md written

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.action).toBe("full");
    });

    it("No inline sections works without error", async () => {
      const { tidyDeps, memFs } = createTidyDeps();
      writeMemoryMd(
        memFs,
        [
          "# Long-Term Memory",
          "",
          "## Topic Pointers",
          "- Test → memory/topics/test.md",
          "",
        ].join("\n"),
      );

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.action).toBe("full");
    });

    it("LLM returns empty array → no operations performed", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockResolvedValue("[]");

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });
      writeMemoryMd(memFs, "# Long-Term Memory Index\n\n");

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.llmUsed).toBe(true);
      expect(result.filesAffected).toBe(0);
      expect(result.entriesAffected).toBe(0);
    });

    it("LLM returns markdown-fenced JSON → parsed correctly", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockResolvedValue("```json\n[]\n```");

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });
      writeMemoryMd(memFs, "# Long-Term Memory Index\n\n");

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.llmUsed).toBe(true);
      // Should parse the fenced JSON gracefully
      expect(result.filesAffected).toBe(0);
    });

    it("clean_inline with out-of-range indices → rejected", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockResolvedValue(JSON.stringify([
        { op: "clean_inline", section: "⚡ Core Memory", removeLineIndices: [99], reason: "invalid" },
      ]));

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });

      writeMemoryMd(
        memFs,
        [
          "# Long-Term Memory",
          "",
          "## ⚡ Core Memory",
          "",
          "- 2026-05-25: User prefers TypeScript",
          "",
        ].join("\n"),
      );

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.llmUsed).toBe(true);
      // Operation should be rejected (index 99 is out of range)
      expect(result.entriesAffected).toBe(0);
    });

    it("rename_topic with invalid name → rejected", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockResolvedValue(JSON.stringify([
        { op: "rename_topic", from: "my-topic", to: "INVALID NAME!", reason: "bad name" },
      ]));

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });

      const content = makeTopic("my-topic", "user", [
        { title: "E", date: "2025-01-01", content: "Content" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "my-topic.md"), content);

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.llmUsed).toBe(true);
      expect(result.filesAffected).toBe(0);
    });

    it("dedup_entries with out-of-range indices → rejected", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockResolvedValue(JSON.stringify([
        { op: "dedup_entries", topic: "t", keepIndex: 5, absorbIndices: [10], reason: "out of range" },
      ]));

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });

      const content = makeTopic("t", "user", [
        { title: "E", date: "2025-01-01", content: "Content" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "t.md"), content);

      const result = await runMemoryTidy(tidyDeps, {});

      expect(result.llmUsed).toBe(true);
      expect(result.entriesAffected).toBe(0);
    });

    it("LLM error → falls back to Jaccard", async () => {
      const mockLLM = vi.fn<(prompt: string) => Promise<string>>();
      mockLLM.mockRejectedValue(new Error("LLM unavailable"));

      const { tidyDeps, memFs } = createTidyDeps({ generateText: mockLLM });

      const content = makeTopic("fallback-test", "user", [
        { title: "A", date: "2025-01-01", content: "Duplicate content for fallback test" },
        { title: "B", date: "2025-01-02", content: "Duplicate content for fallback test" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "fallback-test.md"), content);

      const result = await runMemoryTidy(tidyDeps, {});

      // Should fall back to Jaccard and still dedup
      expect(result.llmUsed).toBe(false);
      expect(result.entriesAffected).toBeGreaterThan(0);
    });
  });
});
