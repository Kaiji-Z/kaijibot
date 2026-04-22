import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePromotedEntries, prunePromotedEntries, runPruningPhase } from "./dreaming-pruning.js";
import { createMemoryCoreTestHarness } from "./test-helpers.js";

const { createTempWorkspace } = createMemoryCoreTestHarness();

function makeEntry(content: string, lineIndex: number, marker?: string) {
  return {
    rawLine: marker ?? `<!-- kaijibot-memory-promotion:abc123 -->`,
    marker: marker ?? `<!-- kaijibot-memory-promotion:abc123 -->`,
    content,
    lineIndex,
  };
}

describe("parsePromotedEntries", () => {
  it("returns empty for lines with no markers", () => {
    const lines = ["# MEMORY", "", "- some content [score=0.8]", "- more content"];
    expect(parsePromotedEntries(lines)).toEqual([]);
  });

  it("parses a single marker + content line", () => {
    const lines = [
      "# MEMORY",
      "<!-- kaijibot-memory-promotion:hash1 -->",
      "- user prefers dark mode [score=0.85 source=recall]",
      "",
    ];
    const entries = parsePromotedEntries(lines);
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("user prefers dark mode");
    expect(entries[0].lineIndex).toBe(1);
  });

  it("parses multiple markers", () => {
    const lines = [
      "<!-- kaijibot-memory-promotion:hash1 -->",
      "- first entry [score=0.9]",
      "<!-- kaijibot-memory-promotion:hash2 -->",
      "- second entry [score=0.8]",
    ];
    const entries = parsePromotedEntries(lines);
    expect(entries).toHaveLength(2);
    expect(entries[0].content).toBe("first entry");
    expect(entries[1].content).toBe("second entry");
  });
});

describe("prunePromotedEntries", () => {
  it("returns all kept for empty input", () => {
    const result = prunePromotedEntries([]);
    expect(result.kept).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.reasons).toHaveLength(0);
  });

  it("keeps a single valid entry", () => {
    const entries = [makeEntry("user prefers dark mode", 0)];
    const result = prunePromotedEntries(entries);
    expect(result.kept).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
  });

  it("removes entries matching exclusion patterns", () => {
    const entries = [makeEntry("src/foo.ts has a bug in the handler", 0)];
    const result = prunePromotedEntries(entries);
    expect(result.kept).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
    expect(result.reasons[0]).toContain("Excluded");
  });

  it("deduplicates near-identical entries", () => {
    const entries = [
      makeEntry("user prefers dark mode for coding", 0),
      makeEntry("user prefers dark mode for coding at night", 2),
    ];
    const result = prunePromotedEntries(entries, { dedupSimilarity: 0.6 });
    expect(result.removed.length).toBeGreaterThanOrEqual(1);
    expect(result.kept.length).toBe(1);
    expect(result.reasons.some((r) => r.includes("Duplicate"))).toBe(true);
  });

  it("keeps completely different entries", () => {
    const entries = [
      makeEntry("user lives in Shanghai", 0),
      makeEntry("project uses PostgreSQL for persistence", 2),
    ];
    const result = prunePromotedEntries(entries);
    expect(result.kept).toHaveLength(2);
    expect(result.removed).toHaveLength(0);
  });

  it("handles mixed: excluded + duplicate + unique", () => {
    const entries = [
      makeEntry("user lives in Shanghai", 0),
      makeEntry("src/bar.ts needs refactoring for clarity", 2),
      makeEntry("user lives in Shanghai and works remotely", 4),
    ];
    const result = prunePromotedEntries(entries, { dedupSimilarity: 0.5 });
    expect(result.removed.length).toBeGreaterThanOrEqual(2);
    expect(result.kept.length).toBe(1);
  });
});

describe("runPruningPhase", () => {
  it("skips when MEMORY.md does not exist", async () => {
    const workspaceDir = await createTempWorkspace("prune-nofile-");
    const logs: string[] = [];
    const result = await runPruningPhase({
      workspaceDir,
      logger: { info: (m) => logs.push(m), warn: () => {}, error: () => {} },
      storage: { mode: "inline", separateReports: false },
    });
    expect(result.pruned).toBe(0);
    expect(result.kept).toBe(0);
    expect(logs.some((l) => l.includes("no MEMORY.md"))).toBe(true);
  });

  it("skips when no promoted entries exist", async () => {
    const workspaceDir = await createTempWorkspace("prune-noentries-");
    await fs.writeFile(
      path.join(workspaceDir, "MEMORY.md"),
      "# MEMORY\n\n- regular content without markers\n",
      "utf-8",
    );
    const logs: string[] = [];
    const result = await runPruningPhase({
      workspaceDir,
      logger: { info: (m) => logs.push(m), warn: () => {}, error: () => {} },
      storage: { mode: "inline", separateReports: false },
    });
    expect(result.pruned).toBe(0);
    expect(result.kept).toBe(0);
  });

  it("removes excluded entries and writes report", async () => {
    const workspaceDir = await createTempWorkspace("prune-excluded-");
    const memoryMd = [
      "# MEMORY",
      "",
      "<!-- kaijibot-memory-promotion:h1 -->",
      "- src/foo.ts has a bug [score=0.8]",
      "",
      "<!-- kaijibot-memory-promotion:h2 -->",
      "- user prefers TypeScript [score=0.9]",
      "",
    ].join("\n");
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), memoryMd, "utf-8");

    const result = await runPruningPhase({
      workspaceDir,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      storage: { mode: "inline", separateReports: false },
    });

    expect(result.pruned).toBe(1);
    expect(result.kept).toBe(1);

    const updated = await fs.readFile(path.join(workspaceDir, "MEMORY.md"), "utf-8");
    expect(updated).toContain("user prefers TypeScript");
    expect(updated).not.toContain("src/foo.ts");
  });
});
