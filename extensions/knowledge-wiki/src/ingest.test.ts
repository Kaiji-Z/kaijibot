import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ingestFile, ingestAll } from "./ingest.js";
import { initializeWikiVault } from "./vault.js";
import { loadFileState } from "./file-state.js";
import { resolveWikiConfig } from "./config.js";
import type { GenerateTextFn } from "./compiler.js";
import type { WikiConfig } from "./config.js";

const TMP = path.join(process.cwd(), ".tmp-ingest-test");

const MOCK_LLM_RESPONSE = JSON.stringify({
  summary: "This document describes a distributed tracing system built with Rust and eBPF.",
  claims: [
    { text: "The system uses Rust for zero-cost abstractions", confidence: 0.9, category: "technical_decision" },
    { text: "Latency target is under 100ms", confidence: 0.85, category: "constraint" },
  ],
  entities: [
    { name: "Rust", type: "technology", description: "Systems programming language" },
    { name: "eBPF", type: "technology", description: "Kernel-level tracing technology" },
  ],
  concepts: [
    { name: "Zero-cost abstractions", description: "Compile-time abstractions with no runtime overhead", relatedTo: ["Rust"] },
  ],
  topics: ["distributed-systems", "tracing"],
  relationships: [
    { from: "System", to: "Rust", type: "uses" },
  ],
});

const mockGenerateText: GenerateTextFn = async () => MOCK_LLM_RESPONSE;

const config: WikiConfig = resolveWikiConfig(undefined);

async function createWorkspace() {
  await mkdir(path.join(TMP, "workspace", "docs"), { recursive: true });
  await mkdir(path.join(TMP, "workspace", "notes"), { recursive: true });
  await writeFile(
    path.join(TMP, "workspace", "docs", "architecture.md"),
    "# Architecture\n\nWe chose Rust for its zero-cost abstractions.\nLatency target: 100ms.",
    "utf8",
  );
  await writeFile(
    path.join(TMP, "workspace", "notes", "meeting.md"),
    "# Meeting Notes\n\nDiscussed tracing strategy with eBPF.",
    "utf8",
  );
}

