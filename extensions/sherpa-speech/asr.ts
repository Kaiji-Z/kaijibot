/**
 * Local ASR via the sherpa-onnx offline CLI (SenseVoice / Whisper turbo).
 *
 * Flow: buffer → temp file → ffmpeg (16k mono wav) → sherpa-onnx-offline → text.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "kaijibot/plugin-sdk/media-runtime";
import type {
  AudioTranscriptionRequest,
  AudioTranscriptionResult,
} from "kaijibot/plugin-sdk/media-understanding";
import { resolvePreferredKaijiBotTmpDir } from "kaijibot/plugin-sdk/temp-path";
import { ASR_MODEL_MANIFESTS, resolveSherpaSpeechPaths, type AsrEngine } from "./models.js";
import { resolveSherpaBinaries } from "./runtime.js";

const MIME_EXT: Record<string, string> = {
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/aac": ".aac",
  "audio/flac": ".flac",
};

export function resolveAudioExtension(fileName?: string, mime?: string): string {
  const fromName = path.extname(fileName ?? "");
  if (fromName && fromName.length > 1) {
    return fromName;
  }
  const normalized = mime?.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_EXT[normalized] ?? ".webm";
}

/** Parse sherpa-onnx-offline stdout: JSON result line (v1.13+) or legacy `Text:` lines. */
export function parseSherpaTranscript(stdout: string): string {
  for (const line of stdout.split(/\r?\n/).toReversed()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as { text?: unknown };
      if (typeof parsed.text === "string" && parsed.text.trim()) {
        return parsed.text.trim();
      }
    } catch {
      // not the result JSON line
    }
  }
  const parts: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^Text:(.*)$/.exec(line.trim());
    if (match?.[1]) {
      parts.push(match[1].trim());
    }
  }
  return parts.join(" ").trim();
}

export function resolveAsrEngine(
  req: AudioTranscriptionRequest,
  env: NodeJS.ProcessEnv,
): AsrEngine {
  const requested = req.model?.trim().toLowerCase();
  if (requested && requested in ASR_MODEL_MANIFESTS) {
    return requested as AsrEngine;
  }
  const envModel = env.SHERPA_ONNX_ASR_MODEL?.trim().toLowerCase();
  if (envModel && envModel in ASR_MODEL_MANIFESTS) {
    return envModel as AsrEngine;
  }
  return "sense-voice";
}

async function findFirstExisting(dir: string, candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(dir, candidate));
      return path.join(dir, candidate);
    } catch {
      // try next
    }
  }
  throw new Error(`none of [${candidates.join(", ")}] found in ${dir}`);
}

async function buildAsrArgs(params: {
  engine: AsrEngine;
  modelDir: string;
  language?: string;
  env: NodeJS.ProcessEnv;
}): Promise<string[]> {
  const { engine, modelDir, language, env } = params;
  const args: string[] = [];
  const tokens = path.join(modelDir, "tokens.txt");
  if (engine === "sense-voice") {
    args.push(
      `--sense-voice-model=${await findFirstExisting(modelDir, ["model.int8.onnx", "model.onnx"])}`,
      `--tokens=${tokens}`,
      "--sense-voice-use-itn=1",
    );
    if (language && ["auto", "zh", "en", "ja", "ko", "yue"].includes(language)) {
      args.push(`--sense-voice-language=${language}`);
    }
  } else {
    const encoder = await findFirstExisting(modelDir, ["encoder.int8.onnx", "encoder.onnx"]);
    const decoder = await findFirstExisting(modelDir, ["decoder.int8.onnx", "decoder.onnx"]);
    args.push(`--whisper-encoder=${encoder}`, `--whisper-decoder=${decoder}`, `--tokens=${tokens}`);
    if (language) {
      args.push(`--whisper-language=${language}`);
    }
  }
  const threads = env.SHERPA_ONNX_NUM_THREADS?.trim();
  if (threads && /^\d+$/.test(threads)) {
    args.push(`--num-threads=${threads}`);
  }
  return args;
}

async function runSherpaOffline(params: {
  binary: string;
  engine: AsrEngine;
  modelDir: string;
  wavPath: string;
  language?: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
}): Promise<string> {
  const { binary, wavPath, timeoutMs, env } = params;
  const args = await buildAsrArgs({
    engine: params.engine,
    modelDir: params.modelDir,
    language: params.language,
    env,
  });
  args.push(wavPath);
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`sherpa-onnx-offline timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 200_000) {
        stdout = stdout.slice(-200_000);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) {
        stderr = stderr.slice(-8000);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = parseSherpaTranscript(stdout);
      if (code === 0 && text) {
        resolve(text);
        return;
      }
      reject(
        new Error(
          `sherpa-onnx-offline exited with ${code}${text ? ` (partial text: ${text})` : ""}: ${stderr.trim().slice(-500)}`,
        ),
      );
    });
  });
}

/**
 * Transcribe audio locally. The caller is responsible for ensuring the runtime
 * and model are present (see model-manager); this function fails fast when
 * they are missing so the media-understanding chain can fall back to cloud.
 */
export async function transcribeWithSherpa(
  req: AudioTranscriptionRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AudioTranscriptionResult> {
  const binaries = await resolveSherpaBinaries(env);
  if (!binaries) {
    throw new Error("sherpa-onnx runtime not available");
  }
  const engine = resolveAsrEngine(req, env);
  const manifest = ASR_MODEL_MANIFESTS[engine];
  const paths = resolveSherpaSpeechPaths(env);
  const modelDir = paths.modelDir(manifest.id);
  await findFirstExisting(modelDir, manifest.modelFileCandidates);

  const tmpRoot = resolvePreferredKaijiBotTmpDir();
  await fs.mkdir(tmpRoot, { recursive: true, mode: 0o700 });
  const tempDir = path.join(
    tmpRoot,
    `sherpa-asr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await fs.mkdir(tempDir, { recursive: true, mode: 0o700 });
  try {
    const inputPath = path.join(tempDir, `input${resolveAudioExtension(req.fileName, req.mime)}`);
    await fs.writeFile(inputPath, req.buffer);
    const wavPath = path.join(tempDir, "audio-16k.wav");
    try {
      await runFfmpeg([
        "-y",
        "-i",
        inputPath,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        wavPath,
      ]);
    } catch {
      // ffmpeg unavailable or input undecodable → try feeding the original file
      await fs.copyFile(inputPath, wavPath);
    }
    const text = await runSherpaOffline({
      binary: binaries.offlineAsr,
      engine,
      modelDir,
      wavPath,
      language: req.language,
      timeoutMs: req.timeoutMs,
      env,
    });
    return { text, model: manifest.id };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
