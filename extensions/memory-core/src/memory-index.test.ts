import { describe, it, expect, beforeEach } from "vitest";
import {
  MemoryIndexManager,
  parseMemoryIndex,
  type MemoryIndexDeps,
  type MemoryIndex,
  type MemoryIndexSection,
  type RecentSession,
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
        if (content === undefined) throw new Error(`ENOENT: ${path}`);
        return content;
      },
      writeFile: async (path: string, data: string) => {
        files.set(path, data);
      },
      mkdir: async (_path: string, _options: { recursive: boolean }) => {},
      rename: async (oldPath: string, newPath: string) => {
        const content = files.get(oldPath);
        if (content === undefined) throw new Error(`ENOENT: ${oldPath}`);
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
        recentSessions: [
          { date: "2026-04-24", title: "Session", topicPath: "memory/topics/s.md" },
        ],
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
      expect(result).toContain("Project uses PostgreSQL");    });

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
});
