/**
 * Structured summary generation for session memory.
 *
 * Uses the embedded pi-agent LLM to extract a structured summary from
 * conversation transcripts. Falls back to a minimal raw-dump structure on
 * LLM failure so that no session is lost.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveDefaultAgentId,
  resolveAgentWorkspaceDir,
  resolveAgentDir,
  resolveAgentEffectiveModelPrimary,
} from "../../../agents/agent-scope.js";
import { DEFAULT_PROVIDER, DEFAULT_MODEL } from "../../../agents/defaults.js";
import { parseModelRef } from "../../../agents/model-selection.js";
import { runEmbeddedPiAgent } from "../../../agents/pi-embedded.js";
import type { KaijiBotConfig } from "../../../config/config.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { normalizeLowercaseStringOrEmpty } from "../../../shared/string-coerce.js";
type MemoryType = "user" | "feedback" | "project" | "reference";

const MEMORY_TYPES = new Set<string>(["user", "feedback", "project", "reference"]);

function parseMemoryType(raw: string | undefined): MemoryType | null {
  if (raw === undefined) return null;
  if (MEMORY_TYPES.has(raw)) return raw as MemoryType;
  return null;
}

const log = createSubsystemLogger("hooks/session-memory/summary");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StructuredSummary {
  /** 2-3 sentence overview of the conversation */
  summary: string;
  /** Key decisions made during the conversation */
  decisions: string[];
  /** Pending action items / follow-ups */
  followups: string[];
  /** Topic tags for routing to topic files */
  topics: string[];
  /** Participants involved */
  participants: string[];
  /** Primary memory type classification */
  type: MemoryType;
  /** LLM-generated slug for topic file name */
  topicSlug: string;
}

// ---------------------------------------------------------------------------
// LLM summary prompt
// ---------------------------------------------------------------------------

const SUMMARY_SYSTEM_PROMPT = `You are a structured conversation summarizer. Analyze the conversation and produce a JSON object with exactly these fields:

- "summary": 2-3 sentence overview in the same language as the conversation (Chinese or English).
- "decisions": array of key decisions made (as strings). Empty if none.
- "followups": array of pending action items (as strings). Empty if none.
- "topics": array of 1-3 short topic tags (lowercase, hyphenated, e.g. "api-design", "user-preferences"). Empty if none.
- "participants": array of participant names/roles (e.g. ["user", "assistant"]). At minimum ["user"].
- "type": one of "user", "feedback", "project", or "reference".
  - "user": personal info, preferences, identity, relationships
  - "feedback": corrections AND confirmations from user
  - "project": decisions, milestones, known issues NOT derivable from code/git
  - "reference": external pointers (URLs, version numbers, connected services)
  - Default to "project" if unclear.
- "topicSlug": a short 1-3 word slug for the topic file name (lowercase, hyphenated, max 30 chars).

## What NOT to save in memory

- Code patterns, conventions, architecture, file paths, or project structure
- Git history, recent changes, or who-changed-what
- Debugging solutions or fix recipes — the fix is in the code
- Anything already documented in project files
- Ephemeral task details: in-progress work, temporary state, current conversation context
- Information tools can look up in real-time (weather, time, file contents)
- Dreaming/diagnostic metadata (confidence scores, evidence paths, status markers)

These exclusions apply even when explicitly asked to save. If asked to save a list or summary, ask what was *surprising* or *non-obvious* about it.

Reply with ONLY the JSON object, no markdown fences, no commentary.`;

// ---------------------------------------------------------------------------
// JSON parsing helper
// ---------------------------------------------------------------------------

function extractJsonObject(text: string): string | null {
  // Try to find a JSON object in the response
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return null;
  }
  return text.slice(firstBrace, lastBrace + 1);
}

function parseStructuredSummaryResponse(raw: string, transcript: string): StructuredSummary | null {
  const jsonStr = extractJsonObject(raw);
  if (!jsonStr) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  const summary = typeof parsed.summary === "string" ? parsed.summary : "";
  if (!summary) return null;

  const decisions = Array.isArray(parsed.decisions)
    ? parsed.decisions.filter((d): d is string => typeof d === "string")
    : [];

  const followups = Array.isArray(parsed.followups)
    ? parsed.followups.filter((f): f is string => typeof f === "string")
    : [];

  const topics = Array.isArray(parsed.topics)
    ? parsed.topics.filter((t): t is string => typeof t === "string")
    : [];

  const participants = Array.isArray(parsed.participants)
    ? parsed.participants.filter((p): p is string => typeof p === "string")
    : ["user"];

  const type = parseMemoryType(parsed.type as string) ?? "project";

  const topicSlug =
    typeof parsed.topicSlug === "string"
      ? normalizeLowercaseStringOrEmpty(parsed.topicSlug)
          .replace(/[^a-z0-9-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 30)
      : topics[0]?.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 30) ?? "session";

  return {
    summary,
    decisions,
    followups,
    topics,
    participants,
    type,
    topicSlug: topicSlug || "session",
  };
}

