import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import path from "node:path";
import {
  parseWikiMarkdown,
  renderWikiMarkdown,
  slugifyWikiSegment,
  type WikiClaim,
} from "./markdown.js";
import type { ExtractionResult, ExtractedEntity, ExtractedConcept } from "./types.js";

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, filePath);
}

export function summaryPagePath(sourceRelativePath: string): string {
  const slug = slugifyWikiSegment(sourceRelativePath.replace(/\.[^.]+$/, ""));
  return path.join("summaries", `${slug}.md`);
}

export function entityPagePath(entityName: string): string {
  const slug = slugifyWikiSegment(entityName);
  return path.join("entities", `${slug}.md`);
}

export function conceptPagePath(conceptName: string): string {
  const slug = slugifyWikiSegment(conceptName);
  return path.join("concepts", `${slug}.md`);
}

export async function writeSummaryPage(
  vaultRoot: string,
  sourcePath: string,
  extraction: ExtractionResult,
): Promise<string> {
  const relativePath = summaryPagePath(sourcePath);
  const absolutePath = path.join(vaultRoot, relativePath);
  const slug = slugifyWikiSegment(sourcePath.replace(/\.[^.]+$/, ""));

  const claims: WikiClaim[] = extraction.claims.slice(0, 20).map((c) => ({
    text: c.text,
    confidence: c.confidence,
    status: "active",
    evidence: c.evidence ? [{ note: c.evidence }] : [],
  }));

  const entityLinks = extraction.entities
    .map((e) => `[[${slugifyWikiSegment(e.name)}]]`)
    .join(", ");
  const conceptLinks = extraction.concepts
    .map((c) => `[[${slugifyWikiSegment(c.name)}]]`)
    .join(", ");

  const body = [
    `# ${sourcePath}`,
    "",
    "## Summary",
    extraction.summary,
    "",
    entityLinks ? `**Entities:** ${entityLinks}` : "",
    conceptLinks ? `**Concepts:** ${conceptLinks}` : "",
    "",
    "## Key Claims",
    ...extraction.claims.slice(0, 10).map(
      (c) => `- (${(c.confidence * 100).toFixed(0)}%) ${c.text}`,
    ),
    "",
    `*Source: ${sourcePath}*`,
  ]
    .filter(Boolean)
    .join("\n");

  const content = renderWikiMarkdown({
    frontmatter: {
      pageType: "summary",
      title: sourcePath,
      sourceIds: [`source:${slug}`],
      claims,
      updatedAt: new Date().toISOString(),
    },
    body,
  });
  await atomicWrite(absolutePath, content);
  return relativePath;
}

export async function writeEntityPage(
  vaultRoot: string,
  entity: ExtractedEntity,
  sourcePath: string,
): Promise<string> {
  const relativePath = entityPagePath(entity.name);
  const absolutePath = path.join(vaultRoot, relativePath);

  const existing = await readFile(absolutePath, "utf8").catch(() => null);
  const parsed = existing ? parseWikiMarkdown(existing) : null;

  const sourceLink = `[[${slugifyWikiSegment(sourcePath.replace(/\.[^.]+$/, ""))}]]`;

  if (parsed) {
    const existingSourceIds = Array.isArray(parsed.frontmatter.sourceIds)
      ? (parsed.frontmatter.sourceIds as string[])
      : [];
    if (!existingSourceIds.includes(sourceLink)) {
      existingSourceIds.push(sourceLink);
    }

    const mergedBody = `${parsed.body.trimEnd()}

---
### From: ${sourcePath}
**Type:** ${entity.type}
${entity.description}
`;
    const content = renderWikiMarkdown({
      frontmatter: {
        ...parsed.frontmatter,
        sourceIds: existingSourceIds,
        updatedAt: new Date().toISOString(),
      },
      body: mergedBody,
    });
    await atomicWrite(absolutePath, content);
  } else {
    const body = [
      `# ${entity.name}`,
      "",
      `**Type:** ${entity.type}`,
      "",
      entity.description,
      "",
      `**Sources:** ${sourceLink}`,
    ].join("\n");

    const content = renderWikiMarkdown({
      frontmatter: {
        pageType: "entity",
        title: entity.name,
        sourceIds: [sourceLink],
        claims: [],
        updatedAt: new Date().toISOString(),
      },
      body,
    });
    await atomicWrite(absolutePath, content);
  }

  return relativePath;
}

