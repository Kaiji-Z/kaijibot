/**
 * Cumulative token/cost usage scanner.
 *
 * Walks JSONL session transcripts under stateDir/agents/{id}/sessions/ and
 * sums totalTokens and cost.total from assistant-message usage objects.
 * Returns both cumulative totals (across 30 most-recent files) and
 * today totals (files modified since local midnight).
 *
 * Contract: STRICTLY read-only and NEVER throws. A missing directory, an
 * unreadable file, or a malformed JSON line all degrade gracefully -
 * they contribute 0 to the running sum.
 *
 * Performance: caps at the 30 most-recently-modified JSONL files
 * (excluding .deleted. and .checkpoint. archives) to keep latency low.
 */
import { readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface UsageTotals {
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly sessionCount: number;
  readonly todayTokens: number;
  readonly todayCostUsd: number;
  readonly todaySessions: number;
}

const MAX_FILES = 30;
const EMPTY: UsageTotals = {
  totalTokens: 0,
  totalCostUsd: 0,
  sessionCount: 0,
  todayTokens: 0,
  todayCostUsd: 0,
  todaySessions: 0,
};

interface JsonlFile {
  readonly path: string;
  readonly mtime: number;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asFiniteNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Walk every agent's sessions/ directory and collect .jsonl file paths
 * with their modification times. Excludes .deleted. and .checkpoint.
 * archive files. Returns [] on any filesystem error.
 */
async function collectJsonlFiles(stateDir: string): Promise<JsonlFile[]> {
  const agentsDir = join(stateDir, "agents");
  const out: JsonlFile[] = [];

  let agentNames: string[];
  try {
    agentNames = await readdir(agentsDir);
  } catch {
    return out;
  }

  for (const agentName of agentNames) {
    const sessionsDir = join(agentsDir, agentName, "sessions");
    let sessionFiles: string[];
    try {
      sessionFiles = await readdir(sessionsDir);
    } catch {
      continue;
    }
    for (const name of sessionFiles) {
      // Skip archive files — only live transcripts count.
      if (name.includes(".deleted.") || name.includes(".checkpoint.")) {
        continue;
      }
      if (!name.endsWith(".jsonl")) {
        continue;
      }
      const full = join(sessionsDir, name);
      try {
        const st = await stat(full);
        if (st.isFile()) {
          out.push({ path: full, mtime: st.mtimeMs });
        }
      } catch {
        continue;
      }
    }
  }
  return out;
}

/**
 * Parse a single JSONL file and return the summed tokens, cost, and mtime.
 *
 * Each line is parsed defensively — malformed JSON or missing usage fields
 * contribute 0. The usage object may appear at either the top level or
 * nested under message.usage (the standard assistant-message shape).
 */
async function sumFileUsage(
  file: JsonlFile,
): Promise<{ tokens: number; cost: number; mtime: number }> {
  let raw: string;
  try {
    raw = await readFile(file.path, "utf-8");
  } catch {
    return { tokens: 0, cost: 0, mtime: file.mtime };
  }

  let tokens = 0;
  let cost = 0;
  const lines = raw.split("\n");
  for (const line of lines) {
    if (line.length === 0 || !line.includes('"usage"')) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(parsed)) {
      continue;
    }
    // Usage may be top-level or nested under message.
    const usage = isObject(parsed.usage)
      ? parsed.usage
      : isObject(parsed.message) && isObject(parsed.message.usage)
        ? (parsed.message.usage as Record<string, unknown>)
        : null;
    if (usage === null) {
      continue;
    }
    tokens += asFiniteNumber(usage.totalTokens);
    const costObj = usage.cost;
    if (isObject(costObj)) {
      cost += asFiniteNumber(costObj.total);
    }
  }
  return { tokens, cost, mtime: file.mtime };
}

/**
 * Return the local-midnight epoch-ms timestamp for the given date.
 * Files with mtime >= this value are "today".
 */
function startOfTodayMs(now: Date): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d.getTime();
}

/**
 * Scan the 30 most-recent JSONL session files and return cumulative + today
 * token/cost totals.
 *
 * @param stateDir  Root state directory (e.g. ~/.kaijibot).
 * @returns Always returns a {@link UsageTotals} object; missing paths yield
 *          zeros. Never throws.
 */
export async function readUsageTotals(stateDir: string): Promise<UsageTotals> {
  try {
    const files = await collectJsonlFiles(stateDir);
    if (files.length === 0) {
      return EMPTY;
    }

    // Sort by modification time descending, take the most recent MAX_FILES.
    files.sort((a, b) => b.mtime - a.mtime);
    const recent = files.slice(0, MAX_FILES);

    let totalTokens = 0;
    let totalCostUsd = 0;
    let todayTokens = 0;
    let todayCostUsd = 0;
    let todaySessions = 0;
    const midnight = startOfTodayMs(new Date());

    for (const file of recent) {
      const result = await sumFileUsage(file);
      totalTokens += result.tokens;
      totalCostUsd += result.cost;
      if (result.mtime >= midnight) {
        todayTokens += result.tokens;
        todayCostUsd += result.cost;
        todaySessions += 1;
      }
    }

    return {
      totalTokens,
      totalCostUsd,
      sessionCount: recent.length,
      todayTokens,
      todayCostUsd,
      todaySessions,
    };
  } catch {
    return EMPTY;
  }
}
