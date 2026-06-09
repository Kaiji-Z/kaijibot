import fs from "node:fs/promises";
import path from "node:path";
import { hasInterSessionUserProvenance } from "../../../sessions/input-provenance.js";
import { writeTextAtomic } from "../../../infra/json-files.js";

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

/**
 * Synchronous transcript preprocessor. Parses raw JSONL content and extracts
 * clean conversation text, stripping metadata, tool results, and thinking blocks.
 */
export function preprocessSessionTranscript(
  rawContent: string,
  opts?: { maxMessages?: number; excludeToolAnnotations?: boolean },
): string | null {
  const maxMessages = opts?.maxMessages ?? 500;
  const lines = rawContent.trim().split("\n");

  const allMessages: string[] = [];
  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type !== "message" || !entry.message) {
      continue;
    }

    const msg = entry.message as {
      role?: unknown;
      content?: unknown;
      provenance?: unknown;
    };
    const role = msg.role;
    if (role !== "user" && role !== "assistant") {
      continue;
    }
    if (!("content" in msg) || !msg.content) {
      continue;
    }

    if (role === "user" && hasInterSessionUserProvenance(msg)) {
      continue;
    }

    const rawText = extractTextMessageContent(msg.content);
    if (!rawText) {
      continue;
    }

    const text = role === "user" ? stripMessageMetadata(rawText) : rawText;
    if (!text || text.startsWith("/")) {
      continue;
    }

    if (!opts?.excludeToolAnnotations && role === "assistant" && Array.isArray(msg.content)) {
      const toolNames: string[] = [];
      for (const block of msg.content) {
        if (
          block &&
          typeof block === "object" &&
          (block as { type?: unknown }).type === "toolCall" &&
          typeof (block as { name?: unknown }).name === "string"
        ) {
          toolNames.push((block as { name: string }).name);
        }
      }
      if (toolNames.length > 0) {
        allMessages.push(`assistant: [tool: ${toolNames.join(", ")}] ${text}`);
        continue;
      }
    }

    allMessages.push(`${role}: ${text}`);
  }

  if (allMessages.length === 0) {
    return null;
  }

  return allMessages.slice(-maxMessages).join("\n");
}

export async function getCleanDialogueContent(
  sessionFilePath: string,
): Promise<string | null> {
  try {
    const content = await fs.readFile(sessionFilePath, "utf-8");
    return preprocessSessionTranscript(content, {
      excludeToolAnnotations: true,
      maxMessages: Number.MAX_SAFE_INTEGER,
    });
  } catch {
    return null;
  }
}

export function mergeJsonlContents(existing: string, incoming: string): string {
  const seenIds = new Set<string>();
  const keptLines: string[] = [];

  for (const line of existing.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { id?: string };
      if (entry.id) seenIds.add(entry.id);
    } catch {}
    keptLines.push(line);
  }

  for (const line of incoming.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { id?: string };
      if (entry.id && seenIds.has(entry.id)) continue;
      if (entry.id) seenIds.add(entry.id);
    } catch {}
    keptLines.push(line);
  }

  return keptLines.join("\n") + "\n";
}

export async function updateDialogueStaging(
  stagingPath: string,
  sessionFilePath: string,
): Promise<void> {
  const currentRaw = await fs.readFile(sessionFilePath, "utf-8");

  let stagingExists = false;
  try {
    await fs.access(stagingPath);
    stagingExists = true;
  } catch {}

  if (!stagingExists) {
    await writeTextAtomic(stagingPath, currentRaw, { ensureDirMode: 0o755 });
    return;
  }

  const stagingRaw = await fs.readFile(stagingPath, "utf-8");
  const merged = mergeJsonlContents(stagingRaw, currentRaw);
  await writeTextAtomic(stagingPath, merged, { appendTrailingNewline: false });
}

export async function getDialogueWithStaging(
  stagingPath: string,
  sessionFilePath: string,
): Promise<string | null> {
  let stagingExists = false;
  try {
    await fs.access(stagingPath);
    stagingExists = true;
  } catch {}

  if (!stagingExists) {
    return getCleanDialogueContent(sessionFilePath);
  }

  const [stagingRaw, currentRaw] = await Promise.all([
    fs.readFile(stagingPath, "utf-8"),
    fs.readFile(sessionFilePath, "utf-8"),
  ]);

  const merged = mergeJsonlContents(stagingRaw, currentRaw);
  return preprocessSessionTranscript(merged, {
    excludeToolAnnotations: true,
    maxMessages: Number.MAX_SAFE_INTEGER,
  });
}

export async function getRecentSessionContent(
  sessionFilePath: string,
  messageCount: number = 15,
): Promise<string | null> {
  try {
    const content = await fs.readFile(sessionFilePath, "utf-8");
    return preprocessSessionTranscript(content, { maxMessages: messageCount });
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
