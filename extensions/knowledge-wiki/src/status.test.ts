import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveWikiStatus, renderWikiStatus } from "./status.js";

const TMP = path.join(process.cwd(), ".tmp-status-test");

describe("resolveWikiStatus", () => {
  beforeEach(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  it("returns vaultExists=false for non-existent vault", async () => {
    const status = await resolveWikiStatus(path.join(TMP, "nonexistent"));
    expect(status.vaultExists).toBe(false);
    expect(status.totalPages).toBe(0);
  });

  it("counts pages in each directory", async () => {
    await mkdir(path.join(TMP, "wiki", "summaries"), { recursive: true });
    await mkdir(path.join(TMP, "wiki", "entities"), { recursive: true });
    await mkdir(path.join(TMP, "wiki", "concepts"), { recursive: true });

    await writeFile(path.join(TMP, "wiki", "summaries", "a.md"), "", "utf8");
    await writeFile(path.join(TMP, "wiki", "summaries", "b.md"), "", "utf8");
    await writeFile(path.join(TMP, "wiki", "entities", "rust.md"), "", "utf8");
    await writeFile(path.join(TMP, "wiki", "concepts", "cap.md"), "", "utf8");

    const status = await resolveWikiStatus(path.join(TMP, "wiki"));
    expect(status.vaultExists).toBe(true);
    expect(status.pageCounts.summaries).toBe(2);
    expect(status.pageCounts.entities).toBe(1);
    expect(status.pageCounts.concepts).toBe(1);
    expect(status.totalPages).toBe(4);
  });

  it("ignores non-markdown files", async () => {
    await mkdir(path.join(TMP, "wiki", "summaries"), { recursive: true });
    await writeFile(path.join(TMP, "wiki", "summaries", "real.md"), "", "utf8");
    await writeFile(path.join(TMP, "wiki", "summaries", "ignore.txt"), "", "utf8");
    await writeFile(path.join(TMP, "wiki", "summaries", "data.json"), "", "utf8");

    const status = await resolveWikiStatus(path.join(TMP, "wiki"));
    expect(status.pageCounts.summaries).toBe(1);
  });

  it("reads lastActivity from log.md", async () => {
    await mkdir(path.join(TMP, "wiki", "summaries"), { recursive: true });
    await writeFile(
      path.join(TMP, "wiki", "log.md"),
      "## [2026-06-20 10:30] ingest | doc.md\n\n## [2026-06-20 11:00] lint\n",
      "utf8",
    );

    const status = await resolveWikiStatus(path.join(TMP, "wiki"));
    expect(status.lastActivity).toBeTruthy();
    expect(status.lastActivity).toContain("2026-06-20");
  });

  it("returns null lastActivity when no log.md", async () => {
    await mkdir(path.join(TMP, "wiki", "summaries"), { recursive: true });
    const status = await resolveWikiStatus(path.join(TMP, "wiki"));
    expect(status.lastActivity).toBeNull();
  });
});

describe("renderWikiStatus", () => {
  it("renders vault not initialized message", () => {
    const output = renderWikiStatus({
      vaultPath: "/test/wiki",
      vaultExists: false,
      pageCounts: {},
      totalPages: 0,
      lastActivity: null,
    });
    expect(output).toContain("not initialized");
  });

  it("renders page counts and activity", () => {
    const output = renderWikiStatus({
      vaultPath: "/test/wiki",
      vaultExists: true,
      pageCounts: { summaries: 3, entities: 5, concepts: 2 },
      totalPages: 10,
      lastActivity: "2026-06-20 10:30",
    });
    expect(output).toContain("Pages: 10");
    expect(output).toContain("Summaries: 3");
    expect(output).toContain("Entities: 5");
    expect(output).toContain("Concepts: 2");
    expect(output).toContain("2026-06-20");
  });
});
