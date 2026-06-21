import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseWikiMarkdown } from "./markdown.js";
import type { QueryMatch, QueryResult } from "./types.js";

const QUERY_DIRS = ["summaries", "entities", "concepts"] as const;
const MAX_RESULTS = 10;

export async function queryWiki(
  vaultRoot: string,
  query: string,
  maxResults = MAX_RESULTS,
): Promise<QueryResult> {
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(Boolean);
  const matches: QueryMatch[] = [];

  for (const dir of QUERY_DIRS) {
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
      let content: string;
      try {
        content = await readFile(fullPath, "utf8");
      } catch {
        continue;
      }

      const parsed = parseWikiMarkdown(content);
      const title = typeof parsed.frontmatter.title === "string"
        ? parsed.frontmatter.title
        : entry.replace(/\.md$/, "");
      const pageType = typeof parsed.frontmatter.pageType === "string"
        ? parsed.frontmatter.pageType
        : dir.slice(0, -1);

      const score = scorePage(title, parsed.body, queryLower, queryTerms);
      if (score > 0) {
        matches.push({
          path: path.join(dir, entry),
          title,
          snippet: buildSnippet(parsed.body, queryLower),
          score,
          pageType,
        });
      }
    }
  }

  matches.toSorted((a, b) => b.score - a.score);
  const topMatches = matches.slice(0, maxResults);
  const suggestedPages = matches
    .slice(maxResults, maxResults + 3)
    .map((m) => m.title);

  return { matchedPages: topMatches, suggestedPages };
}

function scorePage(
  title: string,
  body: string,
  queryLower: string,
  queryTerms: readonly string[],
): number {
  const titleLower = title.toLowerCase();
  const bodyLower = body.toLowerCase();
  let score = 0;

  if (titleLower.includes(queryLower)) {
    score += 10;
  }
  if (bodyLower.includes(queryLower)) {
    score += 5;
  }

  for (const term of queryTerms) {
    if (titleLower.includes(term)) {
      score += 3;
    }
    if (bodyLower.includes(term)) {
      score += 1;
    }
  }

  return score;
}

function buildSnippet(body: string, queryLower: string): string {
  const bodyLower = body.toLowerCase();
  const pos = bodyLower.indexOf(queryLower);
  if (pos < 0) {
    const firstPara = body.indexOf("\n\n");
    return firstPara > 0 ? body.slice(0, Math.min(firstPara, 200)) : body.slice(0, 200);
  }
  const start = Math.max(0, pos - 50);
  const end = Math.min(body.length, pos + queryLower.length + 100);
  return `${start > 0 ? "..." : ""}${body.slice(start, end)}${end < body.length ? "..." : ""}`;
}
