import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { lintWiki } from "./lint.js";

const TMP = path.join(process.cwd(), ".tmp-lint-test");

async function createPage(
  dir: string,
  name: string,
  frontmatter: Record<string, unknown>,
  body: string,
): Promise<void> {
  const dirPath = path.join(TMP, "wiki", dir);
  await mkdir(dirPath, { recursive: true });
  const yamlLines = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${k}:\n${v.map((item) => `  - ${JSON.stringify(item)}`).join("\n")}`;
      }
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join("\n");
  await writeFile(path.join(dirPath, `${name}.md`), `---\n${yamlLines}\n---\n${body}`, "utf8");
}

describe("lintWiki", () => {
  beforeEach(async () => {
    await rm(TMP, { recursive: true, force: true });
    await mkdir(path.join(TMP, "wiki"), { recursive: true });
  });

  afterEach(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  it("returns empty orphan issues for interconnected wiki", async () => {
    await createPage(
      "summaries",
      "doc1",
      {
        pageType: "summary",
        title: "Doc1",
        claims: [],
        sourceIds: [],
        updatedAt: new Date().toISOString(),
      },
      "# Doc1\n\nSee [[rust]] for details.",
    );
    await createPage(
      "entities",
      "rust",
      {
        pageType: "entity",
        title: "Rust",
        claims: [],
        sourceIds: ["[[doc1]]"],
        updatedAt: new Date().toISOString(),
      },
      "# Rust\n\n[[doc1]]",
    );

    const report = await lintWiki(path.join(TMP, "wiki"));
    expect(report.totalPages).toBe(2);
    const orphanIssues = report.issues.filter((i) => i.category === "orphan");
    expect(orphanIssues).toHaveLength(0);
  });

  it("detects orphan entity pages (no inbound links)", async () => {
    await createPage(
      "summaries",
      "doc1",
      {
        pageType: "summary",
        title: "Doc1",
        claims: [],
        sourceIds: [],
        updatedAt: new Date().toISOString(),
      },
      "# Doc1",
    );
    await createPage(
      "entities",
      "orphan",
      {
        pageType: "entity",
        title: "Orphan",
        claims: [],
        sourceIds: [],
        updatedAt: new Date().toISOString(),
      },
      "# Orphan\n\nNobody links to me.",
    );

    const report = await lintWiki(path.join(TMP, "wiki"));
    const orphanIssue = report.issues.find(
      (i) => i.category === "orphan" && i.pagePath === "entities/orphan.md",
    );
    expect(orphanIssue).toBeDefined();
  });

  it("does not flag summary pages as orphans", async () => {
    await createPage(
      "summaries",
      "doc1",
      {
        pageType: "summary",
        title: "Doc1",
        claims: [],
        sourceIds: [],
        updatedAt: new Date().toISOString(),
      },
      "# Doc1\n\n[[rust]]",
    );
    await createPage(
      "entities",
      "rust",
      {
        pageType: "entity",
        title: "Rust",
        claims: [],
        sourceIds: [],
        updatedAt: new Date().toISOString(),
      },
      "# Rust",
    );

    const report = await lintWiki(path.join(TMP, "wiki"));
    const summaryOrphanIssues = report.issues.filter(
      (i) => i.category === "orphan" && i.pagePath.startsWith("summaries/"),
    );
    expect(summaryOrphanIssues).toHaveLength(0);
  });

  it("detects inbound links via bare wikilink name", async () => {
    await createPage(
      "summaries",
      "doc1",
      {
        pageType: "summary",
        title: "Doc1",
        claims: [],
        sourceIds: [],
        updatedAt: new Date().toISOString(),
      },
      "# Doc1\n\nSee [[rust]] for details.",
    );
    await createPage(
      "entities",
      "rust",
      {
        pageType: "entity",
        title: "Rust",
        claims: [],
        sourceIds: [],
        updatedAt: new Date().toISOString(),
      },
      "# Rust\n\nA programming language.",
    );

    const report = await lintWiki(path.join(TMP, "wiki"));
    const rustOrphan = report.issues.find(
      (i) => i.category === "orphan" && i.pagePath === "entities/rust.md",
    );
    expect(rustOrphan).toBeUndefined();
  });

  it("detects inbound links via path-prefixed wikilink", async () => {
    await createPage(
      "summaries",
      "doc1",
      {
        pageType: "summary",
        title: "Doc1",
        claims: [],
        sourceIds: [],
        updatedAt: new Date().toISOString(),
      },
      "# Doc1\n\nSee [[entities/rust]] for details.",
    );
    await createPage(
      "entities",
      "rust",
      {
        pageType: "entity",
        title: "Rust",
        claims: [],
        sourceIds: [],
        updatedAt: new Date().toISOString(),
      },
      "# Rust",
    );

    const report = await lintWiki(path.join(TMP, "wiki"));
    const rustOrphan = report.issues.find(
      (i) => i.category === "orphan" && i.pagePath === "entities/rust.md",
    );
    expect(rustOrphan).toBeUndefined();
  });

  it("assigns correct page kind for each directory", async () => {
    await createPage(
      "summaries",
      "s1",
      {
        pageType: "summary",
        title: "S1",
        claims: [],
        sourceIds: [],
        updatedAt: new Date().toISOString(),
      },
      "# S1",
    );
    await createPage(
      "entities",
      "e1",
      {
        pageType: "entity",
        title: "E1",
        claims: [],
        sourceIds: [],
        updatedAt: new Date().toISOString(),
      },
      "# E1\n\n[[s1]]",
    );
    await createPage(
      "concepts",
      "c1",
      {
        pageType: "concept",
        title: "C1",
        claims: [],
        sourceIds: [],
        updatedAt: new Date().toISOString(),
      },
      "# C1\n\n[[s1]]",
    );

    const report = await lintWiki(path.join(TMP, "wiki"));
    expect(report.totalPages).toBe(3);
    const summaryOrphans = report.issues.filter(
      (i) => i.category === "orphan" && i.pagePath.startsWith("summaries/"),
    );
    expect(summaryOrphans).toHaveLength(0);
  });

  it("handles empty wiki gracefully", async () => {
    const report = await lintWiki(path.join(TMP, "wiki"));
    expect(report.totalPages).toBe(0);
    expect(report.issues).toHaveLength(0);
  });

  it("counts total claims correctly", async () => {
    await createPage(
      "summaries",
      "doc1",
      {
        pageType: "summary",
        title: "Doc1",
        claims: [
          { text: "Claim 1", confidence: 0.9, status: "active", evidence: [] },
          { text: "Claim 2", confidence: 0.8, status: "active", evidence: [] },
        ],
        sourceIds: [],
        updatedAt: new Date().toISOString(),
      },
      "# Doc1",
    );

    const report = await lintWiki(path.join(TMP, "wiki"));
    expect(report.totalClaims).toBe(2);
  });

  it("returns checkedAt timestamp", async () => {
    const report = await lintWiki(path.join(TMP, "wiki"));
    expect(report.checkedAt).toBeTruthy();
    expect(new Date(report.checkedAt).getTime()).not.toBeNaN();
  });
});
