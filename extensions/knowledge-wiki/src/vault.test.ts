import { readFile, rm, access } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { initializeWikiVault } from "./vault.js";

const TMP = path.join(process.cwd(), ".tmp-vault-test");

describe("initializeWikiVault", () => {
  beforeEach(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  it("creates all required directories", async () => {
    const result = await initializeWikiVault(path.join(TMP, "wiki"));
    expect(result.createdDirs).toContain("summaries");
    expect(result.createdDirs).toContain("entities");
    expect(result.createdDirs).toContain("concepts");

    for (const dir of ["summaries", "entities", "concepts"]) {
      await expect(access(path.join(TMP, "wiki", dir))).resolves.toBeUndefined();
    }
    await expect(
      access(path.join(TMP, "wiki", ".kaijibot-wiki", "cache")),
    ).resolves.toBeUndefined();
  });

  it("creates seed files on first init", async () => {
    const result = await initializeWikiVault(path.join(TMP, "wiki"));
    expect(result.created).toBe(true);
    expect(result.createdFiles).toContain("AGENTS.md");
    expect(result.createdFiles).toContain("index.md");
    expect(result.createdFiles).toContain("log.md");
  });

  it("AGENTS.md contains wiki guide content", async () => {
    await initializeWikiVault(path.join(TMP, "wiki"));
    const content = await readFile(path.join(TMP, "wiki", "AGENTS.md"), "utf8");
    expect(content).toContain("Wiki Agent Guide");
    expect(content).toContain("Ingest");
    expect(content).toContain("Query");
    expect(content).toContain("Lint");
  });

  it("index.md has wiki index heading", async () => {
    await initializeWikiVault(path.join(TMP, "wiki"));
    const content = await readFile(path.join(TMP, "wiki", "index.md"), "utf8");
    expect(content).toContain("Wiki Index");
  });

  it("log.md has initial init entry", async () => {
    await initializeWikiVault(path.join(TMP, "wiki"));
    const content = await readFile(path.join(TMP, "wiki", "log.md"), "utf8");
    expect(content).toContain("init");
  });

  it("does not overwrite existing files on re-init", async () => {
    await initializeWikiVault(path.join(TMP, "wiki"));
    const result2 = await initializeWikiVault(path.join(TMP, "wiki"));
    expect(result2.created).toBe(false);
    expect(result2.createdFiles).toHaveLength(0);
  });

  it("handles nested path creation", async () => {
    const result = await initializeWikiVault(path.join(TMP, "deep", "nested", "wiki"));
    expect(result.createdDirs.length).toBe(3);
  });
});
