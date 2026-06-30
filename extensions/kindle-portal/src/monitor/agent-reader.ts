/**
 * Read all registered agents from config + session status from session store.
 *
 * Walks `~/.kaijibot/kaijibot.json` → `agents.list` to enumerate every
 * configured agent (e.g. "main", "testagent"), then reads each agent's
 * `sessions/sessions.json` to count sessions and find the most recent
 * `updatedAt` timestamp.
 *
 * Contract: STRICTLY read-only and NEVER throws. A missing config file, a
 * malformed agent entry, or an unreadable sessions.json all degrade
 * gracefully — the offending agent is either omitted or rendered with
 * zero counts. Mirrors the never-throws contract of `cognitive-reader.ts`.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoadSessionStore } from "./scope-resolver.js";

/**
 * A single registered agent, enriched with session-store-derived stats.
 */
export interface AgentInfo {
  readonly id: string;
  readonly model: string;
  readonly isDefault: boolean;
  readonly status: "active" | "idle";
  readonly lastActiveAt?: number;
  readonly sessionCount: number;
  readonly contextUsed?: number;
  readonly contextMax?: number;
}

/** Structural guard for a config agents.list entry. */
interface ConfigAgentEntry {
  readonly id?: unknown;
  readonly default?: unknown;
  readonly model?: unknown;
}

/** Structural guard for a sessions.json record. */
interface SessionRecord {
  readonly updatedAt?: unknown;
  readonly totalTokens?: unknown;
  readonly contextTokens?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Read + parse a JSON file; return `null` on any read/parse failure. */
async function readJson(file: string): Promise<unknown> {
  try {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Extract the `agents.list` array from a parsed kaijibot.json config object.
 * Returns `[]` if the structure is missing or malformed.
 */
function extractAgentList(configRoot: unknown): readonly ConfigAgentEntry[] {
  if (!isObject(configRoot)) {
    return [];
  }
  const agents = configRoot.agents;
  if (!isObject(agents)) {
    return [];
  }
  const list = agents.list;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter((e): e is ConfigAgentEntry => isObject(e));
}

/**
 * Read `stateDir/agents/<id>/sessions/sessions.json` and return the session
 * count plus the largest `updatedAt` timestamp. Returns `{ 0, undefined }`
 * when the file is missing or unreadable.
 */
async function readAgentSessionStats(
  stateDir: string,
  agentId: string,
): Promise<{
  readonly count: number;
  readonly lastActiveAt?: number;
  readonly contextUsed?: number;
  readonly contextMax?: number;
}> {
  const file = join(stateDir, "agents", agentId, "sessions", "sessions.json");
  const data = await readJson(file);
  if (!isObject(data)) {
    return { count: 0 };
  }

  let count = 0;
  let lastActiveAt: number | undefined;
  let contextUsed: number | undefined;
  let contextMax: number | undefined;
  for (const key of Object.keys(data)) {
    const entry = data[key];
    if (!isObject(entry)) {
      continue;
    }
    count += 1;
    const rec: SessionRecord = entry;
    const ts = asNumber(rec.updatedAt);
    if (ts !== undefined && (lastActiveAt === undefined || ts > lastActiveAt)) {
      lastActiveAt = ts;
      contextUsed = asNumber(rec.totalTokens);
      contextMax = asNumber(rec.contextTokens);
    }
  }
  return { count, lastActiveAt, contextUsed, contextMax };
}

/**
 * Read all registered agents from config, enriched with session counts.
 *
 * @param stateDir   Root state directory (e.g. `~/.kaijibot`).
 * @param _loadStore Session store loader (reserved for future active-state
 *                    enrichment; currently unused — agents default to "idle"
 *                    and the HTTP layer merges in fleet active state).
 * @returns Always returns an array; never throws. Empty on hard failure.
 */
export async function readAllAgents(
  stateDir: string,
  _loadStore?: LoadSessionStore,
): Promise<AgentInfo[]> {
  try {
    const configFile = join(stateDir, "kaijibot.json");
    const configRoot = await readJson(configFile);
    const list = extractAgentList(configRoot);

    const out: AgentInfo[] = [];
    for (const entry of list) {
      try {
        const id = asString(entry.id);
        if (id === undefined) {
          continue;
        }
        const modelBlock = isObject(entry.model) ? entry.model : {};
        const model = asString(modelBlock.primary) ?? "unknown";
        const isDefault = entry.default === true;
        const stats = await readAgentSessionStats(stateDir, id);
        out.push({
          id,
          model,
          isDefault,
          status: "idle",
          lastActiveAt: stats.lastActiveAt,
          sessionCount: stats.count,
          contextUsed: stats.contextUsed,
          contextMax: stats.contextMax,
        });
      } catch {
        // Skip a single malformed agent entry; keep processing the rest.
        continue;
      }
    }
    return out;
  } catch {
    return [];
  }
}
