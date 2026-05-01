import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvolutionStore } from "./store.js";
import { EvolutionEngine } from "./engine.js";
import { SkillPersistenceWriter } from "./skill-writer.js";
import { SkillLifecycleManager } from "./skill-lifecycle.js";
import type { EvolutionCandidate, EvolutionRecord } from "./types.js";
import { DEFAULT_EVOLUTION_CONFIG } from "./types.js";

let tempDir: string;
let store: EvolutionStore;
let engine: EvolutionEngine;

function makeCandidate(
  overrides: Partial<EvolutionCandidate> = {},
): EvolutionCandidate {
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

function makeRecord(overrides: Partial<EvolutionRecord> = {}): EvolutionRecord {
  return {
    id: `rec-${Math.random().toString(36).slice(2, 8)}`,
    userId: "user-1",
    candidate: makeCandidate(),
    decision: {
      shouldSuggest: true,
      confidence: 0.8,
      complexityScore: 0.7,
      reasoning: "Complex enough",
    },
    timestamp: Date.now(),
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

const simpleCandidate = makeCandidate({
  taskSummary: "Simple lookup",
  toolCalls: ["search"],
  uniqueToolCount: 1,
  reasoningTurns: 1,
  durationMs: 3_000,
  domain: "test",
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
  it("returns shouldSuggest:false when complexity is below threshold", async () => {
    const decision = await engine.evaluate(simpleCandidate, "user-1");
    expect(decision.shouldSuggest).toBe(false);
    expect(decision.complexityScore).toBeLessThan(DEFAULT_EVOLUTION_CONFIG.minComplexity);
    expect(decision.reasoning).toContain("below threshold");
  });

  it("returns shouldSuggest:false when disabled in config", async () => {
    const disabledEngine = new EvolutionEngine(store, { enabled: false });
    const decision = await disabledEngine.evaluate(complexCandidate, "user-1");
    expect(decision.shouldSuggest).toBe(false);
    expect(decision.reasoning).toContain("disabled");
  });

  it("returns shouldSuggest:true for complex tasks", async () => {
    const decision = await engine.evaluate(complexCandidate, "user-fresh");
    expect(decision.shouldSuggest).toBe(true);
    expect(decision.confidence).toBeGreaterThan(0);
    expect(decision.complexityScore).toBeGreaterThanOrEqual(
      DEFAULT_EVOLUTION_CONFIG.minComplexity,
    );
  });

  it("returns recentSuggestions context even when shouldSuggest is false", async () => {
    const decision = await engine.evaluate(simpleCandidate, "user-ctx");
    expect(decision.shouldSuggest).toBe(false);
    expect(decision.recentSuggestions).toEqual([]);
  });

  it("populates recentSuggestions with prior records", async () => {
    const recentRecord = makeRecord({
      userId: "user-recent",
      candidate: { ...complexCandidate, domain: "feishu-wiki" },
      decision: { shouldSuggest: true, confidence: 0.8, complexityScore: 0.7, reasoning: "ok" },
      draft: { name: "wiki-tool", description: "d", triggerPhrases: ["wiki"], bodyMarkdown: "# W" },
      timestamp: Date.now() - 3_600_000,
    });
    await store.save(recentRecord);

    const decision = await engine.evaluate(complexCandidate, "user-recent");
    expect(decision.shouldSuggest).toBe(true);
    expect(decision.recentSuggestions).toHaveLength(1);
    expect(decision.recentSuggestions![0].domain).toBe("feishu-wiki");
    expect(decision.recentSuggestions![0].hoursAgo).toBeGreaterThanOrEqual(1);
  });

  it("includes correct confidence and reasoning when suggesting", async () => {
    const decision = await engine.evaluate(complexCandidate, "user-fresh");
    expect(decision.shouldSuggest).toBe(true);
    expect(decision.confidence).toEqual(decision.complexityScore);
    expect(decision.reasoning).toContain("complex enough");
  });

  it("generate() returns a SkillDraft", async () => {
    const draft = await engine.generate(complexCandidate);
    expect(draft.name).toBeTruthy();
    expect(draft.description).toBeTruthy();
    expect(draft.triggerPhrases.length).toBeGreaterThan(0);
    expect(draft.bodyMarkdown).toContain("## When to use");
  });

  it("recordResponse() updates and persists the record", async () => {
    const record = makeRecord({ userId: "user-1" });
    await store.save(record);

    const updated = await engine.recordResponse(
      record.id,
      "user-1",
      "accepted",
      "/skills/test.md",
    );

    expect(updated.userResponse).toBe("accepted");
    expect(updated.savedSkillPath).toBe("/skills/test.md");
    expect(updated.id).toBe(record.id);

    const allRecords = await store.list("user-1");
    const saved = allRecords.find(
      (r) => r.id === record.id && r.userResponse === "accepted",
    );
    expect(saved).toBeDefined();
    expect(saved!.userResponse).toBe("accepted");
  });

  it("recordResponse() throws when record not found", async () => {
    await expect(
      engine.recordResponse("nonexistent", "user-1", "rejected"),
    ).rejects.toThrow("not found");
  });

  it("uses constructor config over store config", async () => {
    const highThresholdEngine = new EvolutionEngine(store, {
      minComplexity: 0.99,
    });
    const decision = await highThresholdEngine.evaluate(
      complexCandidate,
      "user-fresh",
    );
    expect(decision.shouldSuggest).toBe(false);
    expect(decision.reasoning).toContain("below threshold");
  });

  describe("dual threshold (error-driven)", () => {
    it("uses errorComplexityThreshold when errorProfile has errors", async () => {
      const candidate = makeCandidate({
        taskSummary: "Simple task with tool errors",
        toolCalls: ["tool_a", "tool_a", "tool_a"],
        uniqueToolCount: 1,
        reasoningTurns: 3,
        durationMs: 10_000,
        domain: "test",
        errorProfile: { errorCount: 3, failedToolNames: ["tool_a"], hasMutatingErrors: false },
      });
      const decision = await engine.evaluate(candidate, "user-err-1");
      expect(decision.shouldSuggest).toBe(true);
      expect(decision.reasoning).toContain("error threshold");
    });

    it("uses errorComplexityThreshold when retries exist with errors", async () => {
      const candidate = makeCandidate({
        taskSummary: "Simple task with retries and errors",
        toolCalls: ["tool_a", "tool_a", "tool_a"],
        uniqueToolCount: 1,
        reasoningTurns: 3,
        durationMs: 10_000,
        domain: "test",
        errorProfile: { errorCount: 1, failedToolNames: ["tool_a"], hasMutatingErrors: false },
      });
      const decision = await engine.evaluate(candidate, "user-retry-err");
      expect(decision.shouldSuggest).toBe(true);
      expect(decision.reasoning).toContain("error threshold");
    });

    it("does not use errorComplexityThreshold for retries without errors", async () => {
      const candidate = makeCandidate({
        taskSummary: "Simple task with retries but no errors",
        toolCalls: ["tool_a", "tool_a", "tool_a"],
        uniqueToolCount: 1,
        reasoningTurns: 3,
        durationMs: 10_000,
        domain: "test",
      });
      const decision = await engine.evaluate(candidate, "user-retry-noerr");
      expect(decision.complexityScore).toBeLessThan(DEFAULT_EVOLUTION_CONFIG.minComplexity);
    });

    it("uses minComplexity when no errors or retries", async () => {
      const candidate = makeCandidate({
        taskSummary: "Simple task, no errors",
        toolCalls: ["tool_a"],
        uniqueToolCount: 1,
        reasoningTurns: 1,
        durationMs: 2_000,
        domain: "test",
      });
      const decision = await engine.evaluate(candidate, "user-clean-1");
      expect(decision.shouldSuggest).toBe(false);
      expect(decision.complexityScore).toBeLessThan(DEFAULT_EVOLUTION_CONFIG.minComplexity);
    });

    it("error candidate still suggests when recent suggestions exist", async () => {
      const candidate = makeCandidate({
        taskSummary: "Error task",
        toolCalls: ["tool_a", "tool_a", "tool_a"],
        uniqueToolCount: 1,
        reasoningTurns: 3,
        durationMs: 10_000,
        domain: "test",
        errorProfile: { errorCount: 3, failedToolNames: ["tool_a"], hasMutatingErrors: false },
      });

      const decision1 = await engine.evaluate(candidate, "user-err-persist");
      expect(decision1.shouldSuggest).toBe(true);

      const recentRecord = makeRecord({
        userId: "user-err-persist",
        decision: { shouldSuggest: true, confidence: 0.8, complexityScore: 0.5, reasoning: "err" },
        timestamp: Date.now() - 1000,
      });
      await store.save(recentRecord);

      const decision2 = await engine.evaluate(candidate, "user-err-persist");
      expect(decision2.shouldSuggest).toBe(true);
      expect(decision2.recentSuggestions).toHaveLength(1);
    });
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

    const updatedMarkdown = "---\nname: existing-skill\ndescription: \"New desc\"\nmetadata:\n  kaijibot:\n    generated: true\n    version: 1\n---\n\n## New Body\n\nUpdated content.";

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
          "---\nname: path-test\ndescription: \"Test\"\nmetadata:\n  kaijibot:\n    generated: true\n    version: 1\n---\n\nBody",
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
