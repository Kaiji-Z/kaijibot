import { describe, it, expect, beforeEach } from "vitest";
import { TopicManager, type TopicManagerDeps } from "./topic-manager.js";
import { type TopicEntry, parseTopicFile } from "./topic-types.js";

function createMemoryFs(): {
  files: Map<string, string>;
  deps: TopicManagerDeps["fs"];
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
      mkdir: async (_path: string, _options: { recursive: boolean }) => {
        // no-op for in-memory fs
      },
      readdir: async (path: string) => {
        const prefix = path.endsWith("/") ? path : `${path}/`;
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
      stat: async (path: string) => {
        const content = files.get(path);
        if (content === undefined) throw new Error(`ENOENT: ${path}`);
        return { mtimeMs: Date.now(), size: content.length };
      },
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
  manager: TopicManager;
  fs: ReturnType<typeof createMemoryFs>;
} {
  const memFs = createMemoryFs();
  const manager = new TopicManager({
    workspaceDir,
    fs: memFs.deps,
  });
  return { manager, fs: memFs };
}

describe("TopicManager", () => {
  describe("createTopic + getTopic", () => {
    it("creates and reads back an empty topic file", async () => {
      const { manager } = createManager();
      const topic = await manager.createTopic("user", "user-profile");
      expect(topic.frontmatter.subject).toBe("user");
      expect(topic.entries).toHaveLength(0);

      const read = await manager.getTopic("user-profile");
      expect(read).not.toBeNull();
      expect(read!.frontmatter.subject).toBe("user");
    });

    it("normalizes name with .md suffix", async () => {
      const { manager } = createManager();
      await manager.createTopic("feedback", "my-feedback.md");
      const read = await manager.getTopic("my-feedback");
      expect(read).not.toBeNull();
      expect(read!.frontmatter.subject).toBe("feedback");
    });

    it("returns null for non-existent topic", async () => {
      const { manager } = createManager();
      const read = await manager.getTopic("nonexistent");
      expect(read).toBeNull();
    });
  });

  describe("appendEntry", () => {
    it("appends an entry to existing topic", async () => {
      const { manager } = createManager();
      await manager.createTopic("user", "user-profile");

      const entry: TopicEntry = {
        title: "Prefers dark mode",
        date: "2026-04-24",
        content: "User explicitly prefers dark mode in IDE.",
        importance: "normal",
        source: "session-compact",
      };

      await manager.appendEntry("user-profile", entry);

      const topic = await manager.getTopic("user-profile");
      expect(topic!.entries).toHaveLength(1);
      expect(topic!.entries[0]!.title).toBe("Prefers dark mode");
      expect(topic!.entries[0]!.content).toBe("User explicitly prefers dark mode in IDE.");
      expect(topic!.frontmatter.entries).toBe(1);
    });

    it("throws if topic does not exist", async () => {
      const { manager } = createManager();
      await expect(
        manager.appendEntry("ghost", {
          title: "X",
          date: "2026-04-24",
          content: "Y",
        }),
      ).rejects.toThrow("Topic not found");
    });

    it("appends multiple entries", async () => {
      const { manager } = createManager();
      await manager.createTopic("feedback", "feedback");

      await manager.appendEntry("feedback", {
        title: "E1",
        date: "2026-04-20",
        content: "First",
      });
      await manager.appendEntry("feedback", {
        title: "E2",
        date: "2026-04-21",
        content: "Second",
      });

      const topic = await manager.getTopic("feedback");
      expect(topic!.entries).toHaveLength(2);
      expect(topic!.frontmatter.entries).toBe(2);
    });
  });

  describe("updateEntry", () => {
    it("updates entry content at given index", async () => {
      const { manager } = createManager();
      await manager.createTopic("user", "user-profile");
      await manager.appendEntry("user-profile", {
        title: "Original",
        date: "2026-04-20",
        content: "Old content",
      });

      await manager.updateEntry("user-profile", 0, "New content");

      const topic = await manager.getTopic("user-profile");
      expect(topic!.entries[0]!.content).toBe("New content");
      expect(topic!.entries[0]!.title).toBe("Original");
    });

    it("throws for out-of-range index", async () => {
      const { manager } = createManager();
      await manager.createTopic("user", "user-profile");
      await expect(manager.updateEntry("user-profile", 5, "x")).rejects.toThrow(
        "Entry index out of range",
      );
    });
  });

  describe("mergeEntries", () => {
    it("merges multiple entries into one", async () => {
      const { manager } = createManager();
      await manager.createTopic("user", "user-profile");
      await manager.appendEntry("user-profile", { title: "A", date: "2026-04-20", content: "AA" });
      await manager.appendEntry("user-profile", { title: "B", date: "2026-04-21", content: "BB" });
      await manager.appendEntry("user-profile", { title: "C", date: "2026-04-22", content: "CC" });

      await manager.mergeEntries("user-profile", [0, 2], "Merged A+C");

      const topic = await manager.getTopic("user-profile");
      expect(topic!.entries).toHaveLength(2);
      expect(topic!.entries[0]!.title).toBe("A");
      expect(topic!.entries[0]!.content).toBe("Merged A+C");
      expect(topic!.entries[1]!.title).toBe("B");
    });

    it("handles merging adjacent entries", async () => {
      const { manager } = createManager();
      await manager.createTopic("feedback", "feedback");
      await manager.appendEntry("feedback", { title: "X", date: "2026-04-20", content: "XX" });
      await manager.appendEntry("feedback", { title: "Y", date: "2026-04-21", content: "YY" });

      await manager.mergeEntries("feedback", [0, 1], "Combined XY");

      const topic = await manager.getTopic("feedback");
      expect(topic!.entries).toHaveLength(1);
      expect(topic!.entries[0]!.content).toBe("Combined XY");
    });
  });

  describe("listTopics", () => {
    it("lists created topics sorted", async () => {
      const { manager } = createManager();
      await manager.createTopic("feedback", "beta-feedback");
      await manager.createTopic("user", "alpha-user");

      const list = await manager.listTopics();
      expect(list).toEqual(["alpha-user.md", "beta-feedback.md"]);
    });

    it("returns empty array when no topics exist", async () => {
      const { manager } = createManager();
      const list = await manager.listTopics();
      expect(list).toEqual([]);
    });
  });

  describe("deleteTopic", () => {
    it("writes empty content for deleted topic", async () => {
      const { manager, fs } = createManager();
      await manager.createTopic("user", "temp-topic");
      await manager.deleteTopic("temp-topic");

      const topic = await manager.getTopic("temp-topic");
      // Empty content parses as empty topic
      expect(topic).not.toBeNull();
      expect(topic!.entries).toHaveLength(0);
    });
  });
});
