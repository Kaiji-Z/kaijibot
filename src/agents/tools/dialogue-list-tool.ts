import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { loadConfig, type KaijiBotConfig } from "../../config/config.js";
import { resolveAgentWorkspaceDir } from "../agent-scope.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";

const DialogueListToolSchema = Type.Object({
  limit: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 100,
      description: "Maximum number of dialogues to return. Default 20.",
    }),
  ),
  dateFrom: Type.Optional(
    Type.String({
      description: "ISO date YYYY-MM-DD — only return dialogues on or after this date",
    }),
  ),
  dateTo: Type.Optional(
    Type.String({
      description: "ISO date YYYY-MM-DD — only return dialogues on or before this date",
    }),
  ),
});

const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-(\d{4})\.md$/;

export function createDialogueListTool(opts?: { config?: KaijiBotConfig }): AnyAgentTool {
  return {
    label: "Dialogue List",
    name: "dialogue_list",
    description:
      "Lists archived clean conversation dialogues. Files are stored under memory/dialogues/ with naming pattern YYYY-MM-DD-HHMM.md. Use this to discover past conversations, then use memory_get to read specific dialogue content.",
    parameters: DialogueListToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const cfg = opts?.config ?? loadConfig();
      const workspaceDir = resolveAgentWorkspaceDir(cfg, "main");
      const dialogueDir = path.join(workspaceDir, "memory", "dialogues");

      let files: string[];
      try {
        files = await fs.readdir(dialogueDir);
      } catch {
        return jsonResult({ count: 0, dialogues: [] });
      }

      const limit =
        typeof params.limit === "number" ? Math.min(Math.max(params.limit, 1), 100) : 20;
      const dateFrom = typeof params.dateFrom === "string" ? params.dateFrom.trim() : undefined;
      const dateTo = typeof params.dateTo === "string" ? params.dateTo.trim() : undefined;

      const dialogues: Array<{
        filename: string;
        date: string;
        time: string;
        path: string;
      }> = [];

      for (const file of files) {
        if (!file.endsWith(".md")) {
          continue;
        }
        const match = FILENAME_RE.exec(file);
        if (!match) {
          continue;
        }

        const [, date, time] = match;
        const hhmm = `${time.slice(0, 2)}:${time.slice(2)}`;

        if (dateFrom && date < dateFrom) {
          continue;
        }
        if (dateTo && date > dateTo) {
          continue;
        }

        dialogues.push({
          filename: file,
          date,
          time: hhmm,
          path: `memory/dialogues/${file}`,
        });
      }

      // Sort by date+time descending (newest first)
      dialogues.sort((a, b) => {
        const keyA = `${a.date}${a.time}`;
        const keyB = `${b.date}${b.time}`;
        return keyB.localeCompare(keyA);
      });

      const sliced = dialogues.slice(0, limit);
      return jsonResult({ count: sliced.length, dialogues: sliced });
    },
  };
}
