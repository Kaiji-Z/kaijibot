import path from "node:path";
import type { WikiConfig } from "./config.js";
import type { IngestResult, SourceFile } from "./types.js";
import { readFileContent, scanWorkspace } from "./scanner.js";
import {
  computeContentHash,
  isFileChanged,
  loadFileState,
  saveFileState,
  updateEntry,
} from "./file-state.js";
import { extractFromSource, type GenerateTextFn } from "./compiler.js";
import {
  writeConceptPage,
  writeEntityPage,
  writeIndexPage,
  writeSummaryPage,
} from "./wiki-writer.js";
import { appendWikiLog } from "./log.js";
import type { FileStateEntry } from "./types.js";

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

  const summaryPage = await writeSummaryPage(
    vaultRoot,
    source.relativePath,
    extraction,
  );

  const entityPages: string[] = [];
  for (const entity of extraction.entities) {
    try {
      const pagePath = await writeEntityPage(
        vaultRoot,
        entity,
        source.relativePath,
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
