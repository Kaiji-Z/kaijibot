/**
 * memory_save tool — save structured memories to topic files with automatic
 * classification and self-editing (mem0 pattern).
 *
 * Route by type → default topic file (or custom override).
 * Detect conflicts via Jaccard similarity → LLM decide → append / replace / merge.
 * Update MEMORY.md index. Importance boost is stubbed for Wave 2A.
 */

import { Type } from "@sinclair/typebox";
import fs from "node:fs/promises";
import {
  jsonResult,
  readStringParam,
  type AnyAgentTool,
  type KaijiBotConfig,
} from "kaijibot/plugin-sdk/memory-core-host-runtime-core";

import type { MemoryType } from "./memory-types.js";
import { jaccardSimilarity, tokenize } from "./memory/mmr.js";
import { MemoryIndexManager, type MemoryIndexDeps } from "./memory-index.js";
import {
  DEFAULT_TOPIC_FILES,
  type TopicEntry,
} from "./topic-types.js";
import { TopicManager, type TopicManagerDeps } from "./topic-manager.js";
import {
  getMemoryManagerContextWithPurpose,
  resolveMemoryToolContext,
} from "./tools.shared.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const MemorySaveSchema = Type.Object({
  content: Type.String({
    description: "Content to save as a memory entry",
  }),
  type: Type.Union(
    [
      Type.Literal("user"),
      Type.Literal("feedback"),
      Type.Literal("project"),
      Type.Literal("reference"),
    ],
    { description: "Memory type classification" },
  ),
  topic: Type.Optional(
    Type.String({
      description:
        "Target topic file name (without .md). Overrides default routing.",
    }),
  ),
  importance: Type.Optional(
    Type.Union(
      [Type.Literal("high"), Type.Literal("normal"), Type.Literal("low")],
      { description: "Importance level. High importance fast-tracks dreaming promotion." },
    ),
  ),
});

// ---------------------------------------------------------------------------
// LLM decision type (injectable for testability)
// ---------------------------------------------------------------------------

export type SelfEditDecision = "append_new" | "replace_existing" | "merge";

/**
 * Injectable LLM decision function for self-edit conflicts.
 * Extensions cannot import `runEmbeddedPiAgent` from core, so this must be
 * wired externally. When not provided, conflicts default to `append_new`.
 */
export type LlmDecideFn = (
  existing: string,
  newContent: string,
) => Promise<SelfEditDecision>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIMILARITY_THRESHOLD = 0.8;
const LLM_DECIDE_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Node.js fs adapter
// ---------------------------------------------------------------------------

function createNodeFsAdapter(): TopicManagerDeps["fs"] & MemoryIndexDeps["fs"] {
  return {
    readFile: (p: string) => fs.readFile(p, "utf-8"),
    writeFile: (p: string, data: string) => fs.writeFile(p, data, "utf-8"),
    mkdir: (p: string, opts: { recursive: boolean }) => fs.mkdir(p, opts).then(() => {}),
    readdir: (p: string) => fs.readdir(p),
    stat: (p: string) =>
      fs.stat(p).then((s) => ({ mtimeMs: s.mtimeMs, size: s.size })),
    rename: (oldPath: string, newPath: string) => fs.rename(oldPath, newPath),
  };
}

// ---------------------------------------------------------------------------
// Self-edit logic (extracted for testability)
// ---------------------------------------------------------------------------

/**
 * Compute max Jaccard similarity between new content and existing entries.
 * Returns { maxSim, maxSimIdx } where maxSimIdx is the index of the best
 * match or -1 if no entries exist.
 */
export function computeMaxSimilarity(
  newContent: string,
  entries: TopicEntry[],
): { maxSim: number; maxSimIdx: number } {
  if (entries.length === 0) {
    return { maxSim: 0, maxSimIdx: -1 };
  }
  const newTokens = tokenize(newContent);
  let maxSim = 0;
  let maxSimIdx = -1;

  for (let i = 0; i < entries.length; i++) {
    const existingTokens = tokenize(entries[i].content);
    const sim = jaccardSimilarity(newTokens, existingTokens);
    if (sim > maxSim) {
      maxSim = sim;
      maxSimIdx = i;
    }
  }
  return { maxSim, maxSimIdx };
}

/**
 * Resolve the self-edit decision when a conflict is detected.
 * Delegates to the injectable LLM caller if provided; otherwise defaults to
 * `append_new`.
 */
