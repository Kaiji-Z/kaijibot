import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  parseWikiMarkdown,
  extractWikiLinks,
  type WikiPageSummary,
} from "./markdown.js";
import {
  collectWikiClaimHealth,
  buildClaimContradictionClusters,
} from "./claim-health.js";
import type { LintIssue, LintReport } from "./types.js";

const WIKI_DIRS = ["summaries", "entities", "concepts"] as const;

export async function lintWiki(vaultRoot: string): Promise<LintReport> {
  const pages = await readAllWikiPages(vaultRoot);
  const issues: LintIssue[] = [];

  const claimHealth = collectWikiClaimHealth(pages);
  const contradictionClusters = buildClaimContradictionClusters({ pages });

  for (const cluster of contradictionClusters) {
    for (const entry of cluster.entries) {
      issues.push({
        severity: "warning",
        category: "contradiction",
        pagePath: entry.pagePath,
        description: `Contradiction cluster "${cluster.label}": claim "${entry.text}" conflicts across pages`,
      });
    }
  }

  const inboundLinks = buildInboundLinkMap(pages);
  for (const page of pages) {
    const links = inboundLinks.get(page.relativePath) ?? 0;
    if (links === 0 && page.kind !== "source" && page.kind !== "summary") {
      issues.push({
        severity: "info",
        category: "orphan",
        pagePath: page.relativePath,
        description: `No inbound links to this page`,
      });
    }
  }

  for (const claim of claimHealth) {
    if (claim.freshness.level === "stale") {
      issues.push({
        severity: "info",
        category: "stale",
        pagePath: claim.pagePath,
        description: `Claim "${claim.text}" is stale (${claim.freshness.reason})`,
      });
    }
    if (claim.missingEvidence) {
      issues.push({
        severity: "info",
        category: "gap",
        pagePath: claim.pagePath,
        description: `Claim "${claim.text}" has no evidence`,
      });
    }
  }

  return {
    issues,
    totalPages: pages.length,
    totalClaims: claimHealth.length,
    checkedAt: new Date().toISOString(),
  };
}

async function readAllWikiPages(
  vaultRoot: string,
): Promise<WikiPageSummary[]> {
  const pages: WikiPageSummary[] = [];
  for (const dir of WIKI_DIRS) {
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
      const fullPath = path.join(dirPath, entry);
      try {
        const content = await readFile(fullPath, "utf8");
        const parsed = parseWikiMarkdown(content);
        const relativePath = path.join(dir, entry).replace(/\\/g, "/");
        pages.push({
          absolutePath: fullPath,
          relativePath,
          kind: (dir.slice(0, -1) || "summary") as WikiPageSummary["kind"],
          title:
            typeof parsed.frontmatter.title === "string"
              ? parsed.frontmatter.title
              : entry.replace(/\.md$/, ""),
          sourceIds: Array.isArray(parsed.frontmatter.sourceIds)
            ? (parsed.frontmatter.sourceIds as string[])
            : [],
          linkTargets: extractWikiLinks(parsed.body),
          claims: Array.isArray(parsed.frontmatter.claims)
            ? (parsed.frontmatter.claims as WikiPageSummary["claims"])
            : [],
          contradictions: Array.isArray(parsed.frontmatter.contradictions)
            ? (parsed.frontmatter.contradictions as string[])
            : [],
          questions: Array.isArray(parsed.frontmatter.questions)
            ? (parsed.frontmatter.questions as string[])
            : [],
        });
      } catch {
        // skip unreadable pages
      }
    }
  }
  return pages;
}

function buildInboundLinkMap(
  pages: WikiPageSummary[],
): Map<string, number> {
  const inbound = new Map<string, number>();
  for (const page of pages) {
    for (const link of page.linkTargets) {
      const normalized = link.replace(/\.md$/, "");
      inbound.set(normalized, (inbound.get(normalized) ?? 0) + 1);
    }
  }
  return inbound;
}