export async function writeConceptPage(
  vaultRoot: string,
  concept: ExtractedConcept,
  sourcePath: string,
): Promise<string> {
  const relativePath = conceptPagePath(concept.name);
  const absolutePath = path.join(vaultRoot, relativePath);

  const existing = await readFile(absolutePath, "utf8").catch(() => null);
  const parsed = existing ? parseWikiMarkdown(existing) : null;

  const sourceLink = `[[${slugifyWikiSegment(sourcePath.replace(/\.[^.]+$/, ""))}]]`;

  if (parsed) {
    const existingSourceIds = Array.isArray(parsed.frontmatter.sourceIds)
      ? (parsed.frontmatter.sourceIds as string[])
      : [];
    if (!existingSourceIds.includes(sourceLink)) {
      existingSourceIds.push(sourceLink);
    }

    const mergedBody = `${parsed.body.trimEnd()}

---
### From: ${sourcePath}
${concept.description}
`;
    const content = renderWikiMarkdown({
      frontmatter: {
        ...parsed.frontmatter,
        sourceIds: existingSourceIds,
        updatedAt: new Date().toISOString(),
      },
      body: mergedBody,
    });
    await atomicWrite(absolutePath, content);
  } else {
    const relatedLinks = concept.relatedTo
      ?.map((r) => `[[${slugifyWikiSegment(r)}]]`)
      .join(", ");
    const body = [
      `# ${concept.name}`,
      "",
      concept.description,
      "",
      `**Sources:** ${sourceLink}`,
      relatedLinks ? `**Related:** ${relatedLinks}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const content = renderWikiMarkdown({
      frontmatter: {
        pageType: "concept",
        title: concept.name,
        sourceIds: [sourceLink],
        claims: [],
        updatedAt: new Date().toISOString(),
      },
      body,
    });
    await atomicWrite(absolutePath, content);
  }

  return relativePath;
}

export async function writeIndexPage(
  vaultRoot: string,
): Promise<void> {
  const indexPath = path.join(vaultRoot, "index.md");
  const dirs = ["summaries", "entities", "concepts"] as const;
  const byType = new Map<string, Array<{ path: string; title: string; type: string }>>();

  for (const dir of dirs) {
    const dirPath = path.join(vaultRoot, dir);
    let entries: string[];
    try {
      entries = await readdir(dirPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) {
        continue;
      }
      let content: string;
      try {
        content = await readFile(path.join(dirPath, entry), "utf8");
      } catch {
        continue;
      }
      const parsed = parseWikiMarkdown(content);
      const title =
        typeof parsed.frontmatter.title === "string"
          ? parsed.frontmatter.title
          : entry.replace(/\.md$/, "");
      const relativePath = path.join(dir, entry).replace(/\\/g, "/");
      const arr = byType.get(dir) ?? [];
      arr.push({ path: relativePath, title, type: dir });
      byType.set(dir, arr);
    }
  }

  const lines = [
    "# Wiki Index",
    "",
    `*Last updated: ${new Date().toISOString().slice(0, 10)}*`,
    "",
  ];

  for (const dir of dirs) {
    const typePages = byType.get(dir) ?? [];
    if (typePages.length === 0) {
      continue;
    }
    const label = dir.charAt(0).toUpperCase() + dir.slice(1);
    lines.push(`## ${label} (${typePages.length})`);
    lines.push("");
    for (const page of typePages.toSorted((a, b) => a.title.localeCompare(b.title))) {
      const linkPath = page.path.replace(/\.md$/, "").replace(/\\/g, "/");
      lines.push(`- [[${linkPath}]] — ${page.title}`);
    }
    lines.push("");
  }

  await atomicWrite(indexPath, lines.join("\n"));
}
