export type VerifiableResult = {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  [key: string]: unknown;
};

export type VerifiedResult<T extends VerifiableResult = VerifiableResult> =
  T & {
    /** Whether the snippet was verified to still exist at the claimed location */
    verified: boolean;
    /** If found at a different location, the corrected start line */
    actualStartLine?: number;
    /** If found at a different location, the corrected end line */
    actualEndLine?: number;
  };

export type RecallVerifyConfig = {
  /** Enable/disable post-search verification. Default: false */
  enabled: boolean;
  /** Lines to search around the claimed range when content has shifted. Default: 20 */
  fuzzyWindow: number;
};

export const DEFAULT_RECALL_VERIFY_CONFIG: RecallVerifyConfig = {
  enabled: false,
  fuzzyWindow: 20,
};

export type FileReader = {
  readFile: (relPath: string) => Promise<string | null>;
};

function normalizeForComparison(text: string): string {
  return text.trim().replaceAll(/\s+/g, " ");
}

/**
 * Verify search results by re-reading source files and checking that snippets
 * still exist at the claimed line ranges.
 *
 * When `config.enabled` is false (the default), every result is returned with
 * `verified: true` — the caller trusts the index.
 *
 * When enabled, each result goes through:
 * 1. Read the source file.
 * 2. Compare the snippet at the claimed range (whitespace-normalized).
 * 3. If not found, slide a window of the same height within ±`fuzzyWindow`.
 * 4. Return corrected `actualStartLine` / `actualEndLine` when relocated.
 */
export async function verifySearchResults<T extends VerifiableResult>(
  results: T[],
  fileReader: FileReader,
  config: Partial<RecallVerifyConfig> = {},
): Promise<VerifiedResult<T>[]> {
  const resolved: RecallVerifyConfig = {
    enabled: config.enabled ?? DEFAULT_RECALL_VERIFY_CONFIG.enabled,
    fuzzyWindow: config.fuzzyWindow ?? DEFAULT_RECALL_VERIFY_CONFIG.fuzzyWindow,
  };

  if (!resolved.enabled) {
    return results.map((r) => ({ ...r, verified: true }));
  }

  const verified: VerifiedResult<T>[] = [];

  for (const result of results) {
    const content = await fileReader.readFile(result.path);

    if (content === null) {
      verified.push({ ...result, verified: false });
      continue;
    }

    const lines = content.split("\n");
    const snippetNorm = normalizeForComparison(result.snippet);
    const rangeHeight = result.endLine - result.startLine + 1;

    const claimedSlice = lines.slice(
      result.startLine - 1,
      result.endLine,
    );
    const claimedNorm = normalizeForComparison(claimedSlice.join("\n"));

    if (claimedNorm.includes(snippetNorm)) {
      verified.push({ ...result, verified: true });
      continue;
    }

    const searchStart = Math.max(1, result.startLine - resolved.fuzzyWindow);
    const searchEnd = Math.min(
      lines.length,
      result.endLine + resolved.fuzzyWindow,
    );

    let found = false;
    for (let pos = searchStart; pos + rangeHeight - 1 <= searchEnd; pos++) {
      const candidateSlice = lines.slice(pos - 1, pos - 1 + rangeHeight);
      const candidateNorm = normalizeForComparison(candidateSlice.join("\n"));

      if (candidateNorm.includes(snippetNorm)) {
        verified.push({
          ...result,
          verified: true,
          actualStartLine: pos,
          actualEndLine: pos + rangeHeight - 1,
        });
        found = true;
        break;
      }
    }

    if (!found) {
      verified.push({ ...result, verified: false });
    }
  }

  return verified;
}
