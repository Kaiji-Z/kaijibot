import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import { resolvePreferredKaijiBotTmpDir } from "../../infra/tmp-kaijibot-dir.js";
import { transcribeAudioFile } from "../../media-understanding/runtime.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestHandlers } from "./types.js";

/** Hard cap for uploaded dictation audio (decoded), independent of config. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
};

function decodeAudioBase64(
  raw: string,
): { ok: true; buffer: Buffer; mime?: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "stt.transcribe requires audioBase64" };
  }
  const dataUrlMatch = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(trimmed);
  const base64 = dataUrlMatch ? dataUrlMatch[3] : trimmed;
  const dataUrlMime = dataUrlMatch?.[1];
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, error: "audioBase64 is not valid base64" };
  }
  if (buffer.byteLength === 0) {
    return { ok: false, error: "audioBase64 decoded to an empty buffer" };
  }
  if (buffer.byteLength > MAX_AUDIO_BYTES) {
    return {
      ok: false,
      error: `audio too large (${buffer.byteLength} bytes > ${MAX_AUDIO_BYTES})`,
    };
  }
  return { ok: true, buffer, mime: dataUrlMime };
}

function inferMime(params: { mimeType?: string; fileName?: string; buffer: Buffer }): string {
  const explicit = params.mimeType?.split(";")[0]?.trim().toLowerCase();
  if (explicit) {
    return explicit;
  }
  const ext = path.extname(params.fileName ?? "").toLowerCase();
  if (ext && MIME_BY_EXTENSION[ext]) {
    return MIME_BY_EXTENSION[ext];
  }
  if (params.buffer.subarray(0, 4).toString("ascii") === "RIFF") {
    return "audio/wav";
  }
  return "audio/webm";
}

export const sttHandlers: GatewayRequestHandlers = {
  "stt.transcribe": async ({ params, respond }) => {
    const audioBase64 = params.audioBase64;
    if (typeof audioBase64 !== "string") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "stt.transcribe requires audioBase64"),
      );
      return;
    }
    const decoded = decodeAudioBase64(audioBase64);
    if (!decoded.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, decoded.error));
      return;
    }
    const cfg = loadConfig();
    const mime = inferMime({
      mimeType: normalizeOptionalString(params.mimeType) ?? decoded.mime,
      fileName: normalizeOptionalString(params.fileName) ?? undefined,
      buffer: decoded.buffer,
    });
    const tmpRoot = resolvePreferredKaijiBotTmpDir();
    const tempDir = path.join(
      tmpRoot,
      `stt-transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    let filePath: string | undefined;
    try {
      await fs.mkdir(tempDir, { recursive: true, mode: 0o700 });
      const ext = path.extname(normalizeOptionalString(params.fileName) ?? "") || ".webm";
      filePath = path.join(tempDir, `audio${ext}`);
      await fs.writeFile(filePath, decoded.buffer, { mode: 0o600 });
      const result = await transcribeAudioFile({
        filePath,
        cfg,
        mime,
        language: normalizeOptionalString(params.language) ?? undefined,
      });
      const text = result.text?.trim();
      if (!text) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            "no audio transcription provider produced a transcript",
          ),
        );
        return;
      }
      respond(true, { text });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    } finally {
      if (filePath) {
        await fs.rm(path.dirname(filePath), { recursive: true, force: true }).catch(() => {});
      }
    }
  },
};
