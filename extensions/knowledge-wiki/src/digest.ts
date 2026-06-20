import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseWikiMarkdown } from "./markdown.js";
import type { WikiConfig } from "./config.js";

const MAX_DIGEST_CLAIMS = 8;
const MAX_RECENT_ENTRIES = 5;
const DIGEST_BUDGET_BYTES = 2048;

export type DigestResult = {
  readonly section: string;
  readonly sourceCount: number;
  readonly pageCount: number;
  readonly claimCount: number;
  readonly hasWiki: boolean;
};

export async function buildDigest(
  vaultRoot: string,
  config: WikiConfig,
): Promise<DigestResult> {
  if (!config.enabled) {
    return { section: "", sourceCount: 0, pageCount: 0, claimCount: 0, hasWiki: false };
  }

  let indexContent: string;
  try {
    indexContent = await readFile(path.join(vaultRoot, "index.md"), "utf8");
  } catch {
    return { section: "", sourceCount: 0, pageCount: 0, claimCount: 0, hasWiki: false };
  }

  const stats = parseIndexStats(indexContent);
  const topClaims = await collectTopClaims(vaultRoot);
  const recentActivity = await readRecentLog(vaultRoot);

  const lines: string[] = [
    "## Knowledge Wiki (compiled)",
    "",
    `Sources: ${stats.sourceCount} | Pages: ${stats.pageCount} | Claims: ${stats.claimCount}`,
    "",
  ];

  if (topClaims.length > 0) {
    lines.push("### High-Confidence Claims");
    for (const claim of topClaims) {
      lines.push(`- ${claim.text} (conf: ${claim.confidence.toFixed(2)}, src: ${claim.source})`);
    }
    lines.push("");
  }

  if (recentActivity.length > 0) {
    lines.push("### Recent Activity");
    for (const entry of recentActivity) {
      lines.push(`- ${entry}`);
    }
  }

  let section = lines.join("\n");
  if (section.length > DIGEST_BUDGET_BYTES) {
    section = section.slice(0, DIGEST_BUDGET_BYTES) + "\n...";
  }

  return {
    section,
    sourceCount: stats.sourceCount,
    pageCount: stats.pageCount,
    claimCount: stats.claimCount,
    hasWiki: true,
  };
}

type IndexStats = {
  sourceCount: number;
  pageCount: number;
  claimCount: number;
};

function parseIndexStats(indexContent: string): IndexStats {
  const lines = indexContent.split("\n");
  let pageCount = 0;
  let sourceCount = 0;

  for (const line of lines) {
    if (line.startsWith("- [[")) {
      pageCount++;
      if (line.includes("/summaries/")) {
        sourceCount++;
      }
    }
  }

  return { sourceCount, pageCount, claimCount: 0 };
}

type TopClaim = {
  text: string;
  confidence: number;
  source: string;
};

async function collectTopClaims(vaultRoot: string): Promise<TopClaim[]> {
  const summariesDir = path.join(vaultRoot, "summaries");
  let entries: string[];
  try {
    const { readdir } = await import("node:fs/promises");
    entries = await readdir(summariesDir);
  } catch {
    return [];
  }

  const allClaims: TopClaim[] = [];

  for (const entry of entries.slice(0, 20)) {
    if (!entry.endsWith(".md")) {
      continue;
    }
    try {
      const content = await readFile(path.join(summariesDir, entry), "utf8");
      const parsed = parseWikiMarkdown(content);
      const claims = Array.isArray(parsed.frontmatter.claims)
        ? parsed.frontmatter.claims
        : [];
      const title = typeof parsed.frontmatter.title === "string"
        ? parsed.frontmatter.title
        : entry;

      for (const claim of claims) {
        if (typeof claim !== "object" || claim === null) {
          continue;
        }
        const c = claim as { text?: string; confidence?: number };
        if (typeof c.text === "string" && typeof c.confidence === "number") {
          allClaims.push({
            text: c.text,
            confidence: c.confidence,
            source: path.basename(title),
          });
        }
      }
    } catch {
      continue;
    }
  }

  return allClaims
    .toSorted((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_DIGEST_CLAIMS);
}

async function readRecentLog(vaultRoot: string): Promise<string[]> {
  let logContent: string;
  try {
    logContent = await readFile(path.join(vaultRoot, "log.md"), "utf8");
  } catch {
    return [];
  }

  const entries = logContent
    .split("\n")
    .filter((line) => line.startsWith("## ["))
    .slice(-MAX_RECENT_ENTRIES);

  return entries.map((line) => {
    const match = line.match(/^## \[([^\]]+)\] (.+)$/);
    if (match && match[2]) {
      return `${match[1]} ${match[2]}`;
    }
    return line.replace(/^## /, "");
  });
}

export function buildWikiToolGuidance(availableTools: Set<string>): string[] {
  const hasIngest = availableTools.has("wiki_ingest");
  const hasQuery = availableTools.has("wiki_query");
  const hasLint = availableTools.has("wiki_lint");

  if (!hasIngest && !hasQuery && !hasLint) {
    return [];
  }

  const lines: string[] = [];

  if (hasQuery) {
    lines.push(
      "Use `wiki_query` to search the compiled knowledge wiki before answering questions about prior work, decisions, or accumulated knowledge.",
    );
  }
  if (hasIngest) {
    lines.push(
      "Use `wiki_ingest` when the user shares a document, note, or file — the LLM compiles it into structured wiki pages.",
    );
  }
  if (hasLint) {
    lines.push(
      "Use `wiki_lint` periodically to health-check the wiki for contradictions, stale claims, and missing cross-references.",
    );
  }

  return lines;
}
