/**
 * Read-only cognitive stats scanner.
 *
 * Walks the on-disk cognitive stores under `stateDir` and returns aggregate
 * counts of domains, insights, corrections, and skills. Mirrors the
 * read-only, never-throws contract of `map/persona-reader.ts`.
 *
 * Layouts scanned (robust to one- or two-level nesting via recursive walk):
 *   - domains:     persona JSON files under cognitive/persona
 *   - insights:    JSON array files under cognitive/insights
 *   - corrections: JSON files with a .corrections array under cognitive/corrections
 *   - skills:      subdirectory count under skills/
 *
 * This module is STRICTLY read-only — it never writes, creates, or deletes.
 * Every filesystem operation is wrapped in try/catch; a missing path or a
 * malformed file simply contributes 0 to its counter.
 */
import { readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CognitiveStats } from "../types.js";

export type { CognitiveStats };

/**
 * Recursively collect every `*.json` file under `dir`. Returns `[]` if the
 * directory is missing or unreadable. Never throws.
 */
async function listJsonFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const full = join(dir, name);
    let st;
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      const nested = await listJsonFiles(full);
      for (const n of nested) out.push(n);
    } else if (st.isFile() && name.endsWith(".json")) {
      out.push(full);
    }
  }
  return out;
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

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Scan the cognitive stores and return aggregate counts.
 *
 * @param stateDir  Root state directory (e.g. `~/.kaijibot`)
 * @returns Always returns a `CognitiveStats` object; missing paths yield 0.
 *          Never throws.
 */
export async function readCognitiveStats(stateDir: string): Promise<CognitiveStats> {
  // ── Domains: sum Object.keys(data.domains).length across persona files ──
  let domains = 0;
  try {
    const personaDir = join(stateDir, "cognitive", "persona");
    const files = await listJsonFiles(personaDir);
    for (const f of files) {
      const data = await readJson(f);
      if (isObject(data) && isObject(data.domains)) {
        domains += Object.keys(data.domains).length;
      }
    }
  } catch {
    // swallow — domains stays at current partial sum
  }

  // ── Insights: sum array length across insight files ──
  let insights = 0;
  try {
    const insightsDir = join(stateDir, "cognitive", "insights");
    const files = await listJsonFiles(insightsDir);
    for (const f of files) {
      const data = await readJson(f);
      if (Array.isArray(data)) {
        insights += data.length;
      }
    }
  } catch {
    // swallow
  }

  // ── Corrections: sum .corrections.length across correction files ──
  let corrections = 0;
  try {
    const correctionsDir = join(stateDir, "cognitive", "corrections");
    const files = await listJsonFiles(correctionsDir);
    for (const f of files) {
      const data = await readJson(f);
      if (isObject(data) && Array.isArray(data.corrections)) {
        corrections += data.corrections.length;
      }
    }
  } catch {
    // swallow
  }

  // ── Skills: count subdirectories under stateDir/skills ──
  let skills = 0;
  try {
    const skillsDir = join(stateDir, "skills");
    const names = await readdir(skillsDir);
    for (const name of names) {
      try {
        const st = await stat(join(skillsDir, name));
        if (st.isDirectory()) skills += 1;
      } catch {
        continue;
      }
    }
  } catch {
    // swallow
  }

  return { domains, insights, corrections, skills };
}
