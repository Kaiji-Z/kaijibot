import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const WIKI_DIRS = ["summaries", "entities", "concepts"] as const;

const AGENTS_MD_CONTENT = `# Wiki Agent Guide

This wiki is maintained by the LLM. You read it; the LLM writes it.

## Operations

- **Ingest**: Read a source file → extract knowledge → write summary/entity/concept pages → update index → log
- **Query**: Read index → find relevant pages → read pages → synthesize answer
- **Lint**: Scan for contradictions, stale claims, orphan pages, missing cross-references

## Page Types

- **summaries/**: One page per ingested source. Contains summary + key claims + links to entities/concepts.
- **entities/**: Named things (people, tools, projects, technologies). Merged across sources.
- **concepts/**: Abstract ideas or methodologies. Merged across sources.

## Conventions

- All pages have YAML frontmatter with pageType, title, sourceIds, claims, updatedAt.
- Cross-references use [[wikilinks]].
- Claims have confidence (0-1) and evidence.
- The LLM updates the wiki when new sources arrive. Humans read, LLM writes.
`;

export type InitVaultResult = {
  vaultPath: string;
  created: boolean;
  createdDirs: string[];
  createdFiles: string[];
};

export async function initializeWikiVault(
  vaultRoot: string,
): Promise<InitVaultResult> {
  const createdDirs: string[] = [];
  const createdFiles: string[] = [];

  for (const dir of WIKI_DIRS) {
    const dirPath = path.join(vaultRoot, dir);
    await mkdir(dirPath, { recursive: true });
    createdDirs.push(dir);
  }

  await mkdir(path.join(vaultRoot, ".kaijibot-wiki"), { recursive: true });
  await mkdir(path.join(vaultRoot, ".kaijibot-wiki", "cache"), {
    recursive: true,
  });

  const agentsPath = path.join(vaultRoot, "AGENTS.md");
  try {
    await writeFile(agentsPath, AGENTS_MD_CONTENT, { flag: "wx" });
    createdFiles.push("AGENTS.md");
  } catch {
    // already exists
  }

  const indexPath = path.join(vaultRoot, "index.md");
  try {
    await writeFile(indexPath, "# Wiki Index\n\n*No pages yet.*\n", {
      flag: "wx",
    });
    createdFiles.push("index.md");
  } catch {
    // already exists
  }

  const logPath = path.join(vaultRoot, "log.md");
  try {
    await writeFile(
      logPath,
      `## [${new Date().toISOString().slice(0, 19)}] init | Wiki vault initialized\n\n`,
      { flag: "wx" },
    );
    createdFiles.push("log.md");
  } catch {
    // already exists
  }

  return {
    vaultPath: vaultRoot,
    created: createdFiles.length > 0,
    createdDirs,
    createdFiles,
  };
}
