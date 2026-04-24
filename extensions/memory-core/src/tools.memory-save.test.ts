import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  type LlmDecideFn,
  computeMaxSimilarity,
  createMemorySaveTool,
  deriveEntryTitle,
  resolveSelfEditDecision,
} from "./tools.memory-save.js";
import {
  resetMemoryToolMockState,
  setMemoryWorkspaceDir,
} from "./memory-tool-manager-mock.js";
import { type TopicEntry } from "./topic-types.js";

// ---------------------------------------------------------------------------
// Temp directory for integration tests
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  const dir = await mkdir(path.join(os.tmpdir(), `ms-test-${Date.now()}`), {
    recursive: true,
  });
  tempDir = dir ?? "";
  resetMemoryToolMockState();
  setMemoryWorkspaceDir(tempDir);
});

afterEach(async () => {
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

// ---------------------------------------------------------------------------
// Helper: parse JSON result from tool execute
// ---------------------------------------------------------------------------

function parseResult(raw: unknown): Record<string, unknown> {
  const r = raw as { details: unknown };
  return r.details as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe("computeMaxSimilarity", () => {
  it("returns 0 and -1 idx for empty entries", () => {
    const result = computeMaxSimilarity("hello world", []);
    expect(result).toEqual({ maxSim: 0, maxSimIdx: -1 });
  });

  it("returns high similarity for near-duplicate content", () => {
    const entries: TopicEntry[] = [
      {
        title: "test",
        date: "2026-01-01",
        content: "The user prefers dark mode in their editor and uses VSCode",
      },
    ];
    const result = computeMaxSimilarity(
      "The user prefers dark mode in their editor and uses VSCode daily",
      entries,
    );
    expect(result.maxSim).toBeGreaterThanOrEqual(0.8);
    expect(result.maxSimIdx).toBe(0);
  });

  it("returns low similarity for unrelated content", () => {
    const entries: TopicEntry[] = [
      {
        title: "test",
        date: "2026-01-01",
        content: "Database migration completed to PostgreSQL 16",
      },
    ];
    const result = computeMaxSimilarity(
      "User likes hiking on weekends",
      entries,
    );
    expect(result.maxSim).toBeLessThan(0.3);
  });

  it("picks the highest similarity among multiple entries", () => {
    const entries: TopicEntry[] = [
      {
        title: "a",
        date: "2026-01-01",
        content: "Completely unrelated database schema notes",
      },
      {
        title: "b",
        date: "2026-01-02",
        content: "User prefers dark mode for coding",
      },
      {
        title: "c",
        date: "2026-01-03",
        content: "Meeting notes from standup",
      },
    ];
    const result = computeMaxSimilarity(
      "User prefers dark mode for coding at night",
      entries,
    );
    expect(result.maxSimIdx).toBe(1);
    expect(result.maxSim).toBeGreaterThanOrEqual(0.7);
  });
});

describe("resolveSelfEditDecision", () => {
  it("defaults to append_new when no LLM caller provided", async () => {
    const decision = await resolveSelfEditDecision(undefined, "old", "new");
    expect(decision).toBe("append_new");
  });

  it("delegates to the LLM caller", async () => {
    let called = false;
    let receivedExisting = "";
    let receivedNew = "";
    const llmDecide: LlmDecideFn = async (existing, newContent) => {
      called = true;
      receivedExisting = existing;
      receivedNew = newContent;
      return "replace_existing";
    };
    const decision = await resolveSelfEditDecision(llmDecide, "old content", "new content");
    expect(decision).toBe("replace_existing");
    expect(called).toBe(true);
    expect(receivedExisting).toBe("old content");
    expect(receivedNew).toBe("new content");
  });

  it("falls back to append_new on LLM timeout", async () => {
    const llmDecide: LlmDecideFn = () =>
      new Promise((resolve) => setTimeout(() => resolve("merge"), 60_000));
    const decision = await resolveSelfEditDecision(llmDecide, "old", "new");
    expect(decision).toBe("append_new");
  });

  it("falls back to append_new on LLM error", async () => {
    const llmDecide: LlmDecideFn = async () => {
      throw new Error("LLM unavailable");
    };
    const decision = await resolveSelfEditDecision(llmDecide, "old", "new");
    expect(decision).toBe("append_new");
  });
});

describe("deriveEntryTitle", () => {
  it("uses first 50 chars as title", () => {
    const content = "A".repeat(100);
    expect(deriveEntryTitle(content)).toBe("A".repeat(50));
  });

  it("replaces newlines with spaces", () => {
    expect(deriveEntryTitle("hello\nworld\nfoo")).toBe("hello world foo");
  });

  it("returns Untitled for empty content", () => {
    expect(deriveEntryTitle("")).toBe("Untitled");
  });
});

// ---------------------------------------------------------------------------
// Tool integration tests
// ---------------------------------------------------------------------------

describe("memory_save tool", () => {
  it("routes type=user to user-profile.md", async () => {
    const tool = createMemorySaveTool({
      config: {
        agents: { list: [{ id: "main", default: true }] },
      } as never,
    });
    expect(tool).not.toBeNull();
    const raw = await tool!.execute("tc-1", {
      content: "User prefers dark mode",
      type: "user",
    });
    const result = parseResult(raw);
    expect(result.topicFile).toBe("user-profile.md");
    expect(result.path).toBe("memory/topics/user-profile.md");
    expect(result.action).toBe("created");
  });

  it("routes type=feedback to feedback.md", async () => {
    const tool = createMemorySaveTool({
      config: {
        agents: { list: [{ id: "main", default: true }] },
      } as never,
    });
    const raw = await tool!.execute("tc-2", {
      content: "User said to always check docs first",
      type: "feedback",
    });
    const result = parseResult(raw);
    expect(result.topicFile).toBe("feedback.md");
  });

  it("routes type=project to project-decisions.md", async () => {
    const tool = createMemorySaveTool({
      config: {
        agents: { list: [{ id: "main", default: true }] },
      } as never,
    });
    const raw = await tool!.execute("tc-3", {
      content: "Decided to use PostgreSQL for the main DB",
      type: "project",
    });
    const result = parseResult(raw);
    expect(result.topicFile).toBe("project-decisions.md");
  });

  it("routes type=reference to reference.md", async () => {
    const tool = createMemorySaveTool({
      config: {
        agents: { list: [{ id: "main", default: true }] },
      } as never,
    });
    const raw = await tool!.execute("tc-4", {
      content: "API endpoint: https://api.example.com/v2",
      type: "reference",
    });
    const result = parseResult(raw);
    expect(result.topicFile).toBe("reference.md");
  });

  it("custom topic param overrides default routing", async () => {
    const tool = createMemorySaveTool({
      config: {
        agents: { list: [{ id: "main", default: true }] },
      } as never,
    });
    const raw = await tool!.execute("tc-5", {
      content: "Custom topic content",
      type: "user",
      topic: "my-custom-notes",
    });
    const result = parseResult(raw);
    expect(result.topicFile).toBe("my-custom-notes.md");
    expect(result.path).toBe("memory/topics/my-custom-notes.md");
  });

  it("appends without LLM call when similarity < 0.8", async () => {
    const tool = createMemorySaveTool({
      config: {
        agents: { list: [{ id: "main", default: true }] },
      } as never,
    });

    // First save
    await tool!.execute("tc-6a", {
      content: "Database migration completed to PostgreSQL 16",
      type: "project",
    });

    // Second save — unrelated content
    const raw = await tool!.execute("tc-6b", {
      content: "User prefers light theme in the terminal",
      type: "user",
    });
    const result = parseResult(raw);
    expect(result.action).toBe("created");
  });

  it("calls LLM for decision when similarity >= 0.8", async () => {
    let llmCalled = false;
    const llmDecide: LlmDecideFn = async () => {
      llmCalled = true;
      return "replace_existing";
    };

    const tool = createMemorySaveTool({
      config: {
        agents: { list: [{ id: "main", default: true }] },
      } as never,
      llmDecide,
    });

    // First save
    const existingContent = "User prefers dark mode in their editor and uses VSCode for development";
    await tool!.execute("tc-7a", {
      content: existingContent,
      type: "user",
    });

    // Second save — near-duplicate
    const newContent = "User prefers dark mode in their editor and uses VSCode for development daily";
    const raw = await tool!.execute("tc-7b", {
      content: newContent,
      type: "user",
    });

    expect(llmCalled).toBe(true);
    const result = parseResult(raw);
    expect(result.action).toBe("updated");
  });

  it("defaults to append_new on LLM timeout", async () => {
    const llmDecide: LlmDecideFn = () =>
      new Promise((resolve) => setTimeout(() => resolve("merge"), 60_000));

    const tool = createMemorySaveTool({
      config: {
        agents: { list: [{ id: "main", default: true }] },
      } as never,
      llmDecide,
    });

    const content = "User prefers dark mode in their editor and uses VSCode for development";
    await tool!.execute("tc-8a", {
      content,
      type: "user",
    });

    const raw = await tool!.execute("tc-8b", {
      content: `${content} daily`,
      type: "user",
    });

    const result = parseResult(raw);
    expect(result.action).toBe("created");
  });

  it("defaults importance to normal when not specified", async () => {
    const tool = createMemorySaveTool({
      config: {
        agents: { list: [{ id: "main", default: true }] },
      } as never,
    });
    const raw = await tool!.execute("tc-9", {
      content: "Some content",
      type: "reference",
    });
    const result = parseResult(raw);
    expect(result.importance).toBe("normal");
  });

  it("passes through importance=high", async () => {
    const tool = createMemorySaveTool({
      config: {
        agents: { list: [{ id: "main", default: true }] },
      } as never,
    });
    const raw = await tool!.execute("tc-10", {
      content: "Critical user preference: never share data",
      type: "user",
      importance: "high",
    });
    const result = parseResult(raw);
    expect(result.importance).toBe("high");
  });

  it("writes topic file to disk with correct structure", async () => {
    const tool = createMemorySaveTool({
      config: {
        agents: { list: [{ id: "main", default: true }] },
      } as never,
    });
    await tool!.execute("tc-11", {
      content: "User timezone is UTC+8",
      type: "user",
    });

    const topicPath = path.join(tempDir, "memory", "topics", "user-profile.md");
    const content = await readFile(topicPath, "utf-8");
    expect(content).toContain("type: user");
    expect(content).toContain("User timezone is UTC+8");
  });

  it("updates MEMORY.md index after write", async () => {
    const tool = createMemorySaveTool({
      config: {
        agents: { list: [{ id: "main", default: true }] },
      } as never,
    });
    await tool!.execute("tc-12", {
      content: "Deployed v2.1 to production",
      type: "project",
    });

    const indexPath = path.join(tempDir, "MEMORY.md");
    const content = await readFile(indexPath, "utf-8");
    expect(content).toContain("Long-Term Memory Index");
    expect(content).toContain("project");
    expect(content).toContain("project decisions");
  });

  it("returns null when memory is not configured", () => {
    const tool = createMemorySaveTool({ config: undefined });
    expect(tool).toBeNull();
  });

  it("handles merge decision from LLM", async () => {
    const llmDecide: LlmDecideFn = async () => "merge";

    const tool = createMemorySaveTool({
      config: {
        agents: { list: [{ id: "main", default: true }] },
      } as never,
      llmDecide,
    });

    const base = "User prefers dark mode in their editor and uses VSCode for development";
    await tool!.execute("tc-13a", {
      content: base,
      type: "user",
    });

    const raw = await tool!.execute("tc-13b", {
      content: `${base} daily`,
      type: "user",
    });

    const result = parseResult(raw);
    expect(result.action).toBe("merged");
  });

  it("concurrent writes do not corrupt topic file", async () => {
    const tool = createMemorySaveTool({
      config: {
        agents: { list: [{ id: "main", default: true }] },
      } as never,
    });

    const writes = Array.from({ length: 5 }, (_, i) =>
      tool!.execute(`tc-concurrent-${i}`, {
        content: `Concurrent entry ${i}: user likes technology ${i}`,
        type: "reference",
      }),
    );

    const results = await Promise.all(writes);
    for (const raw of results) {
      const result = parseResult(raw);
      expect(result.topicFile).toBe("reference.md");
      expect(["created", "updated", "merged"]).toContain(result.action);
    }

    const topicPath = path.join(tempDir, "memory", "topics", "reference.md");
    const content = await readFile(topicPath, "utf-8");
    expect(content).toContain("type: reference");
  });
});
