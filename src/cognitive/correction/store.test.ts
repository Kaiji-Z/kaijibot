import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CorrectionStore } from "./store.js";
import type { CorrectionRecord } from "./types.js";

let tempDir: string;
let store: CorrectionStore;
const USER = "user-1";

function makeCorrection(overrides: Partial<CorrectionRecord> = {}): CorrectionRecord {
  return {
    id: randomUUID(),
    domain: "test-domain",
    trigger: "test trigger",
    mistake: "test mistake",
    correction: "test correction",
    provenance: "self",
    reinforcedCount: 0,
    createdAt: Date.now(),
    lastReinforced: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kaijibot-correction-test-"));
  store = new CorrectionStore(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("CorrectionStore", () => {
  it("save + load round-trip preserves all fields", async () => {
    const record = makeCorrection();
    await store.add(USER, record);

    const loaded = await store.loadAll(USER);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(record);
  });

  it("returns [] for non-existent user", async () => {
    const records = await store.loadAll("nonexistent");
    expect(records).toEqual([]);
  });

  it("returns [] for corrupt JSON file", async () => {
    const { mkdirSync } = await import("node:fs");
    const dir = join(tempDir, "cognitive", "corrections");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${USER}.json`), "not valid json {{{");

    const records = await store.loadAll(USER);
    expect(records).toEqual([]);
  });

  it("addOrReinforce adds new when no similar exists", async () => {
    const record = makeCorrection();
    const result = await store.addOrReinforce(USER, record);
    expect(result).toBe("added");

    const loaded = await store.loadAll(USER);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(record.id);
  });

  it("addOrReinforce reinforces existing with same domain + similar mistake", async () => {
    const existing = makeCorrection({
      domain: "coding",
      mistake: "used let instead of const for immutable variable",
    });
    await store.add(USER, existing);

    const incoming = makeCorrection({
      domain: "coding",
      mistake: "used let instead of const for immutable variables",
    });
    const result = await store.addOrReinforce(USER, incoming);
    expect(result).toBe("reinforced");

    const loaded = await store.loadAll(USER);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].reinforcedCount).toBe(1);
    expect(loaded[0].id).toBe(existing.id);
  });

  it("does NOT match across different domains", async () => {
    const existing = makeCorrection({
      domain: "coding",
      mistake: "used let instead of const for immutable variable",
    });
    await store.add(USER, existing);

    const incoming = makeCorrection({
      domain: "cooking",
      mistake: "used let instead of const for immutable variable",
    });
    const result = await store.addOrReinforce(USER, incoming);
    expect(result).toBe("added");

    const loaded = await store.loadAll(USER);
    expect(loaded).toHaveLength(2);
  });

  it("does NOT match when Jaccard similarity below threshold", async () => {
    const existing = makeCorrection({
      domain: "coding",
      mistake: "forgot to handle null pointer in API response",
    });
    await store.add(USER, existing);

    const incoming = makeCorrection({
      domain: "coding",
      mistake: "incorrect CSS flexbox layout on mobile screens",
    });
    const result = await store.addOrReinforce(USER, incoming);
    expect(result).toBe("added");

    const loaded = await store.loadAll(USER);
    expect(loaded).toHaveLength(2);
  });

  it("reinforcedCount increments on reinforce", async () => {
    const record = makeCorrection();
    await store.add(USER, record);

    await store.reinforce(USER, record.id);
    let loaded = await store.loadAll(USER);
    expect(loaded[0].reinforcedCount).toBe(1);

    await store.reinforce(USER, record.id);
    loaded = await store.loadAll(USER);
    expect(loaded[0].reinforcedCount).toBe(2);
  });

  it("reinforce does nothing for non-existent id", async () => {
    const record = makeCorrection();
    await store.add(USER, record);

    await store.reinforce(USER, "nonexistent-id");
    const loaded = await store.loadAll(USER);
    expect(loaded[0].reinforcedCount).toBe(0);
  });

  it("listActive filters out stale corrections", async () => {
    const stale = makeCorrection({
      lastReinforced: Date.now() - 91 * 86_400_000,
    });
    await store.add(USER, stale);

    const active = await store.listActive(USER);
    expect(active).toHaveLength(0);
  });

  it("listActive returns all within TTL", async () => {
    const r1 = makeCorrection({ reinforcedCount: 1 });
    const r2 = makeCorrection({ reinforcedCount: 3 });
    await store.add(USER, r1);
    await store.add(USER, r2);

    const active = await store.listActive(USER);
    expect(active).toHaveLength(2);
    expect(active[0].reinforcedCount).toBe(3);
    expect(active[1].reinforcedCount).toBe(1);
  });

  it("removeStale removes expired and keeps active", async () => {
    const active = makeCorrection();
    const stale = makeCorrection({
      lastReinforced: Date.now() - 91 * 86_400_000,
    });
    await store.add(USER, active);
    await store.add(USER, stale);

    const removed = await store.removeStale(USER);
    expect(removed).toBe(1);

    const remaining = await store.loadAll(USER);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(active.id);
  });

  it("removeStale returns 0 when nothing expired", async () => {
    const record = makeCorrection();
    await store.add(USER, record);

    const removed = await store.removeStale(USER);
    expect(removed).toBe(0);

    const remaining = await store.loadAll(USER);
    expect(remaining).toHaveLength(1);
  });

  it("respects custom ttlDays parameter", async () => {
    const record = makeCorrection({
      lastReinforced: Date.now() - 5 * 86_400_000,
    });
    await store.add(USER, record);

    const activeDefault = await store.listActive(USER, 90);
    expect(activeDefault).toHaveLength(1);

    const active3Days = await store.listActive(USER, 3);
    expect(active3Days).toHaveLength(0);
  });
});
