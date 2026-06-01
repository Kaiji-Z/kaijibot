import { describe, it, expect } from "vitest";
import {
  MemoryIndexManager,
  parseMemoryIndex,
  parseMemoryIndexDiagnostic,
  getCanonicalSectionOrder,
  type MemoryIndexDeps,
  type MemoryIndex,
} from "./memory-index.js";

function createMemoryFs(): {
  files: Map<string, string>;
  deps: MemoryIndexDeps["fs"];
} {
  const files = new Map<string, string>();

  return {
    files,
    deps: {
      readFile: async (path: string) => {
        const content = files.get(path);
        if (content === undefined) {throw new Error(`ENOENT: ${path}`);}
        return content;
      },
      writeFile: async (path: string, data: string) => {
        files.set(path, data);
      },
      mkdir: async (_path: string, _options: { recursive: boolean }) => {},
      rename: async (oldPath: string, newPath: string) => {
        const content = files.get(oldPath);
        if (content === undefined) {throw new Error(`ENOENT: ${oldPath}`);}
        files.delete(oldPath);
        files.set(newPath, content);
      },
    },
  };
}

function createManager(workspaceDir = "/test-workspace"): {
  manager: MemoryIndexManager;
  memFs: ReturnType<typeof createMemoryFs>;
} {
  const memFs = createMemoryFs();
  const manager = new MemoryIndexManager({
    workspaceDir,
    fs: memFs.deps,
  });
  return { manager, memFs };
}

const SAMPLE_NEW_FORMAT = `# Long-Term Memory Index

## 用户画像
→ memory/topics/user-profile.md
Prefers concise replies. Works in distributed systems.

## 反馈记录
→ memory/topics/feedback.md
F001: Don't auto-push tech news

## Recent Sessions
- 2026-04-24 记忆系统重设计 → memory/topics/memory-redesign.md
- 2026-04-23 认知洞察修复 → memory/topics/insight-pipeline-fix.md

## Promoted From Short-Term Memory (legacy)
- Old promoted item 1
- Old promoted item 2
`;

describe("parseMemoryIndex", () => {
  it("parses sections, recent sessions, and promoted content", () => {
    const index = parseMemoryIndex(SAMPLE_NEW_FORMAT);
    expect(index.sections).toHaveLength(2);
    expect(index.sections[0]!.subject).toBe("");
    expect(index.sections[0]!.title).toBe("用户画像");
    expect(index.sections[0]!.topicFile).toBe("memory/topics/user-profile.md");
    expect(index.sections[1]!.title).toBe("反馈记录");
    expect(index.recentSessions).toHaveLength(2);
    expect(index.recentSessions[0]!.date).toBe("2026-04-24");
    expect(index.recentSessions[0]!.title).toBe("记忆系统重设计");
    expect(index.promotedContent).toContain("Old promoted item 1");
    expect(index.promotedContent).toContain("Old promoted item 2");
  });

  it("handles empty content", () => {
    const index = parseMemoryIndex("");
    expect(index.sections).toHaveLength(0);
    expect(index.recentSessions).toHaveLength(0);
    expect(index.promotedContent).toBe("");
  });

  it("handles content with only promoted section", () => {
    const md = "## Promoted From Short-Term Memory\n\n- Item A\n- Item B\n";
    const index = parseMemoryIndex(md);
    expect(index.sections).toHaveLength(0);
    expect(index.promotedContent).toContain("Item A");
    expect(index.promotedContent).toContain("Item B");
  });

  it("parses multiple topic sections", () => {
    const md = [
      "# Long-Term Memory Index",
      "",
      "## U",
      "→ memory/topics/user-profile.md",
      "User info",
      "",
      "## F",
      "→ memory/topics/feedback.md",
      "Feedback info",
      "",
      "## P",
      "→ memory/topics/project-decisions.md",
      "Project info",
      "",
      "## R",
      "→ memory/topics/reference.md",
      "Reference info",
    ].join("\n");
    const index = parseMemoryIndex(md);
    expect(index.sections).toHaveLength(4);
    expect(index.sections.map((s) => s.title)).toEqual(["U", "F", "P", "R"]);
  });
});

