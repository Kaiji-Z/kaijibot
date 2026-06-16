import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { EvolutionEngine } from "./engine.js";
import { SkillLifecycleManager } from "./skill-lifecycle.js";
import { SkillPersistenceWriter } from "./skill-writer.js";
import { EvolutionStore } from "./store.js";
import type { EvolutionCandidate } from "./types.js";

let tempDir: string;
let store: EvolutionStore;
let engine: EvolutionEngine;
const AGENT = "main";

function makeCandidate(overrides: Partial<EvolutionCandidate> = {}): EvolutionCandidate {
  return {
    taskSummary: "test task",
    toolCalls: [],
    uniqueToolCount: 0,
    reasoningTurns: 0,
    durationMs: 0,
    domain: "test",
    ...overrides,
  };
}

const complexCandidate = makeCandidate({
  taskSummary: "Complex multi-step wiki operation",
  toolCalls: Array.from({ length: 15 }, (_, i) => `tool_${i}`),
  uniqueToolCount: 10,
  reasoningTurns: 12,
  durationMs: 400_000,
  domain: "feishu-wiki",
});

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kaijibot-engine-test-"));
  store = new EvolutionStore(tempDir);
  engine = new EvolutionEngine(store);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("EvolutionEngine", () => {
  it("generate() returns a SkillDraft", async () => {
    const draft = await engine.generate(complexCandidate);
    expect(draft.name).toBeTruthy();
    expect(draft.description).toBeTruthy();
    expect(draft.triggerPhrases.length).toBeGreaterThan(0);
    expect(draft.bodyMarkdown).toContain("## When to use");
  });

  describe("checkBeforeGenerate()", () => {
    it("returns shouldCreate:true when no lifecycle provided", async () => {
      const result = await engine.checkBeforeGenerate(complexCandidate);
      expect(result.shouldCreate).toBe(true);
      expect(result.existingSkill).toBeUndefined();
    });

    it("returns shouldCreate:false when similar skill exists", async () => {
      const writer = new SkillPersistenceWriter(tempDir);
      await writer.writeSkill({
        name: "feishu-wiki",
        description: "Complex multi-step wiki operation",
        triggerPhrases: ["wiki ops"],
        bodyMarkdown: "# Wiki Operations\n\nHandles wiki tasks.",
      });

      const lifecycle = new SkillLifecycleManager(writer);
      const candidate = makeCandidate({
        taskSummary: "Complex multi-step wiki operation",
        domain: "feishu-wiki",
        toolCalls: Array.from({ length: 10 }, (_, i) => `tool_${i}`),
        uniqueToolCount: 8,
        reasoningTurns: 10,
        durationMs: 300_000,
      });

      const result = await engine.checkBeforeGenerate(candidate, lifecycle);
      expect(result.shouldCreate).toBe(false);
      expect(result.existingSkill).toBe("feishu-wiki");
    });

    it("returns shouldCreate:true when no similar skill exists", async () => {
      const writer = new SkillPersistenceWriter(tempDir);
      await writer.writeSkill({
        name: "weather-forecast",
        description: "Get weather forecasts for cities",
        triggerPhrases: ["weather"],
        bodyMarkdown: "# Weather\n\nGets weather.",
      });

      const lifecycle = new SkillLifecycleManager(writer);
      const candidate = makeCandidate({
        taskSummary: "Complex multi-step wiki operation",
        domain: "feishu-wiki",
        toolCalls: Array.from({ length: 10 }, (_, i) => `tool_${i}`),
        uniqueToolCount: 8,
        reasoningTurns: 10,
        durationMs: 300_000,
      });

      const result = await engine.checkBeforeGenerate(candidate, lifecycle);
      expect(result.shouldCreate).toBe(true);
    });

    it("uses semantic dedup when deps and existingSkills provided", async () => {
      const writer = new SkillPersistenceWriter(tempDir);
      await writer.writeSkill({
        name: "feishu-wiki-archive",
        description: "Archive feishu wiki documents",
        triggerPhrases: ["archive"],
        bodyMarkdown: "# Archive\n\nArchives docs.",
      });

      const lifecycle = new SkillLifecycleManager(writer);
      const candidate = makeCandidate({
        taskSummary: "归档会议纪要到飞书知识库",
        domain: "feishu-wiki",
        toolCalls: Array.from({ length: 10 }, (_, i) => `tool_${i}`),
        uniqueToolCount: 8,
        reasoningTurns: 10,
        durationMs: 300_000,
      });

      const mockGenerateText = vi
        .fn()
        .mockResolvedValue(
          JSON.stringify({ duplicate: true, skillName: "feishu-wiki-archive", confidence: 0.9 }),
        );

      const result = await engine.checkBeforeGenerate(
        candidate,
        lifecycle,
        [{ name: "feishu-wiki-archive", description: "Archive feishu wiki documents" }],
        { generateText: mockGenerateText },
      );

      expect(result.shouldCreate).toBe(false);
      expect(result.existingSkill).toBe("feishu-wiki-archive");
      expect(mockGenerateText).toHaveBeenCalledTimes(1);
    });

    it("falls back to lexical dedup when no deps provided", async () => {
      const writer = new SkillPersistenceWriter(tempDir);
      await writer.writeSkill({
        name: "feishu-wiki-archive",
        description: "Archive feishu wiki documents automatically",
        triggerPhrases: ["archive"],
        bodyMarkdown: "# Archive\n\nArchives docs.",
      });

      const lifecycle = new SkillLifecycleManager(writer);
      const candidate = makeCandidate({
        taskSummary: "Archive feishu wiki documents with scheduling",
        domain: "feishu-wiki-archiver",
        toolCalls: Array.from({ length: 10 }, (_, i) => `tool_${i}`),
        uniqueToolCount: 8,
        reasoningTurns: 10,
        durationMs: 300_000,
      });

      const result = await engine.checkBeforeGenerate(candidate, lifecycle);
      expect(result.shouldCreate).toBe(false);
      expect(result.existingSkill).toBe("feishu-wiki-archive");
    });
  });
});

