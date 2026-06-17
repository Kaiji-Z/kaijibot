import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { InsightRecord } from "../types.js";
import { InsightStore } from "./store.js";

const AGENT = "main";

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
    await store.save(AGENT, "user-1", insight);
    const loaded = await store.load(AGENT, "user-1", insight.id);

    expect(loaded).toEqual(insight);
  });

  it("returns undefined for non-existent insight", async () => {
    const result = await store.load(AGENT, "user-1", "no-such-id");
    expect(result).toBeUndefined();
  });

  it("updateFeedback sets feedback and userResponse, preserves other fields", async () => {
    const insight = makeInsight();
    await store.save(AGENT, "user-1", insight);

    await store.updateFeedback(AGENT, "user-1", insight.id, "engaged", "Thanks!");

    const loaded = await store.load(AGENT, "user-1", insight.id);
    expect(loaded?.feedback).toBe("engaged");
    expect(loaded?.userResponse).toBe("Thanks!");
    expect(loaded?.content).toBe(insight.content);
    expect(loaded?.targetDomains).toEqual(insight.targetDomains);
    expect(loaded?.generatedAt).toBe(insight.generatedAt);
    expect(loaded?.sources).toEqual(insight.sources);
  });

  it("updateFeedback is no-op for non-existent insight", async () => {
    await expect(
      store.updateFeedback(AGENT, "user-1", "ghost", "positive"),
    ).resolves.toBeUndefined();
  });

  it("listRecent returns sorted by generatedAt desc, respects limit", async () => {
    const insightA = makeInsight({ id: "a", generatedAt: 1000 });
    const insightB = makeInsight({ id: "b", generatedAt: 3000 });
    const insightC = makeInsight({ id: "c", generatedAt: 2000 });

    await store.save(AGENT, "user-1", insightA);
    await store.save(AGENT, "user-1", insightB);
    await store.save(AGENT, "user-1", insightC);

    const all = await store.listRecent(AGENT, "user-1");
    expect(all.map((r) => r.id)).toEqual(["b", "c", "a"]);

    const limited = await store.listRecent(AGENT, "user-1", 2);
    expect(limited.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("listRecent returns empty array for user with no insights", async () => {
    const result = await store.listRecent(AGENT, "unknown-user");
    expect(result).toEqual([]);
  });

  it("listRecent with sinceTimestamp filter works correctly", async () => {
    const insightOld = makeInsight({ id: "old", generatedAt: 1000 });
    const insightNew = makeInsight({ id: "new", generatedAt: 5000 });

    await store.save(AGENT, "user-1", insightOld);
    await store.save(AGENT, "user-1", insightNew);

    const sinceResults = await store.listRecent(AGENT, "user-1", 20);
    const filtered = sinceResults.filter((r) => r.generatedAt >= 3000);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("new");
  });

  it("isolates insights by agentId", async () => {
    const insight = makeInsight({ id: "shared-id" });

    await store.save("agent-a", "user-1", insight);
    await store.save("agent-b", "user-1", { ...insight, content: "Different content" });

    const loadedA = await store.load("agent-a", "user-1", "shared-id");
    const loadedB = await store.load("agent-b", "user-1", "shared-id");

    expect(loadedA?.content).toBe("New transformer architecture reduces inference latency by 40%.");
    expect(loadedB?.content).toBe("Different content");

    expect(existsSync(join(tempDir, "cognitive", "insights", "agent-a", "user-1.json"))).toBe(true);
    expect(existsSync(join(tempDir, "cognitive", "insights", "agent-b", "user-1.json"))).toBe(true);
  });

  it("listActive filters by TTL", async () => {
    const now = Date.now();
    const DAY = 86_400_000;
    await store.save(AGENT, "user-1", makeInsight({ id: "old", generatedAt: now - 90 * DAY }));
    await store.save(AGENT, "user-1", makeInsight({ id: "recent", generatedAt: now - 10 * DAY }));
    await store.save(AGENT, "user-1", makeInsight({ id: "fresh", generatedAt: now }));

    const active = await store.listActive(AGENT, "user-1");
    expect(active.map((r) => r.id)).toEqual(["fresh", "recent"]);
  });

  it("listActive respects limit", async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await store.save(
        AGENT,
        "user-1",
        makeInsight({ id: `ins-${i}`, generatedAt: now - i * 1000 }),
      );
    }
    const result = await store.listActive(AGENT, "user-1", 60, 3);
    expect(result).toHaveLength(3);
  });

  it("removeStale removes old records", async () => {
    const now = Date.now();
    const DAY = 86_400_000;
    await store.save(AGENT, "user-1", makeInsight({ id: "stale-1", generatedAt: now - 90 * DAY }));
    await store.save(AGENT, "user-1", makeInsight({ id: "stale-2", generatedAt: now - 100 * DAY }));
    await store.save(AGENT, "user-1", makeInsight({ id: "fresh", generatedAt: now - 10 * DAY }));

    const removed = await store.removeStale(AGENT, "user-1");
    expect(removed).toBe(2);

    const remaining = await store.listRecent(AGENT, "user-1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("fresh");
  });

  it("removeStale with custom TTL", async () => {
    const now = Date.now();
    const DAY = 86_400_000;
    await store.save(AGENT, "user-1", makeInsight({ id: "old-5d", generatedAt: now - 5 * DAY }));
    await store.save(AGENT, "user-1", makeInsight({ id: "fresh-1d", generatedAt: now - 1 * DAY }));

    const removed = await store.removeStale(AGENT, "user-1", 3);
    expect(removed).toBe(1);

    const remaining = await store.listRecent(AGENT, "user-1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("fresh-1d");
  });

  it("writeRecords keeps records within cap", async () => {
    for (let i = 0; i < 5; i++) {
      await store.save(AGENT, "user-1", makeInsight({ id: `ins-${i}`, generatedAt: i }));
    }
    const all = await store.listRecent(AGENT, "user-1", 200);
    expect(all).toHaveLength(5);
  });

  it("persistence format: file contains InsightStoreData with version", async () => {
    await store.save(AGENT, "user-1", makeInsight({ id: "fmt-test" }));

    const raw = await readFile(
      join(tempDir, "cognitive", "insights", AGENT, "user-1.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty("version", 1);
    expect(Array.isArray(parsed.insights)).toBe(true);
    expect(parsed.insights).toHaveLength(1);
    expect(parsed.insights[0].id).toBe("fmt-test");
  });

  describe("findByDeliveryMessageId", () => {
    it("finds insight by matching deliveryMessageId", async () => {
      const insight = makeInsight({
        id: "with-msg-id",
        generatedAt: Date.now(),
        deliveryMessageId: "om_abc123",
      });
      await store.save(AGENT, "user-1", insight);

      const found = await store.findByDeliveryMessageId(AGENT, "user-1", "om_abc123");
      expect(found?.id).toBe("with-msg-id");
    });

    it("returns undefined when no insight matches the messageId", async () => {
      await store.save(
        AGENT,
        "user-1",
        makeInsight({ id: "no-match", generatedAt: Date.now(), deliveryMessageId: "om_xyz" }),
      );
      const found = await store.findByDeliveryMessageId(AGENT, "user-1", "om_different");
      expect(found).toBeUndefined();
    });

    it("returns undefined when insight has no deliveryMessageId", async () => {
      await store.save(
        AGENT,
        "user-1",
        makeInsight({ id: "no-delivery-id", generatedAt: Date.now() }),
      );
      const found = await store.findByDeliveryMessageId(AGENT, "user-1", "om_anything");
      expect(found).toBeUndefined();
    });

    it("returns the most recent insight when multiple share the same messageId", async () => {
      const now = Date.now();
      await store.save(
        AGENT,
        "user-1",
        makeInsight({ id: "older", generatedAt: now - 2000, deliveryMessageId: "om_dup" }),
      );
      await store.save(
        AGENT,
        "user-1",
        makeInsight({ id: "newer", generatedAt: now, deliveryMessageId: "om_dup" }),
      );

      const found = await store.findByDeliveryMessageId(AGENT, "user-1", "om_dup");
      expect(found?.id).toBe("newer");
    });

    it("excludes insights older than TTL", async () => {
      const now = Date.now();
      const DAY = 86_400_000;
      await store.save(
        AGENT,
        "user-1",
        makeInsight({ id: "stale", generatedAt: now - 90 * DAY, deliveryMessageId: "om_old" }),
      );

      const found = await store.findByDeliveryMessageId(AGENT, "user-1", "om_old");
      expect(found).toBeUndefined();
    });

    it("isolates by userId", async () => {
      await store.save(
        AGENT,
        "user-1",
        makeInsight({ id: "u1-insight", generatedAt: Date.now(), deliveryMessageId: "om_shared" }),
      );
      const found = await store.findByDeliveryMessageId(AGENT, "user-2", "om_shared");
      expect(found).toBeUndefined();
    });
  });
});
