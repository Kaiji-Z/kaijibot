import path from "node:path";
import { extractFromSource, type GenerateTextFn } from "./compiler.js";
import type { WikiConfig } from "./config.js";
import {
  computeContentHash,
  isFileChanged,
  loadFileState,
  saveFileState,
  updateEntry,
} from "./file-state.js";
import { appendWikiLog } from "./log.js";
import { readFileContent, scanWorkspace } from "./scanner.js";
import type { IngestResult, SourceFile } from "./types.js";
import type { FileStateEntry } from "./types.js";
import { initializeWikiVault } from "./vault.js";
import {
  writeConceptPage,
  writeEntityPage,
  writeIndexPage,
  writeSummaryPage,
} from "./wiki-writer.js";

export type IngestAllResult = {
  readonly ingested: readonly IngestResult[];
  readonly skipped: number;
  readonly errors: readonly string[];
};

export async function ingestFile(
  vaultRoot: string,
  source: SourceFile,
  generateText: GenerateTextFn,
  _config: WikiConfig,
): Promise<IngestResult> {
  const content = await readFileContent(source.absolutePath);
  const hash = computeContentHash(content);

  const stateMap = await loadFileState(vaultRoot);
  if (!isFileChanged(stateMap, source.relativePath, hash)) {
    return {
      sourcePath: source.relativePath,
      summaryPage: "",
      entityPages: [],
      conceptPages: [],
      claimsAdded: 0,
      skipped: true,
    };
  }

  const extraction = await extractFromSource(generateText, content, {
    path: source.relativePath,
    filename: path.basename(source.relativePath),
  });

  if (!extraction.summary && extraction.claims.length === 0) {
    return {
      sourcePath: source.relativePath,
      summaryPage: "",
      entityPages: [],
      conceptPages: [],
      claimsAdded: 0,
      skipped: true,
    };
  }

  const summaryPage = await writeSummaryPage(vaultRoot, source.relativePath, extraction);

  const entityPages: string[] = [];
  for (const entity of extraction.entities) {
    try {
      const pagePath = await writeEntityPage(
        vaultRoot,
        entity,
        source.relativePath,
        extraction.relationships,
      );
      entityPages.push(pagePath);
    } catch {
      // skip failed entity pages
    }
  }

  const conceptPages: string[] = [];
  for (const concept of extraction.concepts) {
    try {
      const pagePath = await writeConceptPage(
        vaultRoot,
        concept,
        source.relativePath,
        extraction.relationships,
      );
      conceptPages.push(pagePath);
    } catch {
      // skip failed concept pages
    }
  }

  const allPageIds = [summaryPage, ...entityPages, ...conceptPages];
  const mutableMap = stateMap as Map<string, FileStateEntry>;
  updateEntry(mutableMap, source.relativePath, hash, allPageIds);
  await saveFileState(vaultRoot, mutableMap);

  await appendWikiLog(vaultRoot, {
    type: "ingest",
    timestamp: new Date().toISOString(),
    sourcePath: source.relativePath,
    details: [
      `${extraction.claims.length} claims`,
      `${extraction.entities.length} entities`,
      `${extraction.concepts.length} concepts`,
    ],
  });

  return {
    sourcePath: source.relativePath,
    summaryPage,
    entityPages,
    conceptPages,
    claimsAdded: extraction.claims.length,
    skipped: false,
  };
}

export async function ingestAll(
  workspaceDir: string,
  vaultRoot: string,
  generateText: GenerateTextFn,
  config: WikiConfig,
): Promise<IngestAllResult> {
  const scanResult = await scanWorkspace(workspaceDir, config);
  const ingested: IngestResult[] = [];
  const errors: string[] = [...scanResult.errors];
  let skipped = scanResult.skipped;

  for (const source of scanResult.files) {
    try {
      const result = await ingestFile(vaultRoot, source, generateText, config);
      if (result.skipped) {
        skipped++;
      } else {
        ingested.push(result);
      }
    } catch (err) {
      errors.push(
        `ingest failed for ${source.relativePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (ingested.length > 0) {
    try {
      await writeIndexPage(vaultRoot);
    } catch {
      // index update is non-fatal
    }
  }

  return { ingested, skipped, errors };
}

export type WikiIngestWorkspace = {
  readonly workspaceDir: string;
  readonly agentIds: readonly string[];
};

export type WikiIngestAgentResult = {
  readonly agentIds: readonly string[];
  readonly compiled: number;
  readonly skipped: number;
  readonly errors: number;
  readonly durationMs: number;
};

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<{ results: T[]; errors: string[] }> {
  if (tasks.length === 0) {
    return { results: [], errors: [] };
  }
  const resolvedLimit = Math.max(1, Math.min(limit, tasks.length));
  const results: T[] = Array.from({ length: tasks.length });
  const errors: string[] = [];
  let next = 0;
  const workers = Array.from({ length: resolvedLimit }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= tasks.length) {
        return;
      }
      try {
        results[index] = await tasks[index]!();
      } catch (err) {
        errors.push(String(err));
      }
    }
  });
  await Promise.allSettled(workers);
  return { results, errors };
}

export async function runWikiIngestAllAgents(params: {
  readonly workspaces: readonly WikiIngestWorkspace[];
  readonly resolveVaultRoot: (workspaceDir: string) => string;
  readonly generateText: GenerateTextFn;
  readonly config: WikiConfig;
  readonly concurrency: number;
}): Promise<WikiIngestAgentResult[]> {
  if (params.workspaces.length === 0) {
    return [];
  }

  const tasks = params.workspaces.map(
    (ws: WikiIngestWorkspace) => async (): Promise<WikiIngestAgentResult> => {
      const vaultRoot = params.resolveVaultRoot(ws.workspaceDir);
      const startTime = Date.now();
      try {
        await initializeWikiVault(vaultRoot);
        const result = await ingestAll(
          ws.workspaceDir,
          vaultRoot,
          params.generateText,
          params.config,
        );
        return {
          agentIds: ws.agentIds,
          compiled: result.ingested.length,
          skipped: result.skipped,
          errors: result.errors.length,
          durationMs: Date.now() - startTime,
        };
      } catch {
        return {
          agentIds: ws.agentIds,
          compiled: 0,
          skipped: 0,
          errors: 1,
          durationMs: Date.now() - startTime,
        };
      }
    },
  );

  const { results } = await runWithConcurrency(tasks, params.concurrency);
  return results;
}
