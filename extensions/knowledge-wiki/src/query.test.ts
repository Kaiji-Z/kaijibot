import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { queryWiki } from "./query.js";

const TMP = path.join(process.cwd(), ".tmp-query-test");

async function createWikiVault() {
  await mkdir(path.join(TMP, "wiki", "summaries"), { recursive: true });
  await mkdir(path.join(TMP, "wiki", "entities"), { recursive: true });
  await mkdir(path.join(TMP, "wiki", "concepts"), { recursive: true });

  await writeFile(
    path.join(TMP, "wiki", "summaries", "architecture.md"),
    `---
pageType: summary
title: "docs/architecture.md"
---
# docs/architecture.md

We chose Rust for its zero-cost abstractions and memory safety.
The system uses eBPF for kernel-level tracing.
Latency target is under 100ms.`,
    "utf8",
  );

  await writeFile(
    path.join(TMP, "wiki", "entities", "rust.md"),
    `---
pageType: entity
title: "Rust"
---
# Rust

Systems programming language with zero-cost abstractions.`,
    "utf8",
  );

  await writeFile(
    path.join(TMP, "wiki", "entities", "ebpf.md"),
    `---
pageType: entity
title: "eBPF"
---
# eBPF

Kernel-level tracing technology for distributed systems.`,
    "utf8",
  );

  await writeFile(
    path.join(TMP, "wiki", "concepts", "zero-cost-abstractions.md"),
    `---
pageType: concept
title: "Zero-cost abstractions"
---
# Zero-cost abstractions

Abstractions that compile away with no runtime overhead.`,
    "utf8",
  );
}

describe("queryWiki", () => {
  beforeEach(async () => {
    await rm(TMP, { recursive: true, force: true });
    await createWikiVault();
  });

  afterEach(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  it("finds pages matching the query in title", async () => {
    const result = await queryWiki(path.join(TMP, "wiki"), "Rust");
    expect(result.matchedPages.length).toBeGreaterThan(0);
    const rustEntity = result.matchedPages.find((m) => m.title === "Rust");
    expect(rustEntity).toBeDefined();
    expect(rustEntity!.score).toBeGreaterThanOrEqual(10);
  });

  it("finds pages matching the query in body", async () => {
    const result = await queryWiki(path.join(TMP, "wiki"), "eBPF");
    expect(result.matchedPages.length).toBeGreaterThan(0);
    const hasEbpf = result.matchedPages.some((m) =>
      m.snippet.toLowerCase().includes("ebpf"),
    );
    expect(hasEbpf).toBe(true);
  });

  it("finds pages matching multi-word query", async () => {
    const result = await queryWiki(path.join(TMP, "wiki"), "zero cost");
    expect(result.matchedPages.length).toBeGreaterThan(0);
  });

  it("returns empty results for non-matching query", async () => {
    const result = await queryWiki(path.join(TMP, "wiki"), "nonexistent");
    expect(result.matchedPages).toHaveLength(0);
  });

  it("sorts results by score descending", async () => {
    const result = await queryWiki(path.join(TMP, "wiki"), "Rust");
    for (let i = 1; i < result.matchedPages.length; i++) {
      expect(result.matchedPages[i]!.score).toBeLessThanOrEqual(
        result.matchedPages[i - 1]!.score,
      );
    }
  });

  it("respects maxResults limit", async () => {
    const result = await queryWiki(path.join(TMP, "wiki"), "the", 2);
    expect(result.matchedPages.length).toBeLessThanOrEqual(2);
  });

  it("includes snippet in results", async () => {
    const result = await queryWiki(path.join(TMP, "wiki"), "Rust");
    expect(result.matchedPages[0]!.snippet.length).toBeGreaterThan(0);
  });

  it("handles empty vault gracefully", async () => {
    await rm(path.join(TMP, "wiki", "summaries"), { recursive: true });
    await rm(path.join(TMP, "wiki", "entities"), { recursive: true });
    await rm(path.join(TMP, "wiki", "concepts"), { recursive: true });
    const result = await queryWiki(path.join(TMP, "wiki"), "anything");
    expect(result.matchedPages).toHaveLength(0);
  });
});
