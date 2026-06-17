import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { PatternRegistry } from "./pattern-registry.js";
import { CorrectionStore } from "./store.js";
import type { CorrectionRecord } from "./types.js";

let tempDir: string;
let store: CorrectionStore;
let registry: PatternRegistry;
const AGENT = "main";
const USER = "user-1";

function makeCorrection(overrides: Partial<CorrectionRecord> = {}): CorrectionRecord {
  return {
    id: randomUUID(),
    domain: "feishu-doc",
    trigger: "创建飞书文档时",
    mistake: "只传了标题参数，忘记调用update写入正文",
    correction: "创建后必须用update API写入正文内容",
    provenance: "self",
    reinforcedCount: 0,
    createdAt: Date.now(),
    lastReinforced: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kaijibot-pat-promo-"));
  store = new CorrectionStore(tempDir);
  registry = new PatternRegistry(tempDir);
  store.attachPatternRegistry(registry);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("CorrectionStore pattern promotion integration", () => {
  it("promotes a pattern to registry when reinforcedCount reaches 5", async () => {
    const record = makeCorrection();
    await store.add(AGENT, USER, record);

    // Reinforce 5 times to trigger promotion at count === 5
    for (let i = 0; i < 5; i++) {
      await store.reinforce(AGENT, USER, record.id);
    }

    const patterns = registry.patterns();
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    const sources = registry.list().map((p) => p.source);
    expect(sources).toContain("auto-promoted");
  });

  it("does NOT promote pattern when reinforcedCount is below 5", async () => {
    const record = makeCorrection();
    await store.add(AGENT, USER, record);

    for (let i = 0; i < 4; i++) {
      await store.reinforce(AGENT, USER, record.id);
    }

    expect(registry.patterns()).toHaveLength(0);
  });

  it("does NOT promote pattern again when reinforcedCount passes 5 (fires once)", async () => {
    const record = makeCorrection();
    await store.add(AGENT, USER, record);

    for (let i = 0; i < 7; i++) {
      await store.reinforce(AGENT, USER, record.id);
    }

    // Should have promoted exactly once (at count === 5)
    expect(registry.patterns()).toHaveLength(1);
  });

  it("works without an attached registry (non-fatal)", async () => {
    const storeWithoutRegistry = new CorrectionStore(tempDir);
    const record = makeCorrection();
    await storeWithoutRegistry.add(AGENT, USER, record);

    // Should not throw even without registry
    for (let i = 0; i < 5; i++) {
      await storeWithoutRegistry.reinforce(AGENT, USER, record.id);
    }

    const loaded = await storeWithoutRegistry.loadAll(AGENT, USER);
    expect(loaded[0]!.reinforcedCount).toBe(5);
  });

  it("promoted pattern matches text containing mistake keywords", async () => {
    const record = makeCorrection({
      trigger: "处理订单数据时",
      mistake: "遗漏了空值检查导致报错",
    });
    await store.add(AGENT, USER, record);

    for (let i = 0; i < 5; i++) {
      await store.reinforce(AGENT, USER, record.id);
    }

    const patterns = registry.patterns();
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    // At least one pattern should match text related to the mistake
    const matched = patterns.some((p) => p.test("遗漏了空值检查导致报错"));
    expect(matched).toBe(true);
  });
});