describe("MemoryIndexManager", () => {
  describe("readIndex + writeIndex", () => {
    it("round-trips an index", async () => {
      const { manager } = createManager();
      const index: MemoryIndex = {
        sections: [
          {
            subject: "user",
            title: "用户画像",
            topicFile: "memory/topics/user-profile.md",
            summary: "Test summary",
          },
        ],
        recentSessions: [{ date: "2026-04-24", title: "Session", topicPath: "memory/topics/s.md" }],
        promotedContent: "## Promoted From Short-Term Memory\n\n- Legacy\n",
      };
      await manager.writeIndex(index);
      const read = await manager.readIndex();
      expect(read.sections).toHaveLength(1);
      expect(read.sections[0]!.title).toBe("用户画像");
      expect(read.sections[0]!.topicFile).toBe("memory/topics/user-profile.md");
      // Recent Sessions are no longer serialized
      expect(read.recentSessions).toHaveLength(0);
      expect(read.promotedContent).toContain("Legacy");
    });

    it("returns empty index when file does not exist", async () => {
      const { manager } = createManager();
      const index = await manager.readIndex();
      expect(index.sections).toHaveLength(0);
      expect(index.promotedContent).toBe("");
    });
  });

  describe("updateSection", () => {
    it("adds a new section", async () => {
      const { manager } = createManager();
      await manager.updateSection({
        subject: "user",
        title: "User Profile",
        topicFile: "memory/topics/user-profile.md",
        summary: "Basic user info",
      });
      const index = await manager.readIndex();
      expect(index.sections).toHaveLength(1);
      expect(index.sections[0]!.title).toBe("User Profile");
      expect(index.sections[0]!.topicFile).toBe("memory/topics/user-profile.md");
    });

    it("updates existing section by topicFile", async () => {
      const { manager } = createManager();
      await manager.updateSection({
        subject: "user",
        title: "Old Title",
        topicFile: "memory/topics/user-profile.md",
        summary: "Old",
      });
      await manager.updateSection({
        subject: "user",
        title: "New Title",
        topicFile: "memory/topics/user-profile.md",
        summary: "Updated summary",
      });
      const index = await manager.readIndex();
      expect(index.sections).toHaveLength(1);
      expect(index.sections[0]!.title).toBe("New Title");
      // Summary is not preserved in flat Topic Pointers format
    });
  });

  describe("addRecentSession", () => {
    it("prepends session to in-memory index (not serialized)", async () => {
      const { manager, memFs } = createManager();
      await manager.addRecentSession({
        date: "2026-04-23",
        title: "First",
        topicPath: "memory/topics/first.md",
      });
      await manager.addRecentSession({
        date: "2026-04-24",
        title: "Second",
        topicPath: "memory/topics/second.md",
      });
      // Recent Sessions are no longer serialized — readIndex won't find them
      const index = await manager.readIndex();
      expect(index.recentSessions).toHaveLength(0);
      // Verify file does not contain Recent Sessions heading
      const fileContent = memFs.files.get("/test-workspace/MEMORY.md") ?? "";
      expect(fileContent).not.toContain("## Recent Sessions");
    });
  });

  describe("rebalanceIndex", () => {
    it("removes oldest sections when exceeding budget", async () => {
      const { manager } = createManager();
      for (let i = 0; i < 10; i++) {
        await manager.updateSection({
          subject: "reference",
          title: `Ref ${i}`,
          topicFile: `memory/topics/ref-${i}.md`,
          summary: `Summary for ref ${i} with some padding content to make it larger`,
        });
      }
      const beforeRebalance = await manager.readIndex();
      expect(beforeRebalance.sections).toHaveLength(10);

      await manager.rebalanceIndex(200);

      const afterRebalance = await manager.readIndex();
      expect(afterRebalance.sections.length).toBeLessThan(10);
      expect(afterRebalance.sections.length).toBeGreaterThan(0);
    });

    it("never truncates promoted content", async () => {
      const { manager } = createManager();
      const longPromoted = "## Promoted From Short-Term Memory\n\n" + "x".repeat(5000);
      const index: MemoryIndex = {
        sections: [
          {
            subject: "user",
            title: "U",
            topicFile: "memory/topics/u.md",
            summary: "S",
          },
        ],
        recentSessions: [],
        promotedContent: longPromoted,
      };
      await manager.writeIndex(index);

      await manager.rebalanceIndex(100);

      const result = await manager.readIndex();
      expect(result.promotedContent).toContain("x".repeat(5000));
    });

    it("does nothing when under budget", async () => {
      const { manager } = createManager();
      await manager.updateSection({
        subject: "user",
        title: "Small",
        topicFile: "memory/topics/u.md",
        summary: "Tiny",
      });
      const before = await manager.readIndex();

      await manager.rebalanceIndex(50000);

      const after = await manager.readIndex();
      expect(after.sections).toHaveLength(before.sections.length);
    });
  });

  describe("relocateInlineToTopic dedup", () => {
    it("skips duplicate lines during relocation", async () => {
      const { manager, memFs } = createManager();
      const topicPath = "/test-workspace/memory/topics/user.md";

      // Pre-populate topic file with an entry whose content matches the inline line
      const topicContent = [
        "---",
        "subject: user",
        "created: 2026-05-20",
        "updated: 2026-05-20",
        "entries: 1",
        "---",
        "",
        "## Dark mode preference (2026-05-20)",
        "",
        "User prefers dark mode",
      ].join("\n");
      memFs.files.set(topicPath, topicContent);

      // Inline section with a dated variant that strips to "User prefers dark mode"
      await manager.relocateInlineToTopic(
        { section: "⚡ Core Memory", lines: ["- 2026-05-25: User prefers dark mode"] },
        "user",
      );

      const result = memFs.files.get(topicPath) ?? "";
      // The duplicate line should NOT appear in the appended content
      expect(result).not.toContain("## ⚡ Core Memory (relocated from MEMORY.md)");
    });

    it("keeps unique lines during relocation", async () => {
      const { manager, memFs } = createManager();
      const topicPath = "/test-workspace/memory/topics/user.md";

      // Topic file has a different entry
      const topicContent = [
        "---",
        "subject: user",
        "created: 2026-05-20",
        "updated: 2026-05-20",
        "entries: 1",
        "---",
        "",
        "## Rust knowledge (2026-05-20)",
        "",
        "User knows Rust",
      ].join("\n");
      memFs.files.set(topicPath, topicContent);

      // Inline section with unique content
      await manager.relocateInlineToTopic(
        { section: "⚡ Core Memory", lines: ["- 2026-05-25: User prefers dark mode"] },
        "user",
      );

      const result = memFs.files.get(topicPath) ?? "";
      // The unique line should be preserved
      expect(result).toContain("- 2026-05-25: User prefers dark mode");
      // Existing content still there
      expect(result).toContain("User knows Rust");
    });

    it("does not write when all lines are duplicates", async () => {
      const { manager, memFs } = createManager();
      const topicPath = "/test-workspace/memory/topics/user.md";

      // Topic file has entries matching all inline lines
      const topicContent = [
        "---",
        "subject: user",
        "created: 2026-05-20",
        "updated: 2026-05-20",
        "entries: 2",
        "---",
        "",
        "## Dark mode (2026-05-20)",
        "",
        "User prefers dark mode",
        "",
        "## Rust knowledge (2026-05-20)",
        "",
        "User knows Rust",
      ].join("\n");
      memFs.files.set(topicPath, topicContent);
      const originalContent = topicContent;

      // Inline lines that both match existing entries after date prefix stripping
      await manager.relocateInlineToTopic(
        {
          section: "⚡ Core Memory",
          lines: ["- 2026-05-25: User prefers dark mode", "- 2026-05-25: User knows Rust"],
        },
        "user",
      );

      // Topic file content should be unchanged — no relocate header appended
      const result = memFs.files.get(topicPath) ?? "";
      expect(result).toBe(originalContent);
    });
  });

  describe("migrateLegacy", () => {
    it("wraps old content in promoted section", async () => {
      const legacy = "- User prefers dark mode\n- Project uses PostgreSQL\n";
      const result = await new MemoryIndexManager({
        workspaceDir: "/test",
        fs: createMemoryFs().deps,
      }).migrateLegacy(legacy);
      expect(result).toContain("# Long-Term Memory");
      expect(result).toContain("## Promoted From Short-Term Memory (legacy)");
      expect(result).toContain("User prefers dark mode");
      expect(result).toContain("Project uses PostgreSQL");
    });

    it("does not modify new-format content", async () => {
      const result = await new MemoryIndexManager({
        workspaceDir: "/test",
        fs: createMemoryFs().deps,
      }).migrateLegacy(SAMPLE_NEW_FORMAT);
      expect(result).toBe(SAMPLE_NEW_FORMAT);
    });

    it("returns empty string unchanged", async () => {
      const result = await new MemoryIndexManager({
        workspaceDir: "/test",
        fs: createMemoryFs().deps,
      }).migrateLegacy("");
      expect(result).toBe("");
    });
  });

  describe("legacy section migration", () => {
    it("parses old 4-section MEMORY.md into 2 new sections", () => {
      const oldFormat = [
        "# Long-Term Memory",
        "",
        "## 👤 User",
        "- Timezone: UTC+8",
        "- Language: zh-CN",
        "",
        "## 💬 Key Feedback",
        "- Wants shorter answers",
        "",
        "## 🎯 Active Focus",
        "- Working on memory system redesign",
        "",
        "## 🔗 Reference",
        "- Vitest for testing",
        "",
      ].join("\n");

      const index = parseMemoryIndex(oldFormat);

      expect(index.inlineSections).toBeDefined();
      const coreMemory = index.inlineSections!.find((s) => s.section === "⚡ Core Memory");
      expect(coreMemory).toBeDefined();
      expect(coreMemory!.lines).toContain("- Timezone: UTC+8");
      expect(coreMemory!.lines).toContain("- Wants shorter answers");
      expect(coreMemory!.lines).toContain("- Vitest for testing");

      const activeContext = index.inlineSections!.find((s) => s.section === "🔥 Active Context");
      expect(activeContext).toBeDefined();
      expect(activeContext!.lines).toContain("- Working on memory system redesign");
    });

    it("handles mixed old and new sections", () => {
      const mixed = [
        "# Long-Term Memory",
        "",
        "## 👤 User",
        "- Old user info",
        "",
        "## ⚡ Core Memory",
        "- New core info",
        "",
        "## 🔗 Reference",
        "- Old reference",
        "",
        "## 🔥 Active Context",
        "- New active context",
        "",
      ].join("\n");

      const index = parseMemoryIndex(mixed);

      const coreMemory = index.inlineSections!.find((s) => s.section === "⚡ Core Memory");
      expect(coreMemory).toBeDefined();
      expect(coreMemory!.lines).toContain("- Old user info");
      expect(coreMemory!.lines).toContain("- New core info");
      expect(coreMemory!.lines).toContain("- Old reference");

      const activeContext = index.inlineSections!.find((s) => s.section === "🔥 Active Context");
      expect(activeContext).toBeDefined();
      expect(activeContext!.lines).toContain("- New active context");
    });

    it("round-trips new format correctly", async () => {
      const { manager, memFs } = createManager();
      const index: MemoryIndex = {
        sections: [
          {
            subject: "user",
            title: "User Profile",
            topicFile: "memory/topics/user-profile.md",
            summary: "",
          },
        ],
        recentSessions: [],
        promotedContent: "",
        inlineSections: [
          { section: "⚡ Core Memory", lines: ["- Timezone: UTC+8", "- Language: zh-CN"] },
          { section: "🔥 Active Context", lines: ["- Working on redesign"] },
        ],
      };
      await manager.writeIndex(index);

      const read = await manager.readIndex();
      expect(read.inlineSections).toHaveLength(2);
      expect(read.inlineSections![0]!.section).toBe("⚡ Core Memory");
      expect(read.inlineSections![0]!.lines).toContain("- Timezone: UTC+8");
      expect(read.inlineSections![1]!.section).toBe("🔥 Active Context");
      expect(read.inlineSections![1]!.lines).toContain("- Working on redesign");

      await manager.writeIndex(read);
      const read2 = await manager.readIndex();
      expect(read2.inlineSections).toEqual(read.inlineSections);

      const raw = memFs.files.get("/test-workspace/MEMORY.md") ?? "";
      expect(raw).toContain("## ⚡ Core Memory");
      expect(raw).toContain("## 🔥 Active Context");
      expect(raw).not.toContain("## 👤 User");
      expect(raw).not.toContain("## 💬 Key Feedback");
    });
  });
});

