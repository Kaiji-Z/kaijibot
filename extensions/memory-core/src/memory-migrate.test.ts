import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import {
  parseLegacyMemoryFiles,
  heuristicClassify,
  classifyEntries,
  routeToTopicFiles,
  archiveProcessedFiles,
  runMemoryMigrate,
  type FsAdapter,
} from "./memory-migrate.js";

// ---------------------------------------------------------------------------
// In-memory FsAdapter
// ---------------------------------------------------------------------------

function createMemoryFs(): { files: Map<string, string>; fs: FsAdapter } {
  const files = new Map<string, string>();

  return {
    files,
    fs: {
      readFile: async (p: string) => {
        const content = files.get(p);
        if (content === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
        return content;
      },
      writeFile: async (p: string, data: string) => {
        files.set(p, data);
      },
      mkdir: async (_p: string, _options: { recursive: boolean }) => {},
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
        const content = files.get(p);
        if (content === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
        return { mtimeMs: Date.now(), size: content.length };
      },
      rename: async (oldPath: string, newPath: string) => {
        const content = files.get(oldPath);
        if (content === undefined) throw Object.assign(new Error(`ENOENT: ${oldPath}`), { code: "ENOENT" });
        files.delete(oldPath);
        files.set(newPath, content);
      },
    },
  };
}

const WORKSPACE = "/test-workspace";
const MEMORY_DIR = path.join(WORKSPACE, "memory");

function writeFile(memFs: ReturnType<typeof createMemoryFs>, relPath: string, content: string) {
  memFs.files.set(path.join(WORKSPACE, relPath), content);
}

// ---------------------------------------------------------------------------
// parseLegacyMemoryFiles
// ---------------------------------------------------------------------------

describe("parseLegacyMemoryFiles", () => {
  let memFs: ReturnType<typeof createMemoryFs>;

  beforeEach(() => {
    memFs = createMemoryFs();
  });

  it("parses entries from daily memory files", async () => {
    writeFile(memFs, "memory/2026-04-16.md", [
      "# Session: 2026-04-16",
      "This was a discussion about AI architecture patterns.",
      "We discussed microservices vs monolith tradeoffs.",
      "",
      "## Light Sleep",
      "User prefers early morning work sessions and avoids late-night coding.",
      "This preference was confirmed during the standup.",
    ].join("\n"));

    const entries = await parseLegacyMemoryFiles(MEMORY_DIR, memFs.fs);

    expect(entries).toHaveLength(2);
    expect(entries[0]!.heading).toBe("Session: 2026-04-16");
    expect(entries[0]!.content).toContain("AI architecture patterns");
    expect(entries[0]!.sourceFile).toBe("2026-04-16.md");
    expect(entries[1]!.heading).toBe("Light Sleep");
    expect(entries[1]!.content).toContain("early morning work");
  });

  it("skips dreaming metadata entries", async () => {
    writeFile(memFs, "memory/2026-04-17.md", [
      "# Session: 2026-04-17",
      "Regular session with useful info about the deployment pipeline.",
      "",
      "## Dreaming Output",
      "kaijibot:dreaming: confidence: 0.85 evidence: recall-store",
    ].join("\n"));

    const entries = await parseLegacyMemoryFiles(MEMORY_DIR, memFs.fs);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.heading).toBe("Session: 2026-04-17");
    expect(entries[0]!.content).toContain("deployment pipeline");
  });

  it("skips session metadata headers", async () => {
    writeFile(memFs, "memory/2026-04-18.md", [
      "- **Session**: 2026-04-18 10:00",
      "- **Duration**: 45 minutes",
    ].join("\n"));

    const entries = await parseLegacyMemoryFiles(MEMORY_DIR, memFs.fs);

    expect(entries).toHaveLength(0);
  });

  it("skips entries shorter than 20 chars", async () => {
    writeFile(memFs, "memory/2026-04-19.md", [
      "# Short",
      "Too short",
      "",
      "# Valid Entry",
      "This entry has enough content to be included in the results.",
    ].join("\n"));

    const entries = await parseLegacyMemoryFiles(MEMORY_DIR, memFs.fs);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.heading).toBe("Valid Entry");
  });

  it("skips topic index format headings", async () => {
    writeFile(memFs, "memory/2026-04-20.md", [
      "## [user] User Profile",
      "→ memory/topics/user-profile.md",
      "Already migrated content here with sufficient length.",
    ].join("\n"));

    const entries = await parseLegacyMemoryFiles(MEMORY_DIR, memFs.fs);

    expect(entries).toHaveLength(0);
  });

  it("matches daily files with suffixes", async () => {
    writeFile(memFs, "memory/2026-04-16-session2.md", [
      "# Follow-up Discussion",
      "Additional notes about the database migration strategy and timing.",
    ].join("\n"));

    const entries = await parseLegacyMemoryFiles(MEMORY_DIR, memFs.fs);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.sourceFile).toBe("2026-04-16-session2.md");
  });

  it("ignores non-daily files", async () => {
    writeFile(memFs, "memory/notes.md", "# Notes\nSome content that should be ignored.");
    writeFile(memFs, "memory/README.md", "# README\nMemory directory readme file.");

    const entries = await parseLegacyMemoryFiles(MEMORY_DIR, memFs.fs);

    expect(entries).toHaveLength(0);
  });

  it("returns empty when directory does not exist", async () => {
    const entries = await parseLegacyMemoryFiles("/nonexistent/path", memFs.fs);
    expect(entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// heuristicClassify
// ---------------------------------------------------------------------------

describe("heuristicClassify", () => {
  it("classifies entries as reference type with session slug", () => {
    const entries = [
      {
        sourceFile: "2026-04-16.md",
        heading: "AI Architecture",
        content: "Discussion about microservices patterns and deployment strategies.",
        startLine: 0,
        endLine: 2,
        lineCount: 2,
      },
    ];

    const classified = heuristicClassify(entries);

    expect(classified).toHaveLength(1);
    expect(classified[0]!.type).toBe("reference");
    expect(classified[0]!.topicSlug).toBe("session");
    expect(classified[0]!.title).toContain("2026-04-16");
    expect(classified[0]!.importance).toBe("normal");
    expect(classified[0]!.originalContent).toBe(entries[0]!.content);
  });

  it("truncates long titles to 60 chars", () => {
    const longHeading = "A".repeat(80);
    const entries = [
      {
        sourceFile: "2026-04-16.md",
        heading: longHeading,
        content: "Some content that is at least twenty characters long.",
        startLine: 0,
        endLine: 1,
        lineCount: 1,
      },
    ];

    const classified = heuristicClassify(entries);

    expect(classified[0]!.title.length).toBeLessThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------
// classifyEntries
// ---------------------------------------------------------------------------

describe("classifyEntries", () => {
  it("uses heuristic fallback when no classifyFn provided", async () => {
    const entries = [
      {
        sourceFile: "2026-04-16.md",
        heading: "Test Entry",
        content: "Content for testing classification fallback behavior.",
        startLine: 0,
        endLine: 1,
        lineCount: 1,
      },
    ];

    const classified = await classifyEntries(entries);

    expect(classified).toHaveLength(1);
    expect(classified[0]!.type).toBe("reference");
  });

  it("uses provided classifyFn", async () => {
    const entries = [
      {
        sourceFile: "2026-04-16.md",
        heading: "User Prefers Dark Mode",
        content: "User explicitly stated preference for dark mode.",
        startLine: 0,
        endLine: 1,
        lineCount: 1,
      },
    ];

    const mockClassify = async (batch: typeof entries) =>
      batch.map((e) => ({
        sourceFile: e.sourceFile,
        type: "user" as const,
        topicSlug: "user-preferences",
        title: "Dark Mode Preference",
        summary: e.content,
        importance: "high" as const,
        originalContent: e.content,
      }));

    const classified = await classifyEntries(entries, mockClassify);

    expect(classified).toHaveLength(1);
    expect(classified[0]!.type).toBe("user");
    expect(classified[0]!.topicSlug).toBe("user-preferences");
    expect(classified[0]!.importance).toBe("high");
  });

  it("falls back to heuristic when classifyFn throws", async () => {
    const entries = [
      {
        sourceFile: "2026-04-16.md",
        heading: "Test",
        content: "Content that should get heuristic classification instead.",
        startLine: 0,
        endLine: 1,
        lineCount: 1,
      },
    ];

    const failClassify = async () => {
      throw new Error("LLM unavailable");
    };

    const classified = await classifyEntries(entries, failClassify);

    expect(classified).toHaveLength(1);
    expect(classified[0]!.type).toBe("reference");
    expect(classified[0]!.topicSlug).toBe("session");
  });

  it("returns empty for empty input", async () => {
    const classified = await classifyEntries([]);
    expect(classified).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// routeToTopicFiles
// ---------------------------------------------------------------------------

describe("routeToTopicFiles", () => {
  let memFs: ReturnType<typeof createMemoryFs>;

  beforeEach(() => {
    memFs = createMemoryFs();
  });

  it("creates topic files and routes entries", async () => {
    const classified = [
      {
        sourceFile: "2026-04-16.md",
        type: "user" as const,
        topicSlug: "user-preferences",
        title: "Dark Mode Preference",
        summary: "User prefers dark mode in IDE.",
        importance: "normal" as const,
        originalContent: "User prefers dark mode in IDE.",
      },
    ];

    const result = await routeToTopicFiles(classified, WORKSPACE, memFs.fs);

    expect(result.entriesRouted).toBe(1);
    expect(result.topicsCreated).toContain("user-preferences.md");

    const topicPath = path.join(WORKSPACE, "memory/topics/user-preferences.md");
    const content = memFs.files.get(topicPath);
    expect(content).toBeDefined();
    expect(content).toContain("Dark Mode Preference");
  });

  it("updates existing topic files", async () => {
    const existingTopic = [
      "---",
      "type: user",
      `created: ${new Date().toISOString().slice(0, 10)}`,
      `updated: ${new Date().toISOString().slice(0, 10)}`,
      "entries: 1",
      "---",
      "",
      "## Existing Entry (2026-04-15)",
      "",
      "Some existing content.",
    ].join("\n");
    memFs.files.set(path.join(WORKSPACE, "memory/topics/user-profile.md"), existingTopic);

    const classified = [
      {
        sourceFile: "2026-04-16.md",
        type: "user" as const,
        topicSlug: "user",
        title: "New Preference",
        summary: "User prefers vim keybindings.",
        importance: "high" as const,
        originalContent: "User prefers vim keybindings.",
      },
    ];

    const result = await routeToTopicFiles(classified, WORKSPACE, memFs.fs);

    expect(result.entriesRouted).toBe(1);
    expect(result.topicsUpdated).toContain("user-profile.md");
  });

  it("returns empty result for empty input", async () => {
    const result = await routeToTopicFiles([], WORKSPACE, memFs.fs);

    expect(result.entriesRouted).toBe(0);
    expect(result.topicsCreated).toHaveLength(0);
    expect(result.topicsUpdated).toHaveLength(0);
  });

  it("routes multiple entries to different topic files", async () => {
    const classified = [
      {
        sourceFile: "2026-04-16.md",
        type: "user" as const,
        topicSlug: "user",
        title: "Timezone",
        summary: "User is in UTC+8.",
        importance: "normal" as const,
        originalContent: "User is in UTC+8.",
      },
      {
        sourceFile: "2026-04-16.md",
        type: "project" as const,
        topicSlug: "project",
        title: "Migration Decision",
        summary: "Decided to migrate to v2 architecture.",
        importance: "high" as const,
        originalContent: "Decided to migrate to v2 architecture.",
      },
    ];

    const result = await routeToTopicFiles(classified, WORKSPACE, memFs.fs);

    expect(result.entriesRouted).toBe(2);
    expect(result.topicsCreated.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// archiveProcessedFiles
// ---------------------------------------------------------------------------

describe("archiveProcessedFiles", () => {
  let memFs: ReturnType<typeof createMemoryFs>;

  beforeEach(() => {
    memFs = createMemoryFs();
  });

  it("moves processed files to archive directory", async () => {
    memFs.files.set(path.join(MEMORY_DIR, "2026-04-16.md"), "content");
    memFs.files.set(path.join(MEMORY_DIR, "2026-04-17.md"), "content");

    const archived = await archiveProcessedFiles(
      ["2026-04-16.md", "2026-04-17.md"],
      MEMORY_DIR,
      WORKSPACE,
      memFs.fs,
    );

    expect(archived).toBe(2);
    expect(memFs.files.has(path.join(MEMORY_DIR, "2026-04-16.md"))).toBe(false);
    expect(memFs.files.has(path.join(MEMORY_DIR, "2026-04-17.md"))).toBe(false);
    expect(memFs.files.has(path.join(WORKSPACE, "memory/archive/2026-04-16.md"))).toBe(true);
    expect(memFs.files.has(path.join(WORKSPACE, "memory/archive/2026-04-17.md"))).toBe(true);
  });

  it("does not move unlisted files", async () => {
    memFs.files.set(path.join(MEMORY_DIR, "2026-04-16.md"), "content");
    memFs.files.set(path.join(MEMORY_DIR, "2026-04-17.md"), "content");

    await archiveProcessedFiles(
      ["2026-04-16.md"],
      MEMORY_DIR,
      WORKSPACE,
      memFs.fs,
    );

    expect(memFs.files.has(path.join(MEMORY_DIR, "2026-04-16.md"))).toBe(false);
    expect(memFs.files.has(path.join(MEMORY_DIR, "2026-04-17.md"))).toBe(true);
  });

  it("returns 0 for empty file list", async () => {
    const archived = await archiveProcessedFiles([], MEMORY_DIR, WORKSPACE, memFs.fs);
    expect(archived).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runMemoryMigrate (dry-run)
// ---------------------------------------------------------------------------

describe("runMemoryMigrate", () => {
  let memFs: ReturnType<typeof createMemoryFs>;

  beforeEach(() => {
    memFs = createMemoryFs();
  });

  it("dry-run does not write or move files", async () => {
    writeFile(memFs, "memory/2026-04-16.md", [
      "# Test Session",
      "A session about learning TypeScript generics and their practical applications.",
    ].join("\n"));

    const result = await runMemoryMigrate({
      workspaceDir: WORKSPACE,
      dryRun: true,
      fs: memFs.fs,
    });

    expect(result.filesScanned).toBe(1);
    expect(result.entriesParsed).toBe(1);
    expect(result.entriesClassified).toBe(1);
    expect(result.entriesRouted).toBe(0);
    expect(result.filesArchived).toBe(0);
    expect(result.topicsCreated).toHaveLength(0);

    expect(memFs.files.has(path.join(MEMORY_DIR, "2026-04-16.md"))).toBe(true);
  });

  it("full run routes and archives", async () => {
    writeFile(memFs, "memory/2026-04-16.md", [
      "# Architecture Discussion",
      "Decided to use event-driven architecture for the new notification system.",
    ].join("\n"));

    const result = await runMemoryMigrate({
      workspaceDir: WORKSPACE,
      dryRun: false,
      archive: true,
      fs: memFs.fs,
    });

    expect(result.entriesParsed).toBe(1);
    expect(result.entriesClassified).toBe(1);
    expect(result.entriesRouted).toBe(1);
    expect(result.filesArchived).toBe(1);
    expect(result.topicsCreated.length).toBeGreaterThanOrEqual(1);
    expect(memFs.files.has(path.join(MEMORY_DIR, "2026-04-16.md"))).toBe(false);
  });

  it("skips archive when archive option is false", async () => {
    writeFile(memFs, "memory/2026-04-16.md", [
      "# Some Notes",
      "Notes about the deployment pipeline and monitoring setup.",
    ].join("\n"));

    const result = await runMemoryMigrate({
      workspaceDir: WORKSPACE,
      dryRun: false,
      archive: false,
      fs: memFs.fs,
    });

    expect(result.entriesRouted).toBe(1);
    expect(result.filesArchived).toBe(0);
    expect(memFs.files.has(path.join(MEMORY_DIR, "2026-04-16.md"))).toBe(true);
  });

  it("returns empty results when no daily files exist", async () => {
    const result = await runMemoryMigrate({
      workspaceDir: WORKSPACE,
      fs: memFs.fs,
    });

    expect(result.filesScanned).toBe(0);
    expect(result.entriesParsed).toBe(0);
    expect(result.entriesRouted).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("uses custom sourceDir", async () => {
    const customDir = "/custom-memory";
    memFs.files.set(path.join(customDir, "2026-04-16.md"), [
      "# Custom Location",
      "Entry in a custom source directory for testing override behavior.",
    ].join("\n"));

    const result = await runMemoryMigrate({
      workspaceDir: WORKSPACE,
      sourceDir: customDir,
      fs: memFs.fs,
    });

    expect(result.filesScanned).toBe(1);
    expect(result.entriesParsed).toBe(1);
  });

  it("uses custom classifyFn", async () => {
    writeFile(memFs, "memory/2026-04-16.md", [
      "# User Feedback",
      "User said the search results are very relevant and accurate.",
    ].join("\n"));

    const mockClassify = async (entries: unknown[]) =>
      entries.map((e: unknown) => {
        const entry = e as { sourceFile: string; content: string };
        return {
          sourceFile: entry.sourceFile,
          type: "feedback" as const,
          topicSlug: "feedback",
          title: "Positive Feedback",
          summary: entry.content,
          importance: "high" as const,
          originalContent: entry.content,
        };
      });

    const result = await runMemoryMigrate({
      workspaceDir: WORKSPACE,
      classifyFn: mockClassify,
      fs: memFs.fs,
    });

    expect(result.entriesClassified).toBe(1);
    expect(result.entriesRouted).toBe(1);
  });
});
