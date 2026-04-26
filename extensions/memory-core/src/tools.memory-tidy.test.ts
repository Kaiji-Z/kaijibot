import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { TopicManager, type TopicManagerDeps } from "./topic-manager.js";
import { MemoryIndexManager, type MemoryIndexDeps } from "./memory-index.js";
import { type TopicEntry, parseTopicFile, serializeTopicFile } from "./topic-types.js";
import {
  runMemoryTidyActions,
  isTidyEnabled,
  type MemoryTidyDeps,
  type TidyResult,
} from "./tools.memory-tidy.js";

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
        if (c === undefined) throw new Error(`ENOENT: ${p}`);
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
        if (c === undefined) throw new Error(`ENOENT: ${p}`);
        return { mtimeMs: Date.now(), size: c.length };
      },
      rename: async (oldPath: string, newPath: string) => {
        const c = files.get(oldPath);
        if (c === undefined) throw new Error(`ENOENT: ${oldPath}`);
        files.delete(oldPath);
        files.set(newPath, c);
      },
    } satisfies TopicManagerDeps["fs"] & MemoryIndexDeps["fs"],
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
    .map(
      (e) =>
        `## ${e.title} (${e.date})\n\n${e.content}`,
    )
    .join("\n\n");
  return `---\nsubject: ${subject}\ncreated: ${today}\nupdated: ${today}\nentries: ${entries.length}\n---\n\n${entryMarkdown}\n`;
}

