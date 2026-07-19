import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "./audit-log.js";

describe("AuditLog rotation", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "kaijibot-audit-rotation-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("rotates the audit file when append would push it past 5MB", async () => {
    const log = new AuditLog(configDir);
    const dir = path.join(configDir, "cognitive", "evolution");
    const auditPath = path.join(dir, "audit.jsonl");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    await writeFile(auditPath, "x".repeat(5 * 1024 * 1024 + 1), "utf-8");

    await log.append({
      operation: "skill.create",
      actor: "agent:main",
      target: "skill:test",
      outcome: "success",
    });

    const stats = await stat(auditPath);
    expect(stats.size).toBeLessThan(5 * 1024 * 1024);
    const { readdir } = await import("node:fs/promises");
    const archives = (await readdir(dir)).filter((f) => f.endsWith(".jsonl.rotated"));
    expect(archives.length).toBeGreaterThanOrEqual(1);
  });

  it("prunes old archives beyond MAX_ARCHIVED_FILES", async () => {
    const log = new AuditLog(configDir);
    const dir = path.join(configDir, "cognitive", "evolution");
    const { mkdir, readdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    // Pre-create 7 archive files; expect prune to keep only the 5 most recent.
    for (let i = 0; i < 7; i++) {
      const stamp = `2026-01-0${i + 1}T00-00-00-000Z`;
      await writeFile(
        path.join(dir, `audit-${stamp}.jsonl.rotated`),
        `{"id":"old-${i}","timestamp":${Date.now() - i * 1000}}\n`,
        "utf-8",
      );
    }
    // Seed an oversized active file so append triggers a rotation+prune.
    const auditPath = path.join(dir, "audit.jsonl");
    await writeFile(auditPath, "x".repeat(5 * 1024 * 1024 + 1), "utf-8");

    await log.append({
      operation: "skill.create",
      actor: "agent:main",
      target: "skill:test",
      outcome: "success",
    });

    const files = await readdir(dir);
    const archives = files.filter((f) => f.endsWith(".jsonl.rotated"));
    expect(archives.length).toBeLessThanOrEqual(5);
  });

  it("returns empty array for query when no audit file exists", async () => {
    const log = new AuditLog(configDir);
    const result = await log.query({ operation: "skill.create" });
    expect(result).toEqual([]);
  });

  it("preserves query filter semantics after rotation boundary", async () => {
    const log = new AuditLog(configDir);
    await log.append({
      operation: "skill.create",
      actor: "agent:main",
      target: "skill:a",
      outcome: "success",
    });
    await log.append({
      operation: "skill.delete",
      actor: "agent:main",
      target: "skill:a",
      outcome: "success",
    });

    const creates = await log.query({ operation: "skill.create" });
    expect(creates).toHaveLength(1);
    expect(creates[0]?.target).toBe("skill:a");
  });
});
