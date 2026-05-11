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

  it("updateSection → read index → verify topic pointer exists in MEMORY.md", async () => {
    ws = await createTempWorkspace();
    const nodeFs = createNodeFsAdapter();
    const idx = new MemoryIndexManager({ workspaceDir: ws, fs: nodeFs });

    await idx.updateSection({
      subject: "user",
      title: "user-profile",
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
    expect(index.sections[0]!.title).toBe("user-profile");
    expect(index.sections[0]!.topicFile).toBe("memory/topics/user-profile.md");
    // addRecentSession no longer serialized — in-memory only, lost after writeIndex cycle
    expect(index.recentSessions).toHaveLength(0);

    const raw = await fs.readFile(join(ws, "MEMORY.md"), "utf-8");
    // New format: flat Topic Pointers list, no verbose H2+summary
    expect(raw).toContain("## Topic Pointers");
    expect(raw).toContain("- user-profile → memory/topics/user-profile.md");
    // Recent Sessions no longer serialized
    expect(raw).not.toContain("## Recent Sessions");
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

    // Flat format uses ~80 bytes per section, so we need many sections + inline content
    // to exceed the 8KB budget
    for (let i = 0; i < 100; i++) {
      await idx.updateSection({
        subject: `topic-${i}`,
        title: `Topic ${i}`,
        topicFile: `memory/topics/topic-${i}.md`,
        summary: "",
      });
    }

    // Add large inline sections to guarantee exceeding budget
    const index = await idx.readIndex();
    index.inlineSections = [
      { section: "👤 User", lines: ["- " + "x".repeat(3000)] },
      { section: "💬 Key Feedback", lines: ["- " + "y".repeat(3000)] },
    ];
    await idx.writeIndex(index);

    const beforeSize = (await fs.stat(join(ws, "MEMORY.md"))).size;
    expect(beforeSize).toBeGreaterThan(8192);

    const tidyDeps = createTidyDepsFromNodeFs(ws, fs);
    await runMemoryTidyActions(tidyDeps, { action: "rebalance" });

    const afterRaw = await fs.readFile(join(ws, "MEMORY.md"), "utf-8");
    const afterSize = new TextEncoder().encode(afterRaw).length;
    expect(afterSize).toBeLessThanOrEqual(8192);

    const afterIndex = await idx.readIndex();
    expect(afterIndex.sections.length).toBeLessThanOrEqual(100);
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
    // addRecentSession no longer serialized
    expect(index.recentSessions).toHaveLength(0);

    const rawMemory = await fs.readFile(join(ws, "MEMORY.md"), "utf-8");
    expect(rawMemory).toContain("## Topic Pointers");
    expect(rawMemory).toContain("- User Profile → memory/topics/user-profile.md");
    expect(rawMemory).toContain("- Project Decisions → memory/topics/project-decisions.md");
    expect(rawMemory).toContain("- Reference → memory/topics/reference.md");
    expect(rawMemory).not.toContain("## Recent Sessions");

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

// ---------------------------------------------------------------------------
// Simulated hook flow (session end → MEMORY.md update)
// ---------------------------------------------------------------------------

describe("Simulated session-memory hook flow", () => {
  let ws: string;
  let nodeFs: ReturnType<typeof createNodeFsAdapter>;
  let tm: TopicManager;
  let idx: MemoryIndexManager;

  const MEMORY_TYPE_TO_SECTION: Record<string, string> = {
    user: "👤 User",
    feedback: "💬 Key Feedback",
    project: "🎯 Active Focus",
    reference: "🔗 Reference",
  };

  async function simulateHookWrite(
    topicSlug: string,
    summary: string,
    memoryType: string | undefined,
    decisions: string[],
    dateStr: string,
  ): Promise<void> {
    const topicFileName = `${topicSlug}.md`;
    let topic = await tm.getTopic(topicFileName);
    if (!topic) {
      topic = await tm.createTopic(topicSlug, topicFileName);
    }

    await tm.appendEntry(topicFileName, {
      title: `${dateStr} session`,
      date: dateStr,
      content: summary.slice(0, 4000),
      importance: decisions.length > 0 ? "high" : "normal",
      source: "session-memory",
    });

    await idx.updateSection({
      subject: topicSlug,
      title: topicSlug,
      topicFile: `memory/topics/${topicFileName}`,
      summary: summary.slice(0, 120),
    });

    if (memoryType) {
      const section = MEMORY_TYPE_TO_SECTION[memoryType];
      if (section) {
        const index = await idx.readIndex();
        const inlineSections = index.inlineSections ?? [];

        const inlineLines = [`- ${dateStr}: ${summary.slice(0, 100)}`];
        for (const d of decisions.slice(0, 3)) {
          inlineLines.push(`  - Decision: ${d}`);
        }

        const existingIdx = inlineSections.findIndex((s) => s.section === section);
        if (existingIdx >= 0) {
          inlineSections[existingIdx]!.lines = [
            "",
            ...inlineLines,
            ...inlineSections[existingIdx]!.lines,
          ];
        } else {
          inlineSections.push({ section, lines: ["", ...inlineLines] });
        }

        index.inlineSections = inlineSections;
        await idx.writeIndex(index);
      }
    }

    await idx.rebalanceIndex();
  }

  afterEach(async () => {
    if (ws) {
      await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("session with memoryType=user → inline section populated + topic pointer + rebalance", async () => {
    ws = await createTempWorkspace();
    nodeFs = createNodeFsAdapter();
    tm = new TopicManager({ workspaceDir: ws, fs: nodeFs });
    idx = new MemoryIndexManager({ workspaceDir: ws, fs: nodeFs });

    await simulateHookWrite(
      "cognitive-system",
      "Discussed the cognitive insight pipeline architecture and persona system design",
      "project",
      ["Use flat Topic Pointers instead of verbose H2+summary", "Remove Recent Sessions from MEMORY.md"],
      "2026-05-11",
    );

    const rawMemory = await fs.readFile(join(ws, "MEMORY.md"), "utf-8");
    expect(rawMemory).toContain("# Long-Term Memory");
    expect(rawMemory).toContain("## 🎯 Active Focus");
    expect(rawMemory).toContain("2026-05-11: Discussed the cognitive insight pipeline architecture");
    expect(rawMemory).toContain("Decision: Use flat Topic Pointers");
    expect(rawMemory).toContain("## Topic Pointers");
    expect(rawMemory).toContain("- cognitive-system → memory/topics/cognitive-system.md");
    expect(rawMemory).not.toContain("## Recent Sessions");

    const index = await idx.readIndex();
    expect(index.sections).toHaveLength(1);
    expect(index.inlineSections).toBeDefined();
    expect(index.inlineSections!.length).toBeGreaterThanOrEqual(1);
    const focusSection = index.inlineSections!.find((s) => s.section === "🎯 Active Focus");
    expect(focusSection).toBeDefined();
    expect(focusSection!.lines.some((l) => l.includes("cognitive insight"))).toBe(true);

    const topic = await tm.getTopic("cognitive-system");
    expect(topic).not.toBeNull();
    expect(topic!.entries).toHaveLength(1);
    // importance is not preserved through topic file serialization (parseTopicEntry limitation)
  });

  it("multiple sessions → inline sections accumulate → rebalance trims to budget", async () => {
    ws = await createTempWorkspace();
    nodeFs = createNodeFsAdapter();
    tm = new TopicManager({ workspaceDir: ws, fs: nodeFs });
    idx = new MemoryIndexManager({ workspaceDir: ws, fs: nodeFs });

    for (let i = 0; i < 8; i++) {
      await simulateHookWrite(
        `topic-${i}`,
        `Session ${i}: working on feature ${i} with detailed description that takes up space in memory`,
        ["user", "feedback", "project", "reference"][i % 4],
        i % 2 === 0 ? [`Decision ${i}: use approach ${i}`] : [],
        `2026-05-${String(11 + i).padStart(2, "0")}`,
      );
    }

    const rawMemory = await fs.readFile(join(ws, "MEMORY.md"), "utf-8");
    const memSize = new TextEncoder().encode(rawMemory).length;

    expect(memSize).toBeLessThanOrEqual(8192);
    expect(rawMemory).toContain("## Topic Pointers");
    expect(rawMemory).not.toContain("## Recent Sessions");

    const topicPointers = rawMemory.match(/^- .+? → .+$/gm);
    expect(topicPointers).not.toBeNull();
    expect(topicPointers!.length).toBeGreaterThanOrEqual(1);

    const inlineSections = rawMemory.match(/^## [👤💬🎯🔗]/gm);
    expect(inlineSections).not.toBeNull();
    expect(inlineSections!.length).toBeGreaterThanOrEqual(1);
  });

  it("session without memoryType → only topic pointer, no inline section", async () => {
    ws = await createTempWorkspace();
    nodeFs = createNodeFsAdapter();
    tm = new TopicManager({ workspaceDir: ws, fs: nodeFs });
    idx = new MemoryIndexManager({ workspaceDir: ws, fs: nodeFs });

    await simulateHookWrite(
      "casual-chat",
      "User asked about weather and weekend plans",
      undefined,
      [],
      "2026-05-11",
    );

    const rawMemory = await fs.readFile(join(ws, "MEMORY.md"), "utf-8");
    expect(rawMemory).toContain("## Topic Pointers");
    expect(rawMemory).toContain("- casual-chat → memory/topics/casual-chat.md");
    expect(rawMemory).not.toContain("## 👤 User");
    expect(rawMemory).not.toContain("## 💬 Key Feedback");
    expect(rawMemory).not.toContain("## 🎯 Active Focus");
    expect(rawMemory).not.toContain("## 🔗 Reference");

    const index = await idx.readIndex();
    expect(index.inlineSections ?? []).toHaveLength(0);
  });

  it("old format MEMORY.md → read → updateSection → new format output", async () => {
    ws = await createTempWorkspace();
    await fs.mkdir(join(ws, "memory", "topics"), { recursive: true });

    const oldFormat = [
      "# Long-Term Memory",
      "",
      "## 👤 User",
      "- Timezone: UTC+8",
      "- Language: zh-CN",
      "",
      "## User Profile",
      "→ memory/topics/user-profile.md",
      "Timezone and preferences",
      "",
      "## Recent Sessions",
      "- 2026-05-10 Discussed architecture → memory/topics/arch.md",
      "- 2026-05-09 Fixed bug → memory/topics/bugfix.md",
      "",
    ].join("\n");

    await fs.writeFile(join(ws, "MEMORY.md"), oldFormat, "utf-8");

    nodeFs = createNodeFsAdapter();
    tm = new TopicManager({ workspaceDir: ws, fs: nodeFs });
    idx = new MemoryIndexManager({ workspaceDir: ws, fs: nodeFs });

    const index = await idx.readIndex();
    expect(index.inlineSections).toHaveLength(1);
    expect(index.inlineSections![0]!.section).toBe("👤 User");
    expect(index.sections).toHaveLength(1);
    expect(index.sections[0]!.title).toBe("User Profile");
    expect(index.recentSessions).toHaveLength(2);

    await idx.updateSection({
      subject: "new-topic",
      title: "new-topic",
      topicFile: "memory/topics/new-topic.md",
      summary: "Added by new hook",
    });
    await idx.rebalanceIndex();

    const rawMemory = await fs.readFile(join(ws, "MEMORY.md"), "utf-8");
    expect(rawMemory).toContain("## Topic Pointers");
    expect(rawMemory).toContain("- new-topic → memory/topics/new-topic.md");
    expect(rawMemory).toContain("- User Profile → memory/topics/user-profile.md");
    expect(rawMemory).not.toContain("## Recent Sessions");
    expect(rawMemory).toContain("## 👤 User");
  });

  it("feedback type routes to 💬 Key Feedback inline section", async () => {
    ws = await createTempWorkspace();
    nodeFs = createNodeFsAdapter();
    tm = new TopicManager({ workspaceDir: ws, fs: nodeFs });
    idx = new MemoryIndexManager({ workspaceDir: ws, fs: nodeFs });

    await simulateHookWrite(
      "assistant-feedback",
      "User said responses are too verbose and wants shorter answers",
      "feedback",
      ["Reduce response length to 2-3 sentences max"],
      "2026-05-11",
    );

    const rawMemory = await fs.readFile(join(ws, "MEMORY.md"), "utf-8");
    expect(rawMemory).toContain("## 💬 Key Feedback");
    expect(rawMemory).toContain("too verbose");
    expect(rawMemory).toContain("Decision: Reduce response length");

    const index = await idx.readIndex();
    const feedbackSection = index.inlineSections!.find((s) => s.section === "💬 Key Feedback");
    expect(feedbackSection).toBeDefined();
  });
});
