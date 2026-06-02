import fs from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import { preprocessSessionTranscript } from "../../hooks/bundled/session-memory/transcript.js";
import {
  describeSessionTranscriptTool,
  SESSION_TRANSCRIPT_TOOL_DISPLAY_SUMMARY,
} from "../tool-description-presets.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";

const SessionTranscriptToolSchema = Type.Object({
  transcriptPath: Type.String({
    description:
      "Absolute path to the session transcript file (JSONL), typically from sessions_list.transcriptPath.",
  }),
  maxMessages: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 2000,
      description:
        "Maximum number of messages to return. Defaults to 500. Returns the most recent messages when the transcript is longer.",
    }),
  ),
});

export function createSessionTranscriptTool(): AnyAgentTool {
  return {
    label: "Session Transcript",
    name: "read_session_transcript",
    displaySummary: SESSION_TRANSCRIPT_TOOL_DISPLAY_SUMMARY,
    description: describeSessionTranscriptTool(),
    parameters: SessionTranscriptToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const transcriptPath =
        typeof params.transcriptPath === "string" ? params.transcriptPath.trim() : "";
      const maxMessagesRaw =
        typeof params.maxMessages === "number" && Number.isFinite(params.maxMessages)
          ? Math.max(1, Math.floor(params.maxMessages))
          : undefined;

      if (!transcriptPath) {
        return jsonResult({ status: "error", error: "transcriptPath is required." });
      }

      let raw: string;
      try {
        raw = await fs.readFile(transcriptPath, "utf-8");
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          return jsonResult({ status: "not_found", path: transcriptPath });
        }
        return jsonResult({
          status: "error",
          error: `Failed to read file: ${(err as Error).message}`,
        });
      }

      const opts = maxMessagesRaw ? { maxMessages: maxMessagesRaw } : undefined;
      const content = preprocessSessionTranscript(raw, opts);

      if (!content) {
        return jsonResult({ status: "empty", messageCount: 0 });
      }

      const messageCount = content.split("\n").length;
      return jsonResult({ status: "ok", messageCount, content });
    },
  };
}