describe("parseMemoryIndexDiagnostic", () => {
  it("returns no diagnostics for clean MEMORY.md", () => {
    const clean = [
      "# Long-Term Memory",
      "",
      "## ⚡ Core Memory",
      "- Timezone: UTC+8",
      "- Language: zh-CN",
      "",
      "## 🔥 Active Context",
      "- Working on memory system redesign",
      "",
      "## Topic Pointers",
      "- User Profile → memory/topics/user.md",
      "",
    ].join("\n");

    const diag = parseMemoryIndexDiagnostic(clean);
    expect(diag.unknownHeadings).toHaveLength(0);
    expect(diag.orphanLines).toHaveLength(0);
    expect(diag.duplicateHeadings).toHaveLength(0);
    expect(diag.legacyHeadings).toHaveLength(0);
    expect(diag.inlineSections).toHaveLength(2);
    expect(diag.sections).toHaveLength(1);
  });

  it("detects unknown headings with content", () => {
    const md = [
      "# Long-Term Memory",
      "",
      "## ⚡ Core Memory",
      "- Core info",
      "",
      "## 🐛 Debug Notes",
      "- Some debug info",
      "- More debug lines",
      "",
      "## Topic Pointers",
      "- Foo → memory/topics/foo.md",
      "",
    ].join("\n");

    const diag = parseMemoryIndexDiagnostic(md);
    expect(diag.unknownHeadings).toHaveLength(1);
    expect(diag.unknownHeadings[0]!.heading).toBe("🐛 Debug Notes");
    expect(diag.unknownHeadings[0]!.line).toBe(6);
    expect(diag.unknownHeadings[0]!.lines).toContain("- Some debug info");
    expect(diag.unknownHeadings[0]!.lines).toContain("- More debug lines");
  });

  it("detects orphan lines between sections", () => {
    const md = [
      "# Long-Term Memory",
      "",
      "orphan line before any section",
      "",
      "## ⚡ Core Memory",
      "- Core info",
      "",
    ].join("\n");

    const diag = parseMemoryIndexDiagnostic(md);
    expect(diag.orphanLines.length).toBeGreaterThanOrEqual(1);
    expect(diag.orphanLines.some((o) => o.content === "orphan line before any section")).toBe(true);
  });

  it("detects legacy headings", () => {
    const md = [
      "# Long-Term Memory",
      "",
      "## 👤 User",
      "- Old user info",
      "",
      "## ⚡ Core Memory",
      "- New core info",
      "",
    ].join("\n");

    const diag = parseMemoryIndexDiagnostic(md);
    expect(diag.legacyHeadings).toHaveLength(1);
    expect(diag.legacyHeadings[0]!.original).toBe("👤 User");
    expect(diag.legacyHeadings[0]!.mappedTo).toBe("⚡ Core Memory");
    expect(diag.legacyHeadings[0]!.line).toBe(3);
  });

  it("detects duplicate headings", () => {
    const md = [
      "# Long-Term Memory",
      "",
      "## ⚡ Core Memory",
      "- First core",
      "",
      "## ⚡ Core Memory",
      "- Second core",
      "",
    ].join("\n");

    const diag = parseMemoryIndexDiagnostic(md);
    expect(diag.duplicateHeadings).toHaveLength(1);
    expect(diag.duplicateHeadings[0]!.heading).toBe("⚡ Core Memory");
    expect(diag.duplicateHeadings[0]!.occurrences).toBe(2);
  });

  it("detects mixed diagnostics: unknown + legacy + orphan", () => {
    const md = [
      "# Long-Term Memory",
      "",
      "orphan before sections",
      "",
      "## 👤 User",
      "- Legacy user info",
      "",
      "## ⚡ Core Memory",
      "- Core info",
      "",
      "## 🐛 Debug",
      "- Debug line",
      "",
      "## 🔥 Active Context",
      "- Active info",
      "",
    ].join("\n");

    const diag = parseMemoryIndexDiagnostic(md);
    expect(diag.orphanLines.length).toBeGreaterThanOrEqual(1);
    expect(diag.orphanLines.some((o) => o.content === "orphan before sections")).toBe(true);
    expect(diag.legacyHeadings).toHaveLength(1);
    expect(diag.legacyHeadings[0]!.original).toBe("👤 User");
    expect(diag.unknownHeadings).toHaveLength(1);
    expect(diag.unknownHeadings[0]!.heading).toBe("🐛 Debug");
  });
});