describe("ingestFile", () => {
  beforeEach(async () => {
    await rm(TMP, { recursive: true, force: true });
    await createWorkspace();
    await initializeWikiVault(path.join(TMP, "wiki"));
  });

  afterEach(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  it("ingests a source file and creates wiki pages", async () => {
    const source = {
      absolutePath: path.join(TMP, "workspace", "docs", "architecture.md"),
      relativePath: "docs/architecture.md",
      size: 100,
      mtimeMs: Date.now(),
    };

    const result = await ingestFile(
      path.join(TMP, "wiki"),
      source,
      mockGenerateText,
      config,
    );

    expect(result.skipped).toBe(false);
    expect(result.sourcePath).toBe("docs/architecture.md");
    expect(result.claimsAdded).toBe(2);
    expect(result.entityPages.length).toBe(2);
    expect(result.conceptPages.length).toBe(1);
    expect(result.summaryPage).toContain("summaries/");
  });

  it("creates summary page with correct frontmatter", async () => {
    const source = {
      absolutePath: path.join(TMP, "workspace", "docs", "architecture.md"),
      relativePath: "docs/architecture.md",
      size: 100,
      mtimeMs: Date.now(),
    };

    await ingestFile(path.join(TMP, "wiki"), source, mockGenerateText, config);

    const summaryDir = path.join(TMP, "wiki", "summaries");
    const files = await readFile(path.join(summaryDir, "docs-architecture.md"), "utf8");
    expect(files).toContain("pageType: summary");
    expect(files).toContain("Rust");
    expect(files).toContain("eBPF");
  });

  it("creates entity pages", async () => {
    const source = {
      absolutePath: path.join(TMP, "workspace", "docs", "architecture.md"),
      relativePath: "docs/architecture.md",
      size: 100,
      mtimeMs: Date.now(),
    };

    await ingestFile(path.join(TMP, "wiki"), source, mockGenerateText, config);

    const rustPage = await readFile(
      path.join(TMP, "wiki", "entities", "rust.md"),
      "utf8",
    );
    expect(rustPage).toContain("pageType: entity");
    expect(rustPage).toContain("Systems programming language");
  });

  it("skips unchanged file on second ingest", async () => {
    const source = {
      absolutePath: path.join(TMP, "workspace", "docs", "architecture.md"),
      relativePath: "docs/architecture.md",
      size: 100,
      mtimeMs: Date.now(),
    };

    await ingestFile(path.join(TMP, "wiki"), source, mockGenerateText, config);
    const result2 = await ingestFile(
      path.join(TMP, "wiki"),
      source,
      mockGenerateText,
      config,
    );

    expect(result2.skipped).toBe(true);
    expect(result2.claimsAdded).toBe(0);
  });

  it("updates file state cache after ingest", async () => {
    const source = {
      absolutePath: path.join(TMP, "workspace", "docs", "architecture.md"),
      relativePath: "docs/architecture.md",
      size: 100,
      mtimeMs: Date.now(),
    };

    await ingestFile(path.join(TMP, "wiki"), source, mockGenerateText, config);

    const state = await loadFileState(path.join(TMP, "wiki"));
    const entry = state.get("docs/architecture.md");
    expect(entry).toBeDefined();
    expect(entry!.hash.length).toBe(64);
    expect(entry!.pageIds.length).toBeGreaterThan(0);
  });

  it("appends to log after ingest", async () => {
    const source = {
      absolutePath: path.join(TMP, "workspace", "docs", "architecture.md"),
      relativePath: "docs/architecture.md",
      size: 100,
      mtimeMs: Date.now(),
    };

    await ingestFile(path.join(TMP, "wiki"), source, mockGenerateText, config);

    const logContent = await readFile(path.join(TMP, "wiki", "log.md"), "utf8");
    expect(logContent).toContain("ingest");
    expect(logContent).toContain("docs/architecture.md");
    expect(logContent).toContain("2 claims");
  });

  it("merges entity page when ingesting second source mentioning same entity", async () => {
    const source1 = {
      absolutePath: path.join(TMP, "workspace", "docs", "architecture.md"),
      relativePath: "docs/architecture.md",
      size: 100,
      mtimeMs: Date.now(),
    };
    const source2 = {
      absolutePath: path.join(TMP, "workspace", "notes", "meeting.md"),
      relativePath: "notes/meeting.md",
      size: 100,
      mtimeMs: Date.now(),
    };

    await ingestFile(path.join(TMP, "wiki"), source1, mockGenerateText, config);
    await ingestFile(path.join(TMP, "wiki"), source2, mockGenerateText, config);

    const rustPage = await readFile(
      path.join(TMP, "wiki", "entities", "rust.md"),
      "utf8",
    );
    expect(rustPage).toContain("docs-architecture");
    expect(rustPage).toContain("notes-meeting");
  });
});

describe("ingestAll", () => {
  beforeEach(async () => {
    await rm(TMP, { recursive: true, force: true });
    await createWorkspace();
    await initializeWikiVault(path.join(TMP, "wiki"));
  });

  afterEach(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  it("ingests all files in workspace", async () => {
    const result = await ingestAll(
      path.join(TMP, "workspace"),
      path.join(TMP, "wiki"),
      mockGenerateText,
      config,
    );

    expect(result.ingested.length).toBe(2);
    expect(result.errors.length).toBe(0);
  });

  it("updates index.md after batch ingest", async () => {
    await ingestAll(
      path.join(TMP, "workspace"),
      path.join(TMP, "wiki"),
      mockGenerateText,
      config,
    );

    const { readdir: debugReaddir } = await import("node:fs/promises");
    const summaries = await debugReaddir(path.join(TMP, "wiki", "summaries")).catch(() => []);
    const entities = await debugReaddir(path.join(TMP, "wiki", "entities")).catch(() => []);
    const concepts = await debugReaddir(path.join(TMP, "wiki", "concepts")).catch(() => []);
    expect(summaries.length).toBeGreaterThan(0);
    expect(entities.length).toBeGreaterThan(0);
    expect(concepts.length).toBeGreaterThan(0);

    const indexContent = await readFile(
      path.join(TMP, "wiki", "index.md"),
      "utf8",
    );
    expect(indexContent).toContain("Summar");
    expect(indexContent).toContain("Entit");
    expect(indexContent).toContain("Concept");
  });

  it("skips unchanged files on second run", async () => {
    await ingestAll(
      path.join(TMP, "workspace"),
      path.join(TMP, "wiki"),
      mockGenerateText,
      config,
    );

    const result2 = await ingestAll(
      path.join(TMP, "workspace"),
      path.join(TMP, "wiki"),
      mockGenerateText,
      config,
    );

    expect(result2.ingested.length).toBe(0);
    expect(result2.skipped).toBeGreaterThanOrEqual(2);
  });
});
