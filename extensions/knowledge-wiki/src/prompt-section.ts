import { readFileSync } from "node:fs";
import path from "node:path";
import type { WikiConfig } from "./config.js";
import { resolveEffectiveVaultRoot } from "./config.js";

export function createWikiPromptSectionBuilder(config: WikiConfig) {
  return function buildWikiPromptSection(params: {
    availableTools: Set<string>;
    citationsMode?: string;
    agentId?: string;
    workspaceDir?: string;
  }): string[] {
    if (!config.enabled) {
      return [];
    }

    const hasIngest = params.availableTools.has("wiki_ingest");
    const hasQuery = params.availableTools.has("wiki_query");
    const hasLint = params.availableTools.has("wiki_lint");

    if (!hasIngest && !hasQuery && !hasLint) {
      return [];
    }

    const vaultRoot = resolveEffectiveVaultRoot(config, params.workspaceDir);

    const lines: string[] = ["## Knowledge Wiki"];

    const stats = readIndexStats(vaultRoot);
    if (stats) {
      lines.push(
        `Compiled: ${stats.summaries} sources, ${stats.entities} entities, ${stats.concepts} concepts.`,
      );
    }

    if (hasQuery) {
      lines.push(
        "Use `wiki_query` to search the compiled knowledge wiki before answering questions about prior work or accumulated knowledge.",
      );
    }
    if (hasIngest) {
      lines.push(
        "Use `wiki_ingest` when the user shares a document or file — the LLM compiles it into structured wiki pages.",
      );
    }
    if (hasLint) {
      lines.push("Use `wiki_lint` to health-check the wiki for contradictions and stale claims.");
    }

    return lines;
  };
}

function readIndexStats(vaultRoot: string): {
  summaries: number;
  entities: number;
  concepts: number;
} | null {
  try {
    const indexContent = readFileSync(path.join(vaultRoot, "index.md"), "utf8");
    const summaries = (indexContent.match(/summaries\//g) ?? []).length;
    const entities = (indexContent.match(/entities\//g) ?? []).length;
    const concepts = (indexContent.match(/concepts\//g) ?? []).length;
    return { summaries, entities, concepts };
  } catch {
    return null;
  }
}