function createTidyDeps(): {
  tidyDeps: MemoryTidyDeps;
  memFs: ReturnType<typeof createMemoryFs>;
} {
  const memFs = createMemoryFs();
  const topicManager = new TopicManager({ workspaceDir: WS, fs: memFs.fs });
  const indexManager = new MemoryIndexManager({ workspaceDir: WS, fs: memFs.fs });
  return {
    tidyDeps: {
      topicManager,
      indexManager,
      fs: memFs.fs,
      workspaceDir: WS,
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

describe("memory_tidy", () => {
  describe("dedup", () => {
    it("merges two entries with similarity ≥ 0.85", async () => {
      const { tidyDeps, memFs } = createTidyDeps();

      const content = makeTopic("dedup-test", "user", [
        { title: "Likes Python", date: "2025-01-01", content: "User prefers Python programming language for data analysis" },
        { title: "Likes Python v2", date: "2025-01-02", content: "User prefers Python programming language for data analysis tasks" },
        { title: "Likes Rust", date: "2025-01-03", content: "User also enjoys Rust for systems programming" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "dedup-test.md"), content);

      const result = await runMemoryTidyActions(tidyDeps, { action: "dedup" });

      expect(result.filesAffected).toBe(1);
      expect(result.entriesAffected).toBe(1);
      expect(result.changes.length).toBeGreaterThan(0);
      expect(result.changes[0]).toContain("merged");
    });

    it("returns no changes when all entries are unique", async () => {
      const { tidyDeps, memFs } = createTidyDeps();

      const content = makeTopic("unique", "reference", [
        { title: "Database choice", date: "2025-01-01", content: "Decided on PostgreSQL for the main database" },
        { title: "Auth strategy", date: "2025-01-02", content: "Using JWT tokens with refresh rotation" },
        { title: "CI pipeline", date: "2025-01-03", content: "GitHub Actions with matrix testing across Node 20, 22" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "unique.md"), content);

      const result = await runMemoryTidyActions(tidyDeps, { action: "dedup" });

      expect(result.filesAffected).toBe(0);
      expect(result.entriesAffected).toBe(0);
      expect(result.changes).toHaveLength(0);
    });

    it("respects target parameter to only process one file", async () => {
      const { tidyDeps, memFs } = createTidyDeps();

      const dupContent = makeTopic("target-file", "user", [
        { title: "A", date: "2025-01-01", content: "Some duplicate text about programming" },
        { title: "B", date: "2025-01-02", content: "Some duplicate text about programming" },
      ]);
      const otherContent = makeTopic("other-file", "reference", [
        { title: "X", date: "2025-01-01", content: "Exact same text about programming" },
        { title: "Y", date: "2025-01-02", content: "Exact same text about programming" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "target-file.md"), dupContent);
      memFs.files.set(join(TOPICS_DIR, "other-file.md"), otherContent);

      const result = await runMemoryTidyActions(tidyDeps, {
        action: "dedup",
        target: "target-file",
      });

      expect(result.filesAffected).toBe(1);
      expect(result.changes[0]).toContain("target-file");
      expect(result.changes[0]).not.toContain("other-file");
    });
  });

  describe("merge", () => {
    it("merges two topic files with overlapping content", async () => {
      const { tidyDeps, memFs } = createTidyDeps();

      const sharedContent = "Kubernetes deployment with Helm charts and service mesh configuration";
      const fileA = makeTopic("k8s-alpha", "project", [
        { title: "K8s setup", date: "2025-01-01", content: sharedContent },
      ]);
      const fileB = makeTopic("k8s-beta", "project", [
        { title: "K8s config", date: "2025-01-02", content: sharedContent },
      ]);
      memFs.files.set(join(TOPICS_DIR, "k8s-alpha.md"), fileA);
      memFs.files.set(join(TOPICS_DIR, "k8s-beta.md"), fileB);

      writeMemoryMd(
        memFs,
        "# Long-Term Memory Index\n\n## K8s Alpha\n→ memory/topics/k8s-alpha.md\n\n## K8s Beta\n→ memory/topics/k8s-beta.md\n",
      );

      const result = await runMemoryTidyActions(tidyDeps, { action: "merge" });

      expect(result.filesAffected).toBe(2);
      expect(result.entriesAffected).toBe(1);
      expect(result.changes[0]).toContain("merged");
    });
  });

  describe("rebalance", () => {
    it("truncates index when exceeding 25KB", async () => {
      const { tidyDeps, memFs } = createTidyDeps();

      const largeSection = `## ${"x".repeat(2000)}\n→ memory/topics/big.md\n${"s".repeat(5000)}\n\n`;
      const sections = Array.from({ length: 10 }, (_, i) =>
        largeSection.replace("big.md", `big-${i}.md`),
      ).join("");
      writeMemoryMd(memFs, `# Long-Term Memory Index\n\n${sections}`);

      const result = await runMemoryTidyActions(tidyDeps, { action: "rebalance" });

      expect(result.entriesAffected).toBeGreaterThan(0);
      expect(result.changes.length).toBeGreaterThan(0);
    });

    it("reports within-budget when index is small", async () => {
      const { tidyDeps, memFs } = createTidyDeps();

      writeMemoryMd(
        memFs,
        "# Long-Term Memory Index\n\n## Profile\n→ memory/topics/user-profile.md\n\n",
      );

      const result = await runMemoryTidyActions(tidyDeps, { action: "rebalance" });

      expect(result.filesAffected).toBe(0);
      expect(result.entriesAffected).toBe(0);
      expect(result.changes[0]).toContain("within budget");
    });
  });

  describe("archive", () => {
    it("moves topic file older than 90 days to archive", async () => {
      const { tidyDeps, memFs } = createTidyDeps();

      const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const oldContent = `---\nsubject: reference\ncreated: ${oldDate}\nupdated: ${oldDate}\nentries: 1\n---\n\n## Old Entry (${oldDate})\n\nStale content\n`;
      memFs.files.set(join(TOPICS_DIR, "stale.md"), oldContent);

      writeMemoryMd(
        memFs,
        "# Long-Term Memory Index\n\n## Stale\n→ memory/topics/stale.md\n\n",
      );

      const result = await runMemoryTidyActions(tidyDeps, { action: "archive" });

      expect(result.filesAffected).toBe(1);
      expect(result.changes[0]).toContain("archived");

      const archivedPath = join(TOPICS_DIR, "archive", "stale.md");
      expect(memFs.files.has(archivedPath)).toBe(true);
      expect(memFs.files.has(join(TOPICS_DIR, "stale.md"))).toBe(false);
    });

    it("skips recently updated topic files", async () => {
      const { tidyDeps, memFs } = createTidyDeps();

      const today = new Date().toISOString().slice(0, 10);
      const content = makeTopic("fresh", "user", [
        { title: "Recent", date: today, content: "Fresh content" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "fresh.md"), content);

      const result = await runMemoryTidyActions(tidyDeps, { action: "archive" });

      expect(result.filesAffected).toBe(0);
      expect(result.changes).toHaveLength(0);
    });
  });

  describe("dryRun", () => {
    it("reports changes without modifying files", async () => {
      const { tidyDeps, memFs } = createTidyDeps();

      const dupContent = makeTopic("dry-run-test", "user", [
        { title: "A", date: "2025-01-01", content: "Duplicate content for testing dry run" },
        { title: "B", date: "2025-01-02", content: "Duplicate content for testing dry run" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "dry-run-test.md"), dupContent);
      writeMemoryMd(
        memFs,
        "# Long-Term Memory Index\n\n## Test\n→ memory/topics/dry-run-test.md\n\n",
      );

      const before = memFs.files.get(join(TOPICS_DIR, "dry-run-test.md"));

      const result = await runMemoryTidyActions(tidyDeps, {
        action: "full",
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.changes.length).toBeGreaterThan(0);

      const after = memFs.files.get(join(TOPICS_DIR, "dry-run-test.md"));
      expect(after).toBe(before);
    });
  });

  describe("full", () => {
    it("runs all 4 actions and returns combined report", async () => {
      const { tidyDeps, memFs } = createTidyDeps();

      const content = makeTopic("full-test", "user", [
        { title: "Entry A", date: "2025-01-01", content: "Some content about full tidy action" },
        { title: "Entry B", date: "2025-01-02", content: "Some content about full tidy action" },
      ]);
      memFs.files.set(join(TOPICS_DIR, "full-test.md"), content);
      writeMemoryMd(
        memFs,
        "# Long-Term Memory Index\n\n## Full Test\n→ memory/topics/full-test.md\n\n",
      );

      const result = await runMemoryTidyActions(tidyDeps, { action: "full" });

      expect(result.action).toBe("full");
      expect(result.entriesAffected).toBeGreaterThan(0);
    });
  });

  describe("isTidyEnabled", () => {
    it("returns true when pluginConfig is undefined", () => {
      expect(isTidyEnabled(undefined)).toBe(true);
    });

    it("returns true when tidy config is not set", () => {
      expect(isTidyEnabled({})).toBe(true);
    });

    it("returns false when autoAfterDreaming is explicitly false", () => {
      expect(isTidyEnabled({ tidy: { autoAfterDreaming: false } })).toBe(false);
    });

    it("returns true when autoAfterDreaming is true", () => {
      expect(isTidyEnabled({ tidy: { autoAfterDreaming: true } })).toBe(true);
    });
  });
});
