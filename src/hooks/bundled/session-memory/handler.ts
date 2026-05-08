/**
 * Session memory hook handler
 *
 * Saves structured session summaries to memory when /new or /reset command
 * is triggered. Creates daily memory files and routes topics to topic files.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveAgentIdByWorkspacePath,
  resolveAgentWorkspaceDir,
} from "../../../agents/agent-scope.js";
import type { KaijiBotConfig } from "../../../config/config.js";
import { resolveStateDir } from "../../../config/paths.js";
import { appendFileWithinRoot } from "../../../infra/fs-safe.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import {
  parseAgentSessionKey,
  resolveAgentIdFromSessionKey,
  toAgentStoreSessionKey,
} from "../../../routing/session-key.js";
import { isHeartbeatSessionKey } from "../../../sessions/session-key-utils.js";
import { resolveHookConfig } from "../../config.js";
import type { HookHandler } from "../../hooks.js";
import {
  findPreviousSessionFile,
  getRecentSessionContentWithResetFallback,
} from "./transcript.js";
import { generateStructuredSummary, formatSummaryAsMarkdown, type SessionPointer } from "./summary.js";
import type { StructuredSummary } from "./summary.js";
// Inline type — memory-core types are loaded dynamically to respect the extension boundary.
interface TopicEntry {
  title: string;
  date: string;
  content: string;
  importance?: "high" | "normal" | "low";
  source?: string;
}

const log = createSubsystemLogger("hooks/session-memory");

const MESSAGE_CAP = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveDisplaySessionKey(params: {
  cfg?: KaijiBotConfig;
  workspaceDir?: string;
  sessionKey: string;
}): string {
  if (!params.cfg || !params.workspaceDir) {
    return params.sessionKey;
  }
  const workspaceAgentId = resolveAgentIdByWorkspacePath(params.cfg, params.workspaceDir);
  const parsed = parseAgentSessionKey(params.sessionKey);
  if (!workspaceAgentId || !parsed || workspaceAgentId === parsed.agentId) {
    return params.sessionKey;
  }
  return toAgentStoreSessionKey({
    agentId: workspaceAgentId,
    requestKey: parsed.rest,
  });
}

function createNodeFsAdapter() {
  return {
    readFile: (p: string) => fs.readFile(p, "utf-8"),
    writeFile: (p: string, data: string) => fs.writeFile(p, data, "utf-8"),
    mkdir: async (p: string, opts: { recursive: boolean }) => {
      await fs.mkdir(p, opts);
    },
    readdir: (p: string) => fs.readdir(p),
    stat: async (p: string) => {
      const s = await fs.stat(p);
      return { mtimeMs: s.mtimeMs, size: s.size };
    },
    rename: (oldPath: string, newPath: string) => fs.rename(oldPath, newPath),
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const saveSessionToMemory: HookHandler = async (event) => {
  const isResetCommand = event.action === "new" || event.action === "reset";
  const isCompaction = event.type === "compaction" && event.action === "after";
  if (!(event.type === "command" && isResetCommand) && !isCompaction) {
    return;
  }

  // Skip heartbeat sessions — they contain only system pings (HEARTBEAT_OK),
  // not user conversations worth recording.
  if (isHeartbeatSessionKey(event.sessionKey)) {
    log.debug("Skipping heartbeat session", { sessionKey: event.sessionKey });
    return;
  }

  try {
    log.debug("Hook triggered for reset/new command", { action: event.action });

    const context = event.context || {};
    const cfg = context.cfg as KaijiBotConfig | undefined;
    const contextWorkspaceDir =
      typeof context.workspaceDir === "string" && context.workspaceDir.trim().length > 0
        ? context.workspaceDir
        : undefined;
    const agentId = resolveAgentIdFromSessionKey(event.sessionKey);
    const workspaceDir =
      contextWorkspaceDir ||
      (cfg
        ? resolveAgentWorkspaceDir(cfg, agentId)
        : path.join(resolveStateDir(process.env, os.homedir), "workspace"));
    const displaySessionKey = resolveDisplaySessionKey({
      cfg,
      workspaceDir: contextWorkspaceDir,
      sessionKey: event.sessionKey,
    });
    const memoryDir = path.join(workspaceDir, "memory");
    await fs.mkdir(memoryDir, { recursive: true });

    const now = new Date(event.timestamp);
    const dateStr = now.toISOString().split("T")[0];

    const sessionEntry = (context.previousSessionEntry || context.sessionEntry || {}) as Record<
      string,
      unknown
    >;
    const currentSessionId = sessionEntry.sessionId as string;
    let currentSessionFile = (sessionEntry.sessionFile as string) || undefined;

    if (!currentSessionFile || currentSessionFile.includes(".reset.")) {
      const sessionsDirs = new Set<string>();
      if (currentSessionFile) {
        sessionsDirs.add(path.dirname(currentSessionFile));
      }
      sessionsDirs.add(path.join(workspaceDir, "sessions"));

      for (const sessionsDir of sessionsDirs) {
        const recovered = await findPreviousSessionFile({
          sessionsDir,
          currentSessionFile,
          sessionId: currentSessionId,
        });
        if (recovered) {
          currentSessionFile = recovered;
          log.debug("Found previous session file", { file: currentSessionFile });
          break;
        }
      }
    }

    log.debug("Session context resolved", {
      sessionId: currentSessionId,
      sessionFile: currentSessionFile,
      hasCfg: Boolean(cfg),
    });

    const sessionFile = currentSessionFile || undefined;

    // Build session pointer (sessionId + sessionsDir) for stable resolution.
    // Unlike an absolute file path, this survives /reset renaming (.reset.{ts}).
    const sessionPointer: SessionPointer | undefined =
      sessionFile && currentSessionId
        ? {
            sessionId: currentSessionId,
            sessionsDir: path.dirname(sessionFile),
          }
        : undefined;

    const hookConfig = resolveHookConfig(cfg, "session-memory");
    const messageCount =
      typeof hookConfig?.messages === "number" && hookConfig.messages > 0
        ? Math.min(hookConfig.messages, MESSAGE_CAP)
        : MESSAGE_CAP;

    let sessionContent: string | null = null;
    let summary: StructuredSummary;

    if (sessionFile) {
      sessionContent = await getRecentSessionContentWithResetFallback(sessionFile, messageCount);
      log.debug("Session content loaded", {
        length: sessionContent?.length ?? 0,
        messageCount,
      });
    }

    const isTestEnv =
      process.env.KAIJIBOT_TEST_FAST === "1" ||
      process.env.VITEST === "true" ||
      process.env.VITEST === "1" ||
      process.env.NODE_ENV === "test";
    const allowLlm = !isTestEnv && hookConfig?.llmSlug !== false;

    if (sessionContent && cfg && allowLlm) {
      summary = await generateStructuredSummary({ transcript: sessionContent, cfg });
      log.debug("Structured summary generated", { topicSlug: summary.topicSlug });
    } else if (sessionContent) {
      summary = {
        summary: sessionContent.slice(0, 6000) || "(session)",
        decisions: [],
        followups: [],
        topics: [],
        participants: ["user"],
        topicSlug: "session",
      };
    } else {
      const timeStr = now.toISOString().split("T")[1].split(".")[0].replace(/:/g, "").slice(0, 4);
      summary = {
        summary: `(empty session at ${timeStr})`,
        decisions: [],
        followups: [],
        topics: [],
        participants: ["user"],
        topicSlug: `session-${timeStr}`,
      };
    }

    // --- Write daily file: memory/YYYY-MM-DD.md (append) ---
    const dailyFilename = `${dateStr}.md`;
    const markdownEntry = formatSummaryAsMarkdown(
      summary,
      dateStr,
      displaySessionKey,
      sessionPointer,
    );

    await appendFileWithinRoot({
      rootDir: memoryDir,
      relativePath: dailyFilename,
      data: `\n${markdownEntry}\n`,
      prependNewlineIfNeeded: true,
      mkdir: true,
    });
    log.debug("Daily memory file updated", { filename: dailyFilename });

    // --- Route to topic files ---
    if (summary.topicSlug && cfg) {
      try {
        const { createTopicManager, MemoryIndexManager } = await import(
          "../../../../extensions/memory-core/index.js"
        );
        const nodeFs = createNodeFsAdapter();

        const topicManager = createTopicManager({ workspaceDir, fs: nodeFs });
        await topicManager.ensureTopicsDir();

        const topicFileName = `${summary.topicSlug}.md`;
        let topic = await topicManager.getTopic(topicFileName);
        if (!topic) {
          topic = await topicManager.createTopic(summary.topicSlug, topicFileName);
        }

        const entryContent = sessionContent
          ? sessionContent.slice(0, 4000)
          : summary.summary;

        const topicEntry: TopicEntry = {
          title: `${dateStr} session`,
          date: dateStr,
          content: entryContent,
          importance: summary.decisions.length > 0 ? "high" : "normal",
          source: "session-memory",
        };
        await topicManager.appendEntry(topicFileName, topicEntry);
        log.debug("Topic file updated", { topic: topicFileName });

        const indexFs = {
          readFile: (p: string) => fs.readFile(p, "utf-8"),
          writeFile: (p: string, data: string) => fs.writeFile(p, data, "utf-8"),
          mkdir: async (p: string, opts: { recursive: boolean }) => {
            await fs.mkdir(p, opts);
          },
          rename: (oldPath: string, newPath: string) => fs.rename(oldPath, newPath),
        };
        const indexManager = new MemoryIndexManager({ workspaceDir, fs: indexFs });
        await indexManager.addRecentSession({
          date: dateStr,
          title: summary.summary.slice(0, 80),
          topicPath: `memory/topics/${topicFileName}`,
        });
        log.debug("MEMORY.md index updated");
      } catch (topicErr) {
        const msg = topicErr instanceof Error ? topicErr.message : String(topicErr);
        log.error("Failed to update topic files or index", { error: msg });
      }
    }

    // --- Post-session correction extraction ---
    if (sessionContent && cfg && allowLlm) {
      try {
        const { hasCorrectionSignals, extractCorrectionsFromTranscript } = await import(
          "../../../cognitive/correction/extractor.js"
        );
        if (hasCorrectionSignals(sessionContent)) {
          const userId = extractUserIdFromSessionKey(event.sessionKey);
          if (userId) {
            const { createStandaloneGenerateText } = await import(
              "../../../cognitive/evolution/standalone-generate.js"
            );
            const { CorrectionStore } = await import("../../../cognitive/correction/store.js");
            const { resolveConfigDir } = await import("../../../utils.js");

            const generateText = await createStandaloneGenerateText(cfg, { maxTokens: 2000 });
            const corrections = await extractCorrectionsFromTranscript(sessionContent, generateText);

            if (corrections.length > 0) {
              const corrStore = new CorrectionStore(resolveConfigDir());
              for (const corr of corrections) {
                await corrStore.addOrReinforce(userId, corr);
              }
              log.debug("Correction extraction complete", { count: corrections.length });
            }
          }
        }
      } catch (corrErr) {
        const msg = corrErr instanceof Error ? corrErr.message : String(corrErr);
        log.debug("Correction extraction skipped", { error: msg });
      }
    }

    const relPath = path.join(memoryDir, dailyFilename).replace(os.homedir(), "~");
    log.info(`Session summary saved to ${relPath}`);
  } catch (err) {
    if (err instanceof Error) {
      log.error("Failed to save session memory", {
        errorName: err.name,
        errorMessage: err.message,
        stack: err.stack,
      });
    } else {
      log.error("Failed to save session memory", { error: String(err) });
    }
  }
};

function extractUserIdFromSessionKey(sessionKey: string): string | null {
  const parts = sessionKey.split(":");
  if (parts.length >= 3 && parts[1] && parts[1] !== "main") {
    return parts[1];
  }
  return null;
}

export default saveSessionToMemory;