describe("EvolutionEngine.patchSkill", () => {
  let patchStore: EvolutionStore;
  let patchEngine: EvolutionEngine;
  let skillWriter: SkillPersistenceWriter;
  let patchTempDir: string;

  beforeEach(() => {
    patchTempDir = mkdtempSync(join(tmpdir(), "kaijibot-engine-patch-test-"));
    patchStore = new EvolutionStore(patchTempDir);
    patchEngine = new EvolutionEngine(patchStore);
    skillWriter = new SkillPersistenceWriter(patchTempDir);
  });

  afterEach(() => {
    rmSync(patchTempDir, { recursive: true, force: true });
  });

  it("returns error for nonexistent skill", async () => {
    const result = await patchEngine.patchSkill(
      { name: "ghost", instructions: "update it" },
      { generateText: async () => "", writer: skillWriter },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Skill not found");
    }
  });

  it("calls LLM and writes updated content on success", async () => {
    await skillWriter.writeSkill({
      name: "existing-skill",
      description: "Old desc",
      triggerPhrases: ["old trigger"],
      bodyMarkdown: "## Old Body",
    });

    const updatedMarkdown =
      '---\nname: existing-skill\ndescription: "New desc"\nmetadata:\n  kaijibot:\n    generated: true\n    version: 1\n---\n\n## New Body\n\nUpdated content.';

    const mockGenerateText = async (_prompt: string) => updatedMarkdown;

    const result = await patchEngine.patchSkill(
      { name: "existing-skill", instructions: "Update the body" },
      { generateText: mockGenerateText, writer: skillWriter },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updatedPath).toContain("existing-skill");
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(result.updatedPath, "utf-8");
      expect(content).toContain("New Body");
    }
  });

  it("returns ok:true with updatedPath", async () => {
    await skillWriter.writeSkill({
      name: "path-test",
      description: "Test",
      triggerPhrases: [],
      bodyMarkdown: "Body",
    });

    const result = await patchEngine.patchSkill(
      { name: "path-test", instructions: "no-op" },
      {
        generateText: async () =>
          '---\nname: path-test\ndescription: "Test"\nmetadata:\n  kaijibot:\n    generated: true\n    version: 1\n---\n\nBody',
        writer: skillWriter,
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updatedPath).toContain("path-test");
      expect(result.updatedPath).toContain("SKILL.md");
    }
  });
});