export async function resolveSelfEditDecision(
  llmDecide: LlmDecideFn | undefined,
  existingContent: string,
  newContent: string,
): Promise<SelfEditDecision> {
  if (!llmDecide) {
    return "append_new";
  }
  try {
    return await Promise.race([
      llmDecide(existingContent, newContent),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("LLM decide timeout")),
          LLM_DECIDE_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch {
    return "append_new";
  }
}

/**
 * Derive a one-line title from content (first ~50 chars, no newlines).
 */
export function deriveEntryTitle(content: string): string {
  return content.slice(0, 50).replace(/\n/g, " ").trim() || "Untitled";
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createMemorySaveTool(options: {
  config?: KaijiBotConfig;
  agentSessionKey?: string;
  llmDecide?: LlmDecideFn;
}): AnyAgentTool | null {
  const ctx = resolveMemoryToolContext(options);
  if (!ctx) {
    return null;
  }
  const { cfg, agentId } = ctx;

  return {
    label: "Memory Save",
    name: "memory_save",
    description:
      "Mandatory write step: save structured memories to topic files with automatic classification and self-editing. " +
      "Route by type (user\u2192user-profile, feedback\u2192feedback, project\u2192project-decisions, reference\u2192reference). " +
      "Detects and resolves conflicts with existing entries (mem0-style self-editing). Importance=high fast-tracks dreaming promotion.",
    parameters: MemorySaveSchema,
    execute: async (_toolCallId, params) => {
      const content = readStringParam(params, "content", { required: true });
      const type = readStringParam(params, "type", { required: true }) as MemoryType;
      const topicOverride = readStringParam(params, "topic");
      const importance = readStringParam(params, "importance") as
        | "high"
        | "normal"
        | "low"
        | undefined;

      const rawTopicName = topicOverride ?? DEFAULT_TOPIC_FILES[type];
      const topicFile = rawTopicName.replace(/\.md$/i, "") + ".md";
      const memory = await getMemoryManagerContextWithPurpose({
        cfg,
        agentId,
        purpose: "status",
      });
      if ("error" in memory) {
        return jsonResult({
          error: memory.error ?? "Memory unavailable",
          disabled: true,
        });
      }
      const status = memory.manager.status();
      const workspaceDir = status.workspaceDir;
      if (!workspaceDir) {
        return jsonResult({
          error: "Workspace directory not resolved",
          disabled: true,
        });
      }

      const nodeFs = createNodeFsAdapter();
      const topicManager = new TopicManager({ workspaceDir, fs: nodeFs });
      const indexManager = new MemoryIndexManager({ workspaceDir, fs: nodeFs });

      await topicManager.ensureTopicsDir();

      let topic = await topicManager.getTopic(topicFile);
      if (!topic) {
        topic = await topicManager.createTopic(type, topicFile);
      }

      let action: "created" | "updated" | "merged" = "created";

      const today = new Date().toISOString().slice(0, 10);
      const newEntry: TopicEntry = {
        title: deriveEntryTitle(content),
        date: today,
        content,
        importance,
        source: "memory-save",
      };

      const { maxSim, maxSimIdx } = computeMaxSimilarity(content, topic.entries);

      if (maxSim >= SIMILARITY_THRESHOLD && maxSimIdx >= 0) {
        const existingContent = topic.entries[maxSimIdx].content;
        const decision = await resolveSelfEditDecision(
          options.llmDecide,
          existingContent,
          content,
        );

        switch (decision) {
          case "replace_existing":
            await topicManager.updateEntry(topicFile, maxSimIdx, content);
            action = "updated";
            break;
          case "merge": {
            const mergedContent = `${existingContent}\n\n---\n\n${content}`;
            await topicManager.mergeEntries(topicFile, [maxSimIdx], mergedContent);
            action = "merged";
            break;
          }
          default:
            await topicManager.appendEntry(topicFile, newEntry);
            action = "created";
        }
      } else {
        await topicManager.appendEntry(topicFile, newEntry);
      }

      const topicTitle = topicFile
        .replace(/\.md$/i, "")
        .replace(/-/g, " ");
      const summaryText = content.slice(0, 100).replace(/\n/g, " ").trim();

      await indexManager.updateSection({
        type,
        title: topicTitle,
        topicFile: `memory/topics/${topicFile}`,
        summary: importance === "high" ? content : summaryText,
      });

      if (importance === "high" || importance === "normal") {
        // Wave 2A: incrementGroundedCount() will be wired here
      }

      return jsonResult({
        path: `memory/topics/${topicFile}`,
        action,
        topicFile,
        importance: importance ?? "normal",
      });
    },
  };
}
