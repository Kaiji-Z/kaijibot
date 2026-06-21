import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseWikiMarkdown } from "./markdown.js";
import type { ExtractionResult, ExtractedConcept, ExtractedEntity } from "./types.js";
import {
  entityPagePath,
  summaryPagePath,
  writeConceptPage,
  writeEntityPage,
  writeIndexPage,
  writeSummaryPage,
} from "./wiki-writer.js";

const testExtraction: ExtractionResult = {
  summary: "Test summary about Rust performance",
  claims: [
    { text: "Rust has zero-cost abstractions", confidence: 0.9, category: "domain_knowledge" },
  ],
  entities: [{ name: "Rust", type: "technology", description: "Systems programming language" }],
  concepts: [
    { name: "Zero-cost abstractions", description: "Abstractions with no runtime overhead" },
  ],
  topics: ["rust", "performance"],
  relationships: [],
};

const rustEntity: ExtractedEntity = {
  name: "Rust",
  type: "technology",
  description: "Systems programming language",
};

const zeroCostConcept: ExtractedConcept = {
  name: "Zero-cost abstractions",
  description: "Abstractions with no runtime overhead",
};

describe("wiki-writer", () => {
  let vaultRoot: string;

  beforeEach(async () => {
    vaultRoot = await mkdtemp(path.join(tmpdir(), "wiki-writer-test-"));
  });

  afterEach(async () => {
    await rm(vaultRoot, { recursive: true, force: true });
  });

  describe("writeSummaryPage", () => {
    it("creates the file under the summaries/ directory", async () => {
      const relativePath = await writeSummaryPage(vaultRoot, "notes/rust.md", testExtraction);

      expect(relativePath).toBe(path.join("summaries", "notes-rust.md"));
      expect(relativePath.startsWith(path.join("summaries"))).toBe(true);
      expect(existsSync(path.join(vaultRoot, relativePath))).toBe(true);
    });

    it("writes YAML frontmatter with pageType: summary", async () => {
      const relativePath = await writeSummaryPage(vaultRoot, "notes/rust.md", testExtraction);
      const content = await readFile(path.join(vaultRoot, relativePath), "utf8");

      expect(content.startsWith("---\n")).toBe(true);
      const parsed = parseWikiMarkdown(content);
      expect(parsed.frontmatter.pageType).toBe("summary");
      expect(parsed.frontmatter.title).toBe("notes/rust.md");
    });

    it("embeds the extraction summary text in the page body", async () => {
      const relativePath = await writeSummaryPage(vaultRoot, "notes/rust.md", testExtraction);
      const content = await readFile(path.join(vaultRoot, relativePath), "utf8");

      expect(content).toContain(testExtraction.summary);
    });
  });

  describe("writeEntityPage", () => {
    it("creates a new entity page when none exists yet", async () => {
      const relativePath = await writeEntityPage(vaultRoot, rustEntity, "notes/rust.md");
      const absolutePath = path.join(vaultRoot, relativePath);

      expect(existsSync(absolutePath)).toBe(true);
      expect(relativePath).toBe(path.join("entities", "rust.md"));

      const parsed = parseWikiMarkdown(await readFile(absolutePath, "utf8"));
      expect(parsed.frontmatter.pageType).toBe("entity");
      expect(parsed.frontmatter.title).toBe("Rust");
      expect(parsed.body).toContain("# Rust");
      expect(parsed.body).toContain("**Type:** technology");
      expect(parsed.body).toContain("Systems programming language");
      expect(parsed.body).toContain("[[notes-rust]]");
    });

    it("merges a second source into an existing entity page", async () => {
      await writeEntityPage(vaultRoot, rustEntity, "notes/rust.md");
      const relativePath = await writeEntityPage(vaultRoot, rustEntity, "docs/rust-guide.md");
      const content = await readFile(path.join(vaultRoot, relativePath), "utf8");
      const parsed = parseWikiMarkdown(content);

      const sourceIds = parsed.frontmatter.sourceIds;
      expect(Array.isArray(sourceIds)).toBe(true);
      expect(sourceIds).toContain("[[notes-rust]]");
      expect(sourceIds).toContain("[[docs-rust-guide]]");
      expect(parsed.body).toContain("### From: docs/rust-guide.md");
      // Original content is preserved during merge.
      expect(parsed.body).toContain("# Rust");
      expect(parsed.body).toContain("Systems programming language");
    });
  });

  describe("writeConceptPage", () => {
    it("creates a new concept page when none exists yet", async () => {
      const relativePath = await writeConceptPage(vaultRoot, zeroCostConcept, "notes/rust.md");
      const absolutePath = path.join(vaultRoot, relativePath);

      expect(existsSync(absolutePath)).toBe(true);
      expect(relativePath).toBe(path.join("concepts", "zero-cost-abstractions.md"));

      const parsed = parseWikiMarkdown(await readFile(absolutePath, "utf8"));
      expect(parsed.frontmatter.pageType).toBe("concept");
      expect(parsed.frontmatter.title).toBe("Zero-cost abstractions");
      expect(parsed.body).toContain("# Zero-cost abstractions");
      expect(parsed.body).toContain("Abstractions with no runtime overhead");
      expect(parsed.body).toContain("[[notes-rust]]");
    });

    it("merges a second source into an existing concept page", async () => {
      await writeConceptPage(vaultRoot, zeroCostConcept, "notes/rust.md");
      const relativePath = await writeConceptPage(
        vaultRoot,
        zeroCostConcept,
        "docs/rust-guide.md",
      );
      const content = await readFile(path.join(vaultRoot, relativePath), "utf8");
      const parsed = parseWikiMarkdown(content);

      const sourceIds = parsed.frontmatter.sourceIds;
      expect(Array.isArray(sourceIds)).toBe(true);
      expect(sourceIds).toContain("[[notes-rust]]");
      expect(sourceIds).toContain("[[docs-rust-guide]]");
      expect(parsed.body).toContain("### From: docs/rust-guide.md");
      expect(parsed.body).toContain("# Zero-cost abstractions");
    });
  });

  describe("writeIndexPage", () => {
    it("scans vault directories and builds index from actual files", async () => {
      await mkdir(path.join(vaultRoot, "summaries"), { recursive: true });
      await mkdir(path.join(vaultRoot, "entities"), { recursive: true });
      await mkdir(path.join(vaultRoot, "concepts"), { recursive: true });

      await writeFile(
        path.join(vaultRoot, "summaries", "notes-rust.md"),
        "---\npageType: summary\ntitle: Notes Rust\n---\n# Notes Rust",
        "utf8",
      );
      await writeFile(
        path.join(vaultRoot, "entities", "rust.md"),
        "---\npageType: entity\ntitle: Rust\n---\n# Rust",
        "utf8",
      );
      await writeFile(
        path.join(vaultRoot, "concepts", "zero-cost.md"),
        "---\npageType: concept\ntitle: Zero-cost abstractions\n---\n# Zero-cost",
        "utf8",
      );

      await writeIndexPage(vaultRoot);

      const indexContent = await readFile(path.join(vaultRoot, "index.md"), "utf8");

      expect(indexContent).toContain("# Wiki Index");
      expect(indexContent).toContain("## Summaries (1)");
      expect(indexContent).toContain("## Entities (1)");
      expect(indexContent).toContain("## Concepts (1)");
      expect(indexContent).toContain("[[summaries/notes-rust]] — Notes Rust");
      expect(indexContent).toContain("[[entities/rust]] — Rust");
      expect(indexContent).toContain("[[concepts/zero-cost]] — Zero-cost abstractions");
    });

    it("counts multiple files in same directory", async () => {
      await mkdir(path.join(vaultRoot, "entities"), { recursive: true });

      await writeFile(
        path.join(vaultRoot, "entities", "rust.md"),
        "---\npageType: entity\ntitle: Rust\n---\n# Rust",
        "utf8",
      );
      await writeFile(
        path.join(vaultRoot, "entities", "go.md"),
        "---\npageType: entity\ntitle: Go\n---\n# Go",
        "utf8",
      );

      await writeIndexPage(vaultRoot);

      const indexContent = await readFile(path.join(vaultRoot, "index.md"), "utf8");

      expect(indexContent).toContain("## Entities (2)");
      const goIdx = indexContent.indexOf("[[entities/go]] — Go");
      const rustIdx = indexContent.indexOf("[[entities/rust]] — Rust");
      expect(goIdx).toBeGreaterThan(-1);
      expect(rustIdx).toBeGreaterThan(-1);
      expect(goIdx).toBeLessThan(rustIdx);
    });

    it("handles empty vault gracefully", async () => {
      await writeIndexPage(vaultRoot);

      const indexContent = await readFile(path.join(vaultRoot, "index.md"), "utf8");
      expect(indexContent).toContain("# Wiki Index");
    });

    it("uses filename as title when frontmatter missing", async () => {
      await mkdir(path.join(vaultRoot, "entities"), { recursive: true });
      await writeFile(
        path.join(vaultRoot, "entities", "unknown.md"),
        "# Unknown\n\nNo frontmatter here.",
        "utf8",
      );

      await writeIndexPage(vaultRoot);

      const indexContent = await readFile(path.join(vaultRoot, "index.md"), "utf8");
      expect(indexContent).toContain("[[entities/unknown]] — unknown");
    });
  });

  describe("path helpers", () => {
    it("summaryPagePath slugifies the source relative path under summaries/", () => {
      // Slashes collapse into the slug, so "notes/rust" -> "notes-rust".
      expect(summaryPagePath("notes/rust.md")).toBe(path.join("summaries", "notes-rust.md"));
    });

    it("entityPagePath slugifies the entity name under entities/", () => {
      expect(entityPagePath("Rust")).toBe(path.join("entities", "rust.md"));
      expect(entityPagePath("Zero-cost abstractions")).toBe(
        path.join("entities", "zero-cost-abstractions.md"),
      );
    });
  });
});
