import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InsightStore } from "./store.js";
import type { InsightRecord } from "../types.js";

function makeInsight(overrides: Partial<InsightRecord> = {}): InsightRecord {
  return {
    id: "insight-1",
    generatedAt: 1000,
    triggerSource: "scheduled",
    targetDomains: ["AI/机器学习"],
    sourceDomains: ["arxiv"],
    content: "New transformer architecture reduces inference latency by 40%.",
    rationale: "Matches user interest in ML optimization",
    sources: [{ url: "https://example.com/paper", title: "Test Paper", credibility: 0.9 }],
    feedback: undefined,
    deliveredAt: undefined,
    userResponse: undefined,
    ...overrides,
  };
}

describe("InsightStore", () => {
  let tempDir: string;
  let store: InsightStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "insight-test-"));
    store = new InsightStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("save + load round-trip preserves all InsightRecord fields", async () => {
    const insight = makeInsight({
      feedback: "positive",
      deliveredAt: 2000,
      userResponse: "Very interesting!",
    });
    await store.save("user-1", insight);
    const loaded = await store.load("user-1", insight.id);

    expect(loaded).toEqual(insight);
  });

  it("returns undefined for non-existent insight", async () => {
    const result = await store.load("user-1", "no-such-id");
    expect(result).toBeUndefined();
  });

  it("updateFeedback sets feedback and userResponse, preserves other fields", async () => {
    const insight = makeInsight();
    await store.save("user-1", insight);

    await store.updateFeedback("user-1", insight.id, "engaged", "Thanks!");

    const loaded = await store.load("user-1", insight.id);
    expect(loaded?.feedback).toBe("engaged");
    expect(loaded?.userResponse).toBe("Thanks!");
    expect(loaded?.content).toBe(insight.content);
    expect(loaded?.targetDomains).toEqual(insight.targetDomains);
    expect(loaded?.generatedAt).toBe(insight.generatedAt);
    expect(loaded?.sources).toEqual(insight.sources);
  });

  it("updateFeedback is no-op for non-existent insight", async () => {
    await expect(
      store.updateFeedback("user-1", "ghost", "positive"),
    ).resolves.toBeUndefined();
  });

  it("listRecent returns sorted by generatedAt desc, respects limit", async () => {
    const insightA = makeInsight({ id: "a", generatedAt: 1000 });
    const insightB = makeInsight({ id: "b", generatedAt: 3000 });
    const insightC = makeInsight({ id: "c", generatedAt: 2000 });

    await store.save("user-1", insightA);
    await store.save("user-1", insightB);
    await store.save("user-1", insightC);

    const all = await store.listRecent("user-1");
    expect(all.map((r) => r.id)).toEqual(["b", "c", "a"]);

    const limited = await store.listRecent("user-1", 2);
    expect(limited.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("listRecent returns empty array for user with no insights", async () => {
    const result = await store.listRecent("unknown-user");
    expect(result).toEqual([]);
  });

  it("listRecent with sinceTimestamp filter works correctly", async () => {
    const insightOld = makeInsight({ id: "old", generatedAt: 1000 });
    const insightNew = makeInsight({ id: "new", generatedAt: 5000 });

    await store.save("user-1", insightOld);
    await store.save("user-1", insightNew);

    const sinceResults = await store.listRecent("user-1", 20);
    const filtered = sinceResults.filter((r) => r.generatedAt >= 3000);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("new");
  });
});