// ---------------------------------------------------------------------------
// Fallback summary
// ---------------------------------------------------------------------------

function createFallbackSummary(transcript: string): StructuredSummary {
  const firstLine = transcript.split("\n")[0] ?? "";
  const truncated = firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
  return {
    summary: truncated || "(session transcript too short to summarize)",
    decisions: [],
    followups: [],
    topics: [],
    participants: ["user"],
    type: "reference",
    topicSlug: "session",
  };
}

// ---------------------------------------------------------------------------
// Main: generateStructuredSummary
// ---------------------------------------------------------------------------

/**
 * Generate a structured summary from a conversation transcript using LLM.
 * Falls back to a minimal raw structure on any failure (timeout, parse error,
 * network error, etc.) so that no session data is lost.
 */
export async function generateStructuredSummary(params: {
  transcript: string;
  cfg: KaijiBotConfig;
}): Promise<StructuredSummary> {
  const { transcript, cfg } = params;

  // Short-circuit: no meaningful content
  if (!transcript.trim()) {
    return createFallbackSummary(transcript);
  }

  let tempSessionFile: string | null = null;

  try {
    const agentId = resolveDefaultAgentId(cfg);
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const agentDir = resolveAgentDir(cfg, agentId);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-summary-"));
    tempSessionFile = path.join(tempDir, "session.jsonl");

    const prompt = `${SUMMARY_SYSTEM_PROMPT}\n\nConversation transcript:\n${transcript.slice(0, 6000)}`;

    const modelRef = resolveAgentEffectiveModelPrimary(cfg, agentId);
    const parsed = modelRef ? parseModelRef(modelRef, DEFAULT_PROVIDER) : null;
    const provider = parsed?.provider ?? DEFAULT_PROVIDER;
    const model = parsed?.model ?? DEFAULT_MODEL;

    const result = await runEmbeddedPiAgent({
      sessionId: `summary-gen-${Date.now()}`,
      sessionKey: "temp:summary-generator",
      agentId,
      sessionFile: tempSessionFile,
      workspaceDir,
      agentDir,
      config: cfg,
      prompt,
      provider,
      model,
      timeoutMs: 30_000,
      runId: `summary-gen-${Date.now()}`,
    });

    if (result.payloads && result.payloads.length > 0) {
      const text = result.payloads[0]?.text;
      if (text) {
        const summary = parseStructuredSummaryResponse(text, transcript);
        if (summary) {
          return summary;
        }
      }
    }

    log.debug("LLM response could not be parsed, using fallback");
    return createFallbackSummary(transcript);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Failed to generate structured summary: ${message}`);
    return createFallbackSummary(transcript);
  } finally {
    if (tempSessionFile) {
      try {
        await fs.rm(path.dirname(tempSessionFile), { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Markdown formatting
// ---------------------------------------------------------------------------

/**
 * Format a StructuredSummary as a markdown document with YAML frontmatter,
 * suitable for appending to a daily memory file.
 */
export function formatSummaryAsMarkdown(summary: StructuredSummary, dateStr: string): string {
  const frontmatter = [
    "---",
    `type: session-summary`,
    `date: ${dateStr}`,
    `topics: [${summary.topics.join(", ")}]`,
    `participants: [${summary.participants.join(", ")}]`,
    "---",
    "",
  ].join("\n");

  const sections: string[] = [frontmatter];

  sections.push(`## 摘要`, "", summary.summary, "");

  if (summary.decisions.length > 0) {
    sections.push("## 关键决策");
    for (const d of summary.decisions) {
      sections.push(`- ${d}`);
    }
    sections.push("");
  }

  if (summary.followups.length > 0) {
    sections.push("## 待跟进");
    for (const f of summary.followups) {
      sections.push(`- [ ] ${f}`);
    }
    sections.push("");
  }

  if (summary.topicSlug) {
    sections.push(`## 详细记录 → memory/topics/${summary.topicSlug}.md`, "");
  }

  return sections.join("\n");
}
