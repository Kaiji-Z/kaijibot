import type { WikiClaim } from "./markdown.js";

// === Source Files (raw input) ===

export type SourceFile = {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly size: number;
  readonly mtimeMs: number;
};

// === LLM Extraction Result ===

export type ExtractedClaim = {
  readonly text: string;
  readonly confidence: number;
  readonly category: string;
  readonly evidence?: string;
};

export type ExtractedEntity = {
  readonly name: string;
  readonly type: string; // person, tool, project, technology, etc.
  readonly description: string;
};

export type ExtractedConcept = {
  readonly name: string;
  readonly description: string;
  readonly relatedTo?: readonly string[];
};

export type ExtractedRelationship = {
  readonly from: string;
  readonly to: string;
  readonly type: string; // "uses", "contradicts", "relates-to", etc.
};

export type ExtractionResult = {
  readonly summary: string;
  readonly claims: readonly ExtractedClaim[];
  readonly entities: readonly ExtractedEntity[];
  readonly concepts: readonly ExtractedConcept[];
  readonly topics: readonly string[];
  readonly relationships: readonly ExtractedRelationship[];
};

// === Wiki Pages (compiled output) ===

export type WikiPageMeta = {
  readonly pageType: "summary" | "entity" | "concept" | "synthesis";
  readonly title: string;
  readonly sourceIds: readonly string[];
  readonly claims: readonly WikiClaim[];
  readonly updatedAt: string;
};

export type CompiledWikiPage = {
  readonly relativePath: string;
  readonly meta: WikiPageMeta;
  readonly body: string;
};

// === Ingest Operations ===

export type IngestEvent = {
  readonly type: "ingest" | "query" | "lint" | "digest";
  readonly timestamp: string;
  readonly sourcePath?: string;
  readonly details?: readonly string[];
};

export type IngestResult = {
  readonly sourcePath: string;
  readonly summaryPage: string;
  readonly entityPages: readonly string[];
  readonly conceptPages: readonly string[];
  readonly claimsAdded: number;
  readonly skipped: boolean;
};

// === File State (incremental processing) ===

export type FileStateEntry = {
  readonly path: string;
  readonly hash: string;
  readonly lastIngestedAt: string;
  readonly pageIds: readonly string[];
};

export type FileStateMap = ReadonlyMap<string, FileStateEntry>;

// === Lint ===

export type LintIssue = {
  readonly severity: "error" | "warning" | "info";
  readonly category: "contradiction" | "orphan" | "stale" | "missing-ref" | "gap";
  readonly pagePath: string;
  readonly description: string;
};

export type LintReport = {
  readonly issues: readonly LintIssue[];
  readonly totalPages: number;
  readonly totalClaims: number;
  readonly checkedAt: string;
};

// === Query ===

export type QueryResult = {
  readonly matchedPages: readonly QueryMatch[];
  readonly suggestedPages: readonly string[];
};

export type QueryMatch = {
  readonly path: string;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly pageType: string;
};
