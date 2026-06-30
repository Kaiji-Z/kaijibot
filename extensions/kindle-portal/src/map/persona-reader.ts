/**
 * Read-only PersonaStore JSON reader.
 *
 * Loads `~/.kaijibot/cognitive/persona/<agentId>/<userId>.json` (or any
 * equivalently-laid-out `stateDir`) and returns a typed `PersonaTree`.
 *
 * This module is STRICTLY read-only — it must never call writeFile, mkdir,
 * unlink, rename, or cp. The tests assert this.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PersonaTree } from "../types.js";

/**
 * Load and parse a PersonaStore file.
 *
 * @param stateDir  Root state directory (e.g. `~/.kaijibot`)
 * @param agentId   Agent subdirectory name
 * @param userId    User id (without `.json` suffix)
 * @returns Parsed `PersonaTree`, or `null` on missing file, parse error,
 *          permission error, or shape validation failure. Never throws.
 */
export async function readPersona(
  stateDir: string,
  agentId: string,
  userId: string,
): Promise<PersonaTree | null> {
  const file = path.join(
    stateDir,
    "cognitive",
    "persona",
    agentId,
    `${userId}.json`,
  );

  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch {
    // ENOENT and any other read failure → graceful null
    return null;
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof data !== "object" || data === null) {return null;}
  const obj = data as Record<string, unknown>;
  if (typeof obj.domains !== "object" || obj.domains === null) {return null;}

  // Cast carefully: additional fields are tolerated by the structural type.
  return data as PersonaTree;
}
