import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvolutionStore } from "./store.js";
import { EvolutionEngine } from "./engine.js";
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

  it("returns shouldSuggest:false when in cooldown period", async () => {
    const recentRecord = makeRecord({
      userId: "user-1",
      decision: {
        shouldSuggest: true,
        confidence: 0.8,
        complexityScore: 0.7,
        reasoning: "Recent",
      },
      timestamp: Date.now() - 1000,
    });
    await store.save(recentRecord);

    const decision = await engine.evaluate(complexCandidate, "user-1");
    expect(decision.shouldSuggest).toBe(false);
    expect(decision.reasoning).toContain("cooldown");
  });

  it("returns shouldSuggest:false when daily limit reached", async () => {
    const maxPerDay = DEFAULT_EVOLUTION_CONFIG.maxSuggestionsPerDay;
    const shortCooldownEngine = new EvolutionEngine(store, {
      cooldownHours: 0,
    });

    for (let i = 0; i < maxPerDay; i++) {
      const record = makeRecord({
        id: `rec-daily-${i}`,
        userId: "user-2",
        timestamp: Date.now() - 1000,
      });
      await store.save(record);
    }

    const decision = await shortCooldownEngine.evaluate(
      complexCandidate,
      "user-2",
    );
    expect(decision.shouldSuggest).toBe(false);
    expect(decision.reasoning).toContain("Daily limit");
  });

  it("returns shouldSuggest:true for complex tasks with no cooldown/limit issues", async () => {
    const decision = await engine.evaluate(complexCandidate, "user-fresh");
    expect(decision.shouldSuggest).toBe(true);
    expect(decision.confidence).toBeGreaterThan(0);
    expect(decision.complexityScore).toBeGreaterThanOrEqual(
      DEFAULT_EVOLUTION_CONFIG.minComplexity,
    );
  });

  it("includes correct confidence and reasoning when suggesting", async () => {
    const decision = await engine.evaluate(complexCandidate, "user-fresh");
    expect(decision.shouldSuggest).toBe(true);
    expect(decision.confidence).toEqual(decision.complexityScore);
    expect(decision.reasoning).toContain("complex enough");
  });

  it("generate() returns a SkillDraft", () => {
    const draft = engine.generate(complexCandidate);
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
});
