import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { EvolutionStore, createEvolutionDir } from "./store.js";
import type { EvolutionRecord } from "./types.js";
import { DEFAULT_EVOLUTION_CONFIG } from "./types.js";

let tempDir: string;
let store: EvolutionStore;

function makeRecord(overrides: Partial<EvolutionRecord> = {}): EvolutionRecord {
  return {
    id: `rec-${Math.random().toString(36).slice(2, 8)}`,
    userId: "user-1",
    candidate: {
      taskSummary: "Test task",
      toolCalls: ["tool-a", "tool-b"],
      uniqueToolCount: 2,
      reasoningTurns: 3,
      durationMs: 5000,
      domain: "test",
    },
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

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kaijibot-evolution-test-"));
  store = new EvolutionStore(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("EvolutionStore", () => {
  it("saves and retrieves a record", async () => {
    const record = makeRecord();
    await store.save(record);

    const records = await store.list("user-1");
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(record.id);
    expect(records[0].candidate.taskSummary).toBe("Test task");
  });

  it("lists only records for specific userId", async () => {
    const r1 = makeRecord({ userId: "user-a", id: "rec-a" });
    const r2 = makeRecord({ userId: "user-b", id: "rec-b" });
    await store.save(r1);
    await store.save(r2);

    const userARecords = await store.list("user-a");
    expect(userARecords).toHaveLength(1);
    expect(userARecords[0].id).toBe("rec-a");

    const userBRecords = await store.list("user-b");
    expect(userBRecords).toHaveLength(1);
    expect(userBRecords[0].id).toBe("rec-b");
  });

  it("getRecentSuggestions filters by time window", async () => {
    const recent = makeRecord({ id: "rec-recent", timestamp: Date.now() - 1000 });
    const old = makeRecord({ id: "rec-old", timestamp: Date.now() - 25 * 3_600_000 });
    await store.save(recent);
    await store.save(old);

    const suggestions = await store.getRecentSuggestions("user-1", 24);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].id).toBe("rec-recent");
  });

  it("getRecentSuggestions only includes suggested records", async () => {
    const suggested = makeRecord({
      id: "rec-yes",
      decision: { shouldSuggest: true, confidence: 0.9, complexityScore: 0.8, reasoning: "yes" },
    });
    const notSuggested = makeRecord({
      id: "rec-no",
      decision: { shouldSuggest: false, confidence: 0.3, complexityScore: 0.2, reasoning: "no" },
    });
    await store.save(suggested);
    await store.save(notSuggested);

    const suggestions = await store.getRecentSuggestions("user-1", 1);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].id).toBe("rec-yes");
  });

  it("loadConfig returns defaults when no config file", async () => {
    const config = await store.loadConfig();
    expect(config).toEqual(DEFAULT_EVOLUTION_CONFIG);
  });

  it("saveConfig persists and loadConfig reads back", async () => {
    const custom = { ...DEFAULT_EVOLUTION_CONFIG, minComplexity: 0.9, enabled: false };
    await store.saveConfig(custom);

    const loaded = await store.loadConfig();
    expect(loaded.minComplexity).toBe(0.9);
    expect(loaded.enabled).toBe(false);
    expect(loaded.errorComplexityThreshold).toBe(DEFAULT_EVOLUTION_CONFIG.errorComplexityThreshold);
  });

  it("handles empty/missing user files gracefully", async () => {
    const records = await store.list("nonexistent-user");
    expect(records).toEqual([]);

    const suggestions = await store.getRecentSuggestions("nonexistent-user", 24);
    expect(suggestions).toEqual([]);
  });

  it("creates directories automatically", async () => {
    const record = makeRecord();
    await store.save(record);

    const dir = createEvolutionDir(tempDir);
    expect(existsSync(dir)).toBe(true);

    const raw = await readFile(join(dir, "user-1.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
  });
});
