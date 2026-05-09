import fs from "node:fs/promises";
import path from "node:path";
import { hasInterSessionUserProvenance } from "../../../sessions/input-provenance.js";

function extractTextMessageContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const candidate = block as { type?: unknown; text?: unknown };
    if (candidate.type === "text" && typeof candidate.text === "string") {
      return candidate.text;
    }
  }
  return undefined;
}

const MESSAGE_ID_LINE_RE = /\[message_id:\s*\S+\]\s*\n/;
const SENDER_ID_PREFIX_RE = /^ou_\w+:\s*/;

export function stripMessageMetadata(text: string): string {
  if (!text.includes("Conversation info (untrusted metadata):")) {
    return text;
  }

  let cleaned = text;
  const messageIdMatch = MESSAGE_ID_LINE_RE.exec(cleaned);
  if (messageIdMatch) {
    cleaned = cleaned.slice(messageIdMatch.index + messageIdMatch[0].length);
  }

  return cleaned.replace(SENDER_ID_PREFIX_RE, "");
}

export async function getRecentSessionContent(
  sessionFilePath: string,
  messageCount: number = 15,
): Promise<string | null> {
  try {
    const content = await fs.readFile(sessionFilePath, "utf-8");
    const lines = content.trim().split("\n");

    const allMessages: string[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "message" && entry.message) {
          const msg = entry.message as {
            role?: unknown;
            content?: unknown;
            provenance?: unknown;
          };
          const role = msg.role;
          if ((role === "user" || role === "assistant") && "content" in msg && msg.content) {
            if (role === "user" && hasInterSessionUserProvenance(msg)) {
              continue;
            }
            const rawText = extractTextMessageContent(msg.content);
            if (!rawText) { continue; }
            const text = msg.role === "user" ? stripMessageMetadata(rawText) : rawText;
            if (text && !text.startsWith("/")) {
              allMessages.push(`${role}: ${text}`);
            }
          }
        }
      } catch {
        // Skip invalid JSON lines.
      }
    }

    return allMessages.slice(-messageCount).join("\n");
  } catch {
    return null;
  }
}

export async function getRecentSessionContentWithResetFallback(
  sessionFilePath: string,
  messageCount: number = 15,
): Promise<string | null> {
  const primary = await getRecentSessionContent(sessionFilePath, messageCount);
  if (primary) {
    return primary;
  }

  try {
    const dir = path.dirname(sessionFilePath);
    const base = path.basename(sessionFilePath);
    const resetPrefix = `${base}.reset.`;
    const files = await fs.readdir(dir);
    const resetCandidates = files.filter((name) => name.startsWith(resetPrefix)).toSorted();

    if (resetCandidates.length === 0) {
      return primary;
    }

    const latestResetPath = path.join(dir, resetCandidates[resetCandidates.length - 1]);
    return (await getRecentSessionContent(latestResetPath, messageCount)) || primary;
  } catch {
    return primary;
  }
}

export function stripResetSuffix(fileName: string): string {
  const resetIndex = fileName.indexOf(".reset.");
  return resetIndex === -1 ? fileName : fileName.slice(0, resetIndex);
}

/**
 * Resolve a sessionId to its actual transcript file, including archived
 * variants (.reset.{ts}, .deleted.{ts}). Returns the newest match.
 */
export async function findSessionFileById(
  sessionId: string,
  sessionsDir: string,
): Promise<string | null> {
  const canonical = path.join(sessionsDir, `${sessionId}.jsonl`);
  try {
    await fs.access(canonical);
    return canonical;
  } catch {}

  try {
    const files = await fs.readdir(sessionsDir);
    const prefix = `${sessionId}.jsonl.`;

    const archived = files
      .filter((name) => name.startsWith(prefix))
      .toSorted()
      .toReversed();

    if (archived.length > 0) {
      return path.join(sessionsDir, archived[0]);
    }
  } catch {}

  return null;
}

export async function findPreviousSessionFile(params: {
  sessionsDir: string;
  currentSessionFile?: string;
  sessionId?: string;
}): Promise<string | undefined> {
  try {
    const files = await fs.readdir(params.sessionsDir);
    const fileSet = new Set(files);

    const baseFromReset = params.currentSessionFile
      ? stripResetSuffix(path.basename(params.currentSessionFile))
      : undefined;
    if (baseFromReset && fileSet.has(baseFromReset)) {
      return path.join(params.sessionsDir, baseFromReset);
    }

    const trimmedSessionId = params.sessionId?.trim();
    if (trimmedSessionId) {
      const canonicalFile = `${trimmedSessionId}.jsonl`;
      if (fileSet.has(canonicalFile)) {
        return path.join(params.sessionsDir, canonicalFile);
      }

      const topicVariants = files
        .filter(
          (name) =>
            name.startsWith(`${trimmedSessionId}-topic-`) &&
            name.endsWith(".jsonl") &&
            !name.includes(".reset."),
        )
        .toSorted()
        .toReversed();
      if (topicVariants.length > 0) {
        return path.join(params.sessionsDir, topicVariants[0]);
      }
    }

    if (!params.currentSessionFile) {
      return undefined;
    }

    const nonResetJsonl = files
      .filter((name) => name.endsWith(".jsonl") && !name.includes(".reset."))
      .toSorted()
      .toReversed();
    if (nonResetJsonl.length > 0) {
      return path.join(params.sessionsDir, nonResetJsonl[0]);
    }
  } catch {
    // Ignore directory read errors.
  }
  return undefined;
}
