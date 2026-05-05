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

const log = createSubsystemLogger("hooks/session-memory/summary");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StructuredSummary {
  /** 2-3 sentence enriched overview of the conversation */
  summary: string;
  /** What the user explicitly asked for */
  primaryRequest?: string;
  /** Key technical concepts, technologies, frameworks discussed */
  technicalConcepts?: string[];
  /** Files read, modified, or created with brief descriptions */
  filesAndChanges?: string[];
  /** Errors encountered and how they were fixed */
  errorsAndFixes?: string[];
  /** Approaches tried, problems solved */
  problemSolving?: string[];
  /** What was in progress when session ended */
  currentWork?: string;
  /** Suggested next action */
  nextStep?: string;
  /** Key decisions made during the conversation */
  decisions: string[];
  /** Pending action items / follow-ups */
  followups: string[];
  /** Topic tags for routing to topic files */
  topics: string[];
  /** Participants involved */
  participants: string[];
  /** Subject-based topic name for routing (kebab-case, e.g. "feishu", "product") */
  topicSlug: string;
}

// ---------------------------------------------------------------------------
// LLM summary prompt
// ---------------------------------------------------------------------------

const SUMMARY_SYSTEM_PROMPT = `You are a structured conversation summarizer. Analyze the conversation and produce a JSON object with exactly these fields:

- "summary": 2-3 sentence enriched overview in the same language as the conversation (Chinese or English). Cover what happened, key outcomes, and current state.
- "primaryRequest": string — what the user explicitly asked for. Omit if unclear.
- "technicalConcepts": array of key technical concepts, technologies, frameworks discussed (as strings). Empty if none.
- "filesAndChanges": array of strings describing files read, modified, or created (e.g. "src/index.ts: added retry logic"). Empty if none.
- "errorsAndFixes": array of strings describing errors encountered and how they were resolved (e.g. "TypeError on null → added null check"). Empty if none.
- "problemSolving": array of strings describing approaches tried and problems solved. Empty if none.
- "currentWork": string — what was in progress when the session ended. Omit if nothing in progress.
- "nextStep": string — suggested next action. Omit if none.
- "decisions": array of key decisions made (as strings). Empty if none.
- "followups": array of pending action items (as strings). Empty if none.
- "topics": array of 1-3 short topic tags (lowercase, hyphenated, e.g. "api-design", "user-preferences"). Empty if none.
- "participants": array of participant names/roles (e.g. ["user", "assistant"]). At minimum ["user"].
- "topicSlug": a short 1-3 word slug for the topic file name (lowercase, hyphenated, max 30 chars). This is the primary classification — choose a subject that groups related memories together (e.g. "feishu", "philosophy", "product", "football").

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

function parseStructuredSummaryResponse(raw: string): StructuredSummary | null {
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

  const primaryRequest =
    typeof parsed.primaryRequest === "string" && parsed.primaryRequest.trim() ? parsed.primaryRequest : undefined;

  const technicalConcepts = Array.isArray(parsed.technicalConcepts)
    ? parsed.technicalConcepts.filter((c): c is string => typeof c === "string")
    : undefined;

  const filesAndChanges = Array.isArray(parsed.filesAndChanges)
    ? parsed.filesAndChanges.filter((f): f is string => typeof f === "string")
    : undefined;

  const errorsAndFixes = Array.isArray(parsed.errorsAndFixes)
    ? parsed.errorsAndFixes.filter((e): e is string => typeof e === "string")
    : undefined;

  const problemSolving = Array.isArray(parsed.problemSolving)
    ? parsed.problemSolving.filter((p): p is string => typeof p === "string")
    : undefined;

  const currentWork =
    typeof parsed.currentWork === "string" && parsed.currentWork.trim() ? parsed.currentWork : undefined;

  const nextStep =
    typeof parsed.nextStep === "string" && parsed.nextStep.trim() ? parsed.nextStep : undefined;

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
    primaryRequest,
    technicalConcepts: technicalConcepts?.length ? technicalConcepts : undefined,
    filesAndChanges: filesAndChanges?.length ? filesAndChanges : undefined,
    errorsAndFixes: errorsAndFixes?.length ? errorsAndFixes : undefined,
    problemSolving: problemSolving?.length ? problemSolving : undefined,
    currentWork,
    nextStep,
    decisions,
    followups,
    topics,
    participants,
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
    primaryRequest: undefined,
    technicalConcepts: undefined,
    filesAndChanges: undefined,
    errorsAndFixes: undefined,
    problemSolving: undefined,
    currentWork: undefined,
    nextStep: undefined,
    decisions: [],
    followups: [],
    topics: [],
    participants: ["user"],
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
        const summary = parseStructuredSummaryResponse(text);
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
export function formatSummaryAsMarkdown(
  summary: StructuredSummary,
  dateStr: string,
  sessionKey?: string,
  sessionFile?: string,
): string {
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

  if (sessionKey) {
    sections.push(`- **Session Key**: ${sessionKey}`, "");
  }

  if (sessionFile) {
    sections.push(`- **完整会话**: ${sessionFile}`, "");
  }

  sections.push("## 摘要", "", summary.summary, "");

  if (summary.primaryRequest) {
    sections.push("## 核心请求", "", summary.primaryRequest, "");
  }

  if (summary.technicalConcepts && summary.technicalConcepts.length > 0) {
    sections.push("## 技术概念");
    for (const c of summary.technicalConcepts) {
      sections.push(`- ${c}`);
    }
    sections.push("");
  }

  if (summary.filesAndChanges && summary.filesAndChanges.length > 0) {
    sections.push("## 文件与变更");
    for (const f of summary.filesAndChanges) {
      sections.push(`- ${f}`);
    }
    sections.push("");
  }

  if (summary.errorsAndFixes && summary.errorsAndFixes.length > 0) {
    sections.push("## 错误与修复");
    for (const e of summary.errorsAndFixes) {
      sections.push(`- ${e}`);
    }
    sections.push("");
  }

  if (summary.problemSolving && summary.problemSolving.length > 0) {
    sections.push("## 问题解决");
    for (const p of summary.problemSolving) {
      sections.push(`- ${p}`);
    }
    sections.push("");
  }

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

  if (summary.currentWork) {
    sections.push("## 当前工作", "", summary.currentWork, "");
  }

  if (summary.nextStep) {
    sections.push("## 下一步", "", summary.nextStep, "");
  }

  if (summary.topicSlug) {
    sections.push(`## 详细记录 → memory/topics/${summary.topicSlug}.md`, "");
  }

  return sections.join("\n");
}
