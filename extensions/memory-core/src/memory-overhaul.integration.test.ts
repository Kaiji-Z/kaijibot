import { describe, it, expect, afterEach, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { TopicManager, type TopicManagerDeps } from "./topic-manager.js";
import { MemoryIndexManager, type MemoryIndexDeps } from "./memory-index.js";
import { type TopicEntry, parseTopicFile, serializeTopicFile, createEmptyTopicFile } from "./topic-types.js";
import { runMemoryTidyActions, createTidyDepsFromNodeFs, type MemoryTidyDeps } from "./tools.memory-tidy.js";

// ---------------------------------------------------------------------------
// Temp workspace helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const dir = join(tmpdir(), `memory-integ-${randomUUID()}`);
  await fs.mkdir(join(dir, "memory", "topics"), { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(
    tempDirs.map((d) => fs.rm(d, { recursive: true, force: true }).catch(() => {})),
  );
});

function createNodeFsAdapter(): TopicManagerDeps["fs"] & MemoryIndexDeps["fs"] {
  return {
    readFile: (p: string) => fs.readFile(p, "utf-8"),
    writeFile: (p: string, data: string) => fs.writeFile(p, data, "utf-8"),
    mkdir: (p: string, opts: { recursive: boolean }) => fs.mkdir(p, opts).then(() => {}),
    readdir: (p: string) => fs.readdir(p) as Promise<string[]>,
    stat: (p: string) => fs.stat(p).then((s) => ({ mtimeMs: s.mtimeMs, size: s.size })),
    rename: (a: string, b: string) => fs.rename(a, b),
  };
}

// ---------------------------------------------------------------------------
// Topic CRUD flow
// ---------------------------------------------------------------------------

describe("Topic CRUD flow", () => {
  let ws: string;

  afterEach(async () => {
    if (ws) {
      await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("createTopic → appendEntry → getTopic → verify entries exist", async () => {
    ws = await createTempWorkspace();
    const nodeFs = createNodeFsAdapter();
    const tm = new TopicManager({ workspaceDir: ws, fs: nodeFs });

    await tm.createTopic("user", "user-profile");

    const entry: TopicEntry = {
      title: "Prefers dark mode",
      date: "2026-04-25",
      content: "User explicitly prefers dark mode in IDE.",
      importance: "normal",
      source: "session-compact",
    };
    await tm.appendEntry("user-profile", entry);

    const topic = await tm.getTopic("user-profile");
    expect(topic).not.toBeNull();
    expect(topic!.entries).toHaveLength(1);
    expect(topic!.entries[0]!.title).toBe("Prefers dark mode");
    expect(topic!.entries[0]!.content).toBe("User explicitly prefers dark mode in IDE.");
    expect(topic!.frontmatter.subject).toBe("user");
    expect(topic!.frontmatter.entries).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Topic file persistence (round-trip through disk)
// ---------------------------------------------------------------------------

describe("Topic file persistence", () => {
  let ws: string;

  afterEach(async () => {
    if (ws) {
      await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("write topic file → re-read from disk → verify round-trip", async () => {
    ws = await createTempWorkspace();
    await fs.mkdir(join(ws, "memory", "topics"), { recursive: true });

    const topic = createEmptyTopicFile("feedback", "feedback");
    topic.entries.push(
      { title: "Feedback 1", date: "2026-04-20", content: "Check docs first" },
      { title: "Feedback 2", date: "2026-04-21", content: "That approach was correct" },
    );
    topic.frontmatter.entries = 2;

    const serialized = serializeTopicFile(topic);
    const filePath = join(ws, "memory", "topics", "feedback.md");
    await fs.writeFile(filePath, serialized, "utf-8");

    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = parseTopicFile(raw);

    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]!.title).toBe("Feedback 1");
    expect(parsed.entries[1]!.content).toBe("That approach was correct");
    expect(parsed.frontmatter.subject).toBe("feedback");
    expect(parsed.frontmatter.entries).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Memory index update
// ---------------------------------------------------------------------------

describe("Memory index update", () => {
  let ws: string;

  afterEach(async () => {
    if (ws) {
      await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("addRecentSession → read index → verify section exists in MEMORY.md", async () => {
    ws = await createTempWorkspace();
    const nodeFs = createNodeFsAdapter();
    const idx = new MemoryIndexManager({ workspaceDir: ws, fs: nodeFs });

    await idx.updateSection({
      subject: "user",
      title: "User Profile",
      topicFile: "memory/topics/user-profile.md",
      summary: "Test user info",
    });

    await idx.addRecentSession({
      date: "2026-04-25",
      title: "Integration test session",
      topicPath: "memory/topics/test-session.md",
    });

    const index = await idx.readIndex();
    expect(index.sections).toHaveLength(1);
    expect(index.sections[0]!.title).toBe("User Profile");
    expect(index.sections[0]!.topicFile).toBe("memory/topics/user-profile.md");
    expect(index.recentSessions).toHaveLength(1);
    expect(index.recentSessions[0]!.title).toBe("Integration test session");

    const raw = await fs.readFile(join(ws, "MEMORY.md"), "utf-8");
    expect(raw).toContain("## User Profile");
    expect(raw).toContain("2026-04-25 Integration test session");
  });
});

// ---------------------------------------------------------------------------
// Memory index migration (legacy → new format)
// ---------------------------------------------------------------------------

describe("Memory index migration", () => {
  let ws: string;

  afterEach(async () => {
    if (ws) {
      await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("create legacy MEMORY.md → read with MemoryIndexManager → verify promoted entries preserved", async () => {
    ws = await createTempWorkspace();
    const nodeFs = createNodeFsAdapter();
    const idx = new MemoryIndexManager({ workspaceDir: ws, fs: nodeFs });

    const legacyContent = "- User prefers dark mode\n- Project uses PostgreSQL\n- Timezone: UTC+8\n";

    const migrated = await idx.migrateLegacy(legacyContent);
    await fs.writeFile(join(ws, "MEMORY.md"), migrated, "utf-8");

    expect(migrated).toContain("# Long-Term Memory");
    expect(migrated).toContain("## Promoted From Short-Term Memory (legacy)");
    expect(migrated).toContain("User prefers dark mode");
    expect(migrated).toContain("Project uses PostgreSQL");

    const index = await idx.readIndex();
    expect(index.promotedContent).toContain("User prefers dark mode");
    expect(index.promotedContent).toContain("Timezone: UTC+8");
  });
});

// ---------------------------------------------------------------------------
// memory_tidy dedup
// ---------------------------------------------------------------------------

describe("memory_tidy dedup", () => {
  let ws: string;
  let tidyDeps: MemoryTidyDeps;

  afterEach(async () => {
    if (ws) {
      await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("creates topic with 2 similar entries → run dedup → verify one removed", async () => {
    ws = await createTempWorkspace();
    tidyDeps = createTidyDepsFromNodeFs(ws, fs);

    const tm = tidyDeps.topicManager;
    await tm.createTopic("user", "dedup-topic");

    const baseContent = "User prefers Python programming language for data analysis";
    await tm.appendEntry("dedup-topic", {
      title: "Likes Python",
      date: "2026-01-01",
      content: baseContent,
    });
    await tm.appendEntry("dedup-topic", {
      title: "Likes Python v2",
      date: "2026-01-02",
      content: `${baseContent} tasks`,
    });
    await tm.appendEntry("dedup-topic", {
      title: "Likes Rust",
      date: "2026-01-03",
      content: "User also enjoys Rust for systems programming",
    });

    const before = await tm.getTopic("dedup-topic");
    expect(before!.entries).toHaveLength(3);

    const result = await runMemoryTidyActions(tidyDeps, { action: "dedup", target: "dedup-topic" });

    expect(result.filesAffected).toBe(1);
    expect(result.entriesAffected).toBe(1);

    const after = await tm.getTopic("dedup-topic");
    expect(after!.entries).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// memory_tidy rebalance
// ---------------------------------------------------------------------------

describe("memory_tidy rebalance", () => {
  let ws: string;

  afterEach(async () => {
    if (ws) {
      await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("creates topic with large MEMORY.md → run rebalance → verify trimmed", async () => {
    ws = await createTempWorkspace();
    const nodeFs = createNodeFsAdapter();
    const idx = new MemoryIndexManager({ workspaceDir: ws, fs: nodeFs });

    for (let i = 0; i < 15; i++) {
      await idx.updateSection({
        subject: "reference",
        title: `Reference ${i}`,
        topicFile: `memory/topics/ref-${i}.md`,
        summary: `Summary for ref ${i}: ${"x".repeat(2000)}`,
      });
    }

    const beforeSize = (await fs.stat(join(ws, "MEMORY.md"))).size;
    expect(beforeSize).toBeGreaterThan(25_000);

    const tidyDeps = createTidyDepsFromNodeFs(ws, fs);
    const result = await runMemoryTidyActions(tidyDeps, { action: "rebalance" });

    expect(result.entriesAffected).toBeGreaterThan(0);

    const afterIndex = await idx.readIndex();
    expect(afterIndex.sections.length).toBeLessThan(15);
  });
});

// ---------------------------------------------------------------------------
// memory_tidy archive
// ---------------------------------------------------------------------------

describe("memory_tidy archive", () => {
  let ws: string;

  afterEach(async () => {
    if (ws) {
      await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("creates topic with all old entries → run archive → verify archived", async () => {
    ws = await createTempWorkspace();
    const tidyDeps = createTidyDepsFromNodeFs(ws, fs);

    const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const topic = createEmptyTopicFile("reference", "old-stuff");
    topic.frontmatter.created = oldDate;
    topic.frontmatter.updated = oldDate;
    topic.entries.push(
      { title: "Old entry", date: oldDate, content: "Stale content that should be archived" },
    );
    topic.frontmatter.entries = 1;

    await fs.mkdir(join(ws, "memory", "topics"), { recursive: true });
    await fs.writeFile(
      join(ws, "memory", "topics", "old-stuff.md"),
      serializeTopicFile(topic),
      "utf-8",
    );

    const idx = tidyDeps.indexManager;
    await idx.updateSection({
      subject: "reference",
      title: "Old Stuff",
      topicFile: "memory/topics/old-stuff.md",
      summary: "Old reference material",
    });

    const result = await runMemoryTidyActions(tidyDeps, { action: "archive" });

    expect(result.filesAffected).toBe(1);
    expect(result.changes[0]).toContain("archived");

    const srcExists = await fs.access(join(ws, "memory", "topics", "old-stuff.md")).then(() => true, () => false);
    expect(srcExists).toBe(false);

    const archiveExists = await fs.access(join(ws, "memory", "topics", "archive", "old-stuff.md")).then(() => true, () => false);
    expect(archiveExists).toBe(true);

    const indexAfter = await idx.readIndex();
    const hasSection = indexAfter.sections.some((s) => s.topicFile === "memory/topics/old-stuff.md");
    expect(hasSection).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-component flow (save → index → recall)
// ---------------------------------------------------------------------------

describe("Cross-component flow", () => {
  let ws: string;

  afterEach(async () => {
    if (ws) {
      await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("save entries to multiple topics → update index → search by reading topics → verify recall works", async () => {
    ws = await createTempWorkspace();
    const nodeFs = createNodeFsAdapter();
    const tm = new TopicManager({ workspaceDir: ws, fs: nodeFs });
    const idx = new MemoryIndexManager({ workspaceDir: ws, fs: nodeFs });

    await tm.createTopic("user", "user-profile");
    await tm.createTopic("project", "project-decisions");
    await tm.createTopic("reference", "reference");

    await tm.appendEntry("user-profile", {
      title: "Timezone preference",
      date: "2026-04-20",
      content: "User is in UTC+8 timezone, prefers morning meetings before 11am",
      importance: "high",
      source: "memory-save",
    });
    await tm.appendEntry("user-profile", {
      title: "Editor preference",
      date: "2026-04-21",
      content: "User prefers VSCode with Vim keybindings",
      source: "memory-save",
    });

    await tm.appendEntry("project-decisions", {
      title: "Database migration",
      date: "2026-04-22",
      content: "Migrated from MongoDB to PostgreSQL for better relational queries",
      importance: "high",
      source: "session-compact",
    });

    await tm.appendEntry("reference", {
      title: "Useful library",
      date: "2026-04-23",
      content: "Using Vitest for testing with V8 coverage provider",
      source: "memory-save",
    });

    await idx.updateSection({
      subject: "user",
      title: "User Profile",
      topicFile: "memory/topics/user-profile.md",
      summary: "Timezone UTC+8, prefers morning meetings, uses VSCode",
    });
    await idx.updateSection({
      subject: "project",
      title: "Project Decisions",
      topicFile: "memory/topics/project-decisions.md",
      summary: "Migrated to PostgreSQL",
    });
    await idx.updateSection({
      subject: "reference",
      title: "Reference",
      topicFile: "memory/topics/reference.md",
      summary: "Vitest for testing",
    });

    await idx.addRecentSession({
      date: "2026-04-25",
      title: "Full memory flow test",
      topicPath: "memory/topics/user-profile.md",
    });

    const index = await idx.readIndex();
    expect(index.sections).toHaveLength(3);
    expect(index.recentSessions).toHaveLength(1);

    const rawMemory = await fs.readFile(join(ws, "MEMORY.md"), "utf-8");
    expect(rawMemory).toContain("## User Profile");
    expect(rawMemory).toContain("## Project Decisions");
    expect(rawMemory).toContain("## Reference");

    const userProfile = await tm.getTopic("user-profile");
    expect(userProfile!.entries).toHaveLength(2);
    const tzEntry = userProfile!.entries.find((e) => e.title === "Timezone preference");
    expect(tzEntry).toBeDefined();
    expect(tzEntry!.content).toContain("UTC+8");

    const projectTopic = await tm.getTopic("project-decisions");
    expect(projectTopic!.entries).toHaveLength(1);
    expect(projectTopic!.entries[0]!.content).toContain("PostgreSQL");

    const refTopic = await tm.getTopic("reference");
    expect(refTopic!.entries).toHaveLength(1);
    expect(refTopic!.entries[0]!.content).toContain("Vitest");

    const allTopics = await tm.listTopics();
    expect(allTopics).toContain("user-profile.md");
    expect(allTopics).toContain("project-decisions.md");
    expect(allTopics).toContain("reference.md");
  });
});
