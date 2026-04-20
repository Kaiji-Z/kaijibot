import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditLog } from "./audit-log.js";

let tempDir: string;
let log: AuditLog;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kaijibot-audit-test-"));
  log = new AuditLog(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("AuditLog", () => {
  it("append creates entry with auto-generated id and timestamp", async () => {
    const before = Date.now();
    const result = await log.append({
      operation: "skill.create",
      actor: "engine",
      target: "test-skill",
      outcome: "success",
    });

    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(Date.now());
    expect(result.operation).toBe("skill.create");
    expect(result.actor).toBe("engine");
    expect(result.target).toBe("test-skill");
    expect(result.outcome).toBe("success");
  });

  it("query by actor returns only matching entries", async () => {
    await log.append({ operation: "a", actor: "alice", target: "t1", outcome: "success" });
    await log.append({ operation: "b", actor: "bob", target: "t2", outcome: "success" });
    await log.append({ operation: "c", actor: "alice", target: "t3", outcome: "failure" });

    const results = await log.query({ actor: "alice" });
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.actor === "alice")).toBe(true);
  });

  it("query by operation type returns only matching entries", async () => {
    await log.append({ operation: "skill.create", actor: "a", target: "t1", outcome: "success" });
    await log.append({ operation: "skill.update", actor: "a", target: "t2", outcome: "success" });
    await log.append({ operation: "skill.create", actor: "a", target: "t3", outcome: "success" });

    const results = await log.query({ operation: "skill.create" });
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.operation === "skill.create")).toBe(true);
  });

  it("query by time range (since) filters correctly", async () => {
    const entry1 = await log.append({ operation: "a", actor: "a", target: "t1", outcome: "success" });
    await new Promise((r) => setTimeout(r, 10));
    const entry2 = await log.append({ operation: "b", actor: "a", target: "t2", outcome: "success" });

    const results = await log.query({ since: entry2.timestamp });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(entry2.id);
  });

  it("concurrent appends preserve all entries", async () => {
    const count = 20;
    const ids = new Set<string>();

    const promises = Array.from({ length: count }, (_, i) =>
      log.append({
        operation: `op-${i}`,
        actor: "engine",
        target: `target-${i}`,
        outcome: "success",
      }),
    );

    const results = await Promise.all(promises);
    for (const r of results) ids.add(r.id);
    expect(ids.size).toBe(count);

    const all = await log.query({});
    expect(all).toHaveLength(count);
  });

  it("file auto-creates on first append, query returns empty before append", async () => {
    const before = await log.query({});
    expect(before).toHaveLength(0);

    await log.append({ operation: "x", actor: "a", target: "t", outcome: "success" });

    const after = await log.query({});
    expect(after).toHaveLength(1);
  });

  it("empty query filter returns all entries", async () => {
    await log.append({ operation: "a", actor: "a", target: "t1", outcome: "success" });
    await log.append({ operation: "b", actor: "b", target: "t2", outcome: "failure" });
    await log.append({ operation: "c", actor: "c", target: "t3", outcome: "skipped" });

    const results = await log.query({});
    expect(results).toHaveLength(3);
  });
});
