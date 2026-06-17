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
import { resolveCorrectionUserId } from "../../../cognitive/correction/userid.js";
import type { KaijiBotConfig } from "../../../config/config.js";
import { resolveStateDir } from "../../../config/paths.js";
import { appendFileWithinRoot } from "../../../infra/fs-safe.js";
import { writeTextAtomic } from "../../../infra/json-files.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import {
  parseAgentSessionKey,
  resolveAgentIdFromSessionKey,
  toAgentStoreSessionKey,
} from "../../../routing/session-key.js";
import { isHeartbeatSessionKey } from "../../../sessions/session-key-utils.js";
import { localDateStr, localTimeStr, localDateTimeStr } from "../../../shared/local-date.js";
import { resolveHookConfig } from "../../config.js";
import type { HookHandler } from "../../hooks.js";
import {
  generateStructuredSummary,
  formatSummaryAsMarkdown,
  type SessionPointer,
} from "./summary.js";
import type { StructuredSummary } from "./summary.js";
import {
  findPreviousSessionFile,
  getDialogueWithStaging,
  getRecentSessionContentWithResetFallback,
  updateDialogueStaging,
} from "./transcript.js";
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

const MEMORY_TYPE_TO_SECTION: Record<string, string> = {
  core: "⚡ Core Memory",
  active: "🔥 Active Context",
  // Legacy mappings for backward compatibility
  user: "⚡ Core Memory",
  feedback: "⚡ Core Memory",
  project: "🔥 Active Context",
  reference: "⚡ Core Memory",
};

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
    unlink: (p: string) => fs.unlink(p),
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
    const dateStr = localDateStr(now);

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
      try {
        const { createTopicRegistry } = await import("../../../../extensions/memory-core/index.js");
        const nodeFs = createNodeFsAdapter();
        const registry = createTopicRegistry({ workspaceDir, fs: nodeFs });
        await registry.syncFromDisk();
        const existingTopics = await registry.getDescriptionList();
        summary = await generateStructuredSummary({
          transcript: sessionContent,
          cfg,
          existingTopics,
        });
      } catch {
        summary = await generateStructuredSummary({ transcript: sessionContent, cfg });
      }
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
      const timeStr = localTimeStr(now);
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
        const { createTopicManager, MemoryIndexManager } =
          await import("../../../../extensions/memory-core/index.js");
        const nodeFs = createNodeFsAdapter();

        const topicManager = createTopicManager({ workspaceDir, fs: nodeFs });
        await topicManager.ensureTopicsDir();

        const topicFileName = `${summary.topicSlug}.md`;
        let topic = await topicManager.getTopic(topicFileName);
        if (!topic) {
          topic = await topicManager.createTopic(summary.topicSlug, topicFileName);
        }

        const entryContent = summary.summary;

        const topicEntry: TopicEntry = {
          title: `${dateStr} session`,
          date: dateStr,
          content: entryContent,
          importance: summary.decisions.length > 0 ? "high" : "normal",
          source: "session-memory",
        };
        await topicManager.appendEntry(topicFileName, topicEntry);
        log.debug("Topic file updated", { topic: topicFileName });

        const { createTopicRegistry } = await import("../../../../extensions/memory-core/index.js");
        const registry = createTopicRegistry({ workspaceDir, fs: nodeFs });
        const updatedTopic = await topicManager.getTopic(topicFileName);
        await registry.upsertTopic({
          name: summary.topicSlug,
          description: summary.topicDescription ?? summary.summary.slice(0, 100),
          entryCount: updatedTopic?.entries.length ?? 1,
          lastUpdated: dateStr,
          createdAt: updatedTopic?.frontmatter.created ?? dateStr,
        });

        const indexManager = new MemoryIndexManager({ workspaceDir, fs: nodeFs });

        await indexManager.updateSection({
          subject: summary.topicSlug,
          title: summary.topicSlug,
          topicFile: `memory/topics/${topicFileName}`,
          summary: summary.summary.slice(0, 120),
        });

        if (summary.memoryType) {
          const section = MEMORY_TYPE_TO_SECTION[summary.memoryType];
          if (section) {
            const index = await indexManager.readIndex();
            const inlineSections = index.inlineSections ?? [];

            const inlineLines = [`- ${dateStr}: ${summary.summary.slice(0, 100)}`];
            for (const d of summary.decisions.slice(0, 3)) {
              inlineLines.push(`  - Decision: ${d}`);
            }

            const existingIdx = inlineSections.findIndex((s) => s.section === section);
            if (existingIdx >= 0) {
              inlineSections[existingIdx]!.lines = [
                "",
                ...inlineLines,
                ...inlineSections[existingIdx]!.lines,
              ];
            } else {
              inlineSections.push({ section, lines: ["", ...inlineLines] });
            }

            index.inlineSections = inlineSections;
            await indexManager.writeIndex(index);
          }
        }

        await indexManager.rebalanceIndex();
        log.debug("MEMORY.md index updated");
      } catch (topicErr) {
        const msg = topicErr instanceof Error ? topicErr.message : String(topicErr);
        log.error("Failed to update topic files or index", { error: msg });
      }
    }

    // --- Post-session correction extraction ---
    if (sessionContent && cfg && allowLlm) {
      try {
        const { hasCorrectionSignals, extractCorrectionsFromTranscript } =
          await import("../../../cognitive/correction/extractor.js");
        log.info("correction extraction: path B entry", {
          hasSessionContent: !!sessionContent,
          hasCfg: !!cfg,
          allowLlm,
          sessionKey: event.sessionKey,
        });
        if (hasCorrectionSignals(sessionContent)) {
          const userId = resolveCorrectionUserId(event.sessionKey);
          if (userId) {
            const { createBackgroundGenerateText } =
              await import("../../../cognitive/evolution/standalone-generate.js");
            const { CorrectionStore } = await import("../../../cognitive/correction/store.js");
            const { resolveConfigDir } = await import("../../../utils.js");
            const { parseAgentSessionKey } = await import("../../../routing/session-key.js");
            const parsed = parseAgentSessionKey(event.sessionKey);
            const agentId = parsed?.agentId ?? "main";

            const generateText = await createBackgroundGenerateText(cfg, { maxTokens: 2000 });
            const corrections = await extractCorrectionsFromTranscript(
              sessionContent,
              generateText,
            );

            if (corrections.length > 0) {
              const corrStore = new CorrectionStore(resolveConfigDir());
              for (const corr of corrections) {
                await corrStore.addOrReinforce(agentId, userId, corr);
              }
              log.info("Correction extraction complete", { count: corrections.length });
            } else {
              log.info("correction extraction: no corrections extracted", {
                userId,
                sessionKey: event.sessionKey,
              });
            }
          }
        }
      } catch (corrErr) {
        const msg = corrErr instanceof Error ? corrErr.message : String(corrErr);
        log.warn("Correction extraction skipped", { error: msg });
      }
    }

    const dialogueDir = path.join(memoryDir, "dialogues");
    const stagingDir = path.join(dialogueDir, ".staging");
    const stagingFilename = event.sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_");
    const stagingPath = path.join(stagingDir, `${stagingFilename}.jsonl`);

    if (isCompaction && sessionFile) {
      try {
        await updateDialogueStaging(stagingPath, sessionFile);
        log.info("Dialogue staging updated", {
          stagingPath: stagingPath.replace(os.homedir(), "~"),
        });
      } catch (stagingErr) {
        const msg = stagingErr instanceof Error ? stagingErr.message : String(stagingErr);
        log.warn("Dialogue staging update skipped", { error: msg });
      }
    }

    if (isResetCommand && sessionFile) {
      try {
        const cleanDialogue = await getDialogueWithStaging(stagingPath, sessionFile);
        if (cleanDialogue && cleanDialogue.trim().length > 0) {
          const dialogueFilename = `${localDateStr(now)}-${localTimeStr(now)}.md`;
          const dialoguePath = path.join(dialogueDir, dialogueFilename);
          const frontmatter = [
            "---",
            `date: ${localDateTimeStr(now)}`,
            `participants:`,
            ...(summary.participants ?? ["user"]).map((p) => `  - ${p}`),
            `messageCount: ${cleanDialogue.split("\n").length}`,
            "---",
            "",
            "",
          ].join("\n");
          await writeTextAtomic(dialoguePath, frontmatter + cleanDialogue, {
            ensureDirMode: 0o755,
            appendTrailingNewline: true,
          });
          log.info("Dialogue archive saved", {
            path: dialoguePath.replace(os.homedir(), "~"),
            messageCount: cleanDialogue.split("\n").length,
          });
        }
        await fs.unlink(stagingPath).catch(() => {});
      } catch (dialogueErr) {
        const msg = dialogueErr instanceof Error ? dialogueErr.message : String(dialogueErr);
        log.warn("Dialogue archive save skipped", { error: msg });
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

export default saveSessionToMemory;