describe("getCanonicalSectionOrder", () => {
  it("returns the canonical order", () => {
    const order = getCanonicalSectionOrder();
    expect(order).toEqual(["⚡ Core Memory", "🔥 Active Context", "Topic Pointers"]);
  });
});

// ---------------------------------------------------------------------------
// Regression: rebalanceIndex must preserve at least one inline section (Bug 3)
// ---------------------------------------------------------------------------

describe("rebalanceIndex preserves at least one inline section", () => {
  it("never evicts all inline sections even when far over budget", async () => {
    const { manager } = createManager();
    const index: MemoryIndex = {
      sections: [],
      recentSessions: [],
      promotedContent: "",
      inlineSections: [
        {
          section: "⚡ Core Memory",
          lines: Array.from({ length: 50 }, (_, i) => `- Core line ${i} with padding`.repeat(3)),
        },
        {
          section: "🔥 Active Context",
          lines: Array.from({ length: 50 }, (_, i) => `- Active line ${i} with padding`.repeat(3)),
        },
      ],
    };
    await manager.writeIndex(index);

    const written = await manager.readIndex();
    const raw = (await createManager().manager.readIndex());
    // Confirm data was written
    expect(written.inlineSections!.length).toBe(2);

    // Rebalance with a tiny budget
    await manager.rebalanceIndex(50);

    const after = await manager.readIndex();
    expect(after.inlineSections!.length).toBeGreaterThanOrEqual(1);
  });
});
