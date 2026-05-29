/**
 * Resolve a feishu userId (ou_xxx) from a session file path.
 *
 * The session store maps sessionKey → { sessionId, ... }.
 * Session keys for feishu follow the pattern:
 *   agent:main:feishu:direct:ou_xxx
 *   agent:main:feishu:group:oc_xxx:...:sender:ou_xxx
 *
 * This module loads sessions.json, finds the sessionKey for the file's
 * sessionId, and extracts the userId.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

type SessionStoreEntry = {
  sessionId: string;
  sessionFile?: string;
};

type SessionStore = Record<string, SessionStoreEntry>;

// Simple TTL cache to avoid repeated reads of the same sessions.json
const storeCache = new Map<string, { store: SessionStore; loadedAt: number }>();
const CACHE_TTL_MS = 60_000;

/**
 * Extract the bare sessionId from a session filename.
 *
 * Handles:
 *   abc-123.jsonl                        → abc-123
 *   abc-123.jsonl.reset.2026-04-02...    → abc-123
 *   abc-123.jsonl.deleted.2026-04-02...  → abc-123
 */
function extractSessionIdFromFileName(fileName: string): string {
  let name = fileName;
  // Strip .jsonl and all trailing suffixes (.reset.*, .deleted.*)
  const jsonlIdx = name.indexOf(".jsonl");
  if (jsonlIdx >= 0) {
    name = name.slice(0, jsonlIdx);
  }
  return name;
}

/**
 * Extract a feishu userId (ou_xxx) from a session key.
 *
 * Pattern:
 *   agent:main:feishu:direct:ou_xxx → ou_xxx
 *   agent:main:feishu:group:oc_xxx:...:sender:ou_xxx → ou_xxx
 *   agent:ou_xxx:rest → ou_xxx (fallback)
 */
function extractUserIdFromSessionKey(sessionKey: string): string | null {
  const parts = sessionKey.split(":");
  const tail = parts[parts.length - 1];
  if (tail && tail !== "main" && tail.startsWith("ou_")) {
    return tail;
  }
  // Fallback: agent:ou_xxx:rest → ou_xxx
  if (parts.length >= 3 && parts[1] && parts[1] !== "main") {
    return parts[1];
  }
  return null;
}

async function loadSessionStore(sessionsDir: string): Promise<SessionStore> {
  const cached = storeCache.get(sessionsDir);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.store;
  }

  const storePath = join(sessionsDir, "sessions.json");
  if (!existsSync(storePath)) {
    return {};
  }

  try {
    const raw = await readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const store = parsed as SessionStore;
      storeCache.set(sessionsDir, { store, loadedAt: Date.now() });
      return store;
    }
  } catch {
    // Corrupt or unreadable — return empty
  }
  return {};
}

/**
 * Resolve the feishu userId (ou_xxx) for a session file.
 *
 * @param filePath - Absolute path to a .jsonl session transcript file.
 * @returns The userId string (e.g. "ou_xxx"), or null if it cannot be resolved.
 */
export async function resolveUserIdForSessionFile(filePath: string): Promise<string | null> {
  const sessionsDir = dirname(filePath);
  const fileName = basename(filePath);
  const targetSessionId = extractSessionIdFromFileName(fileName);

  if (!targetSessionId) {
    return null;
  }

  const store = await loadSessionStore(sessionsDir);

  // Find the sessionKey whose entry has this sessionId
  for (const [sessionKey, entry] of Object.entries(store)) {
    if (entry.sessionId === targetSessionId) {
      return extractUserIdFromSessionKey(sessionKey);
    }
  }

  // Also try matching by sessionFile basename (some entries may store relative paths)
  for (const [sessionKey, entry] of Object.entries(store)) {
    const entryFile = entry.sessionFile?.trim();
    if (!entryFile) {continue;}
    const entryBase = basename(entryFile);
    const entrySessionId = extractSessionIdFromFileName(entryBase);
    if (entrySessionId === targetSessionId) {
      return extractUserIdFromSessionKey(sessionKey);
    }
  }

  return null;
}
