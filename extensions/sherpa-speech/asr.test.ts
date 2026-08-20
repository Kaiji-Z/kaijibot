import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseSherpaTranscript,
  resolveAsrEngine,
  resolveAudioExtension,
  transcribeWithSherpa,
} from "./asr.js";
import { isAsrReadySync, resolveDefaultAsrEngine } from "./engine.js";

let tmpRoot: string;
let env: NodeJS.ProcessEnv;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sherpa-asr-test-"));
}

function writeExecutable(filePath: string, script: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, script);
  fs.chmodSync(filePath, 0o755);
}

/** 0.3s 16kHz mono silent wav, generated with ffmpeg. */
function makeWav(dir: string): string {
  const wavPath = path.join(dir, "speech.wav");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=16000:cl=mono",
    "-t",
    "0.3",
    "-c:a",
    "pcm_s16le",
    wavPath,
  ]);
  return wavPath;
}

function setupFakeEngine(options?: { stdout?: string }): { runtimeDir: string; wavPath: string } {
  const runtimeDir = path.join(tmpRoot, "runtime-fake");
  const stdout = options?.stdout ?? "Text:你好世界\n";
  writeExecutable(
    path.join(runtimeDir, "bin", "sherpa-onnx-offline"),
    `#!/bin/sh\necho "${stdout}"\n`,
  );
  const modelDir = path.join(tmpRoot, "sherpa-speech", "models", "sense-voice");
  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(path.join(modelDir, "model.int8.onnx"), "weights");
  fs.writeFileSync(path.join(modelDir, "tokens.txt"), "a b");
  const wavPath = makeWav(tmpRoot);
  env = {
    ...env,
    SHERPA_ONNX_RUNTIME_DIR: runtimeDir,
  };
  return { runtimeDir, wavPath };
}

beforeEach(() => {
  tmpRoot = makeTmpDir();
  env = {
    ...process.env,
    KAIJIBOT_STATE_DIR: tmpRoot,
    HOME: tmpRoot,
    SHERPA_ONNX_ASR_MODEL: "",
    SHERPA_ONNX_NUM_THREADS: "",
  };
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("parseSherpaTranscript", () => {
  it("joins Text lines and trims", () => {
    const stdout = ["some log line", "Text:你好,", "Text:世界", "Text:", "Done"].join("\n");
    expect(parseSherpaTranscript(stdout)).toBe("你好, 世界");
  });

  it("returns empty string when no Text lines", () => {
    expect(parseSherpaTranscript("only logs\nnothing")).toBe("");
  });

  it("parses the JSON result line emitted by sherpa-onnx v1.13+", () => {
    const stdout = [
      "/tmp/audio-16k.wav",
      "----",
      "num threads: 4",
      "Elapsed seconds: 0.189 s",
      '{"lang": "<|zh|>", "emotion": "<|NEUTRAL|>", "event": "<|Speech|>", "text": "你好，世界，今天天气不错。"}',
    ].join("\n");
    expect(parseSherpaTranscript(stdout)).toBe("你好，世界，今天天气不错。");
  });
});

describe("resolveAudioExtension", () => {
  it("prefers the file name extension", () => {
    expect(resolveAudioExtension("voice.webm", "audio/mp4")).toBe(".webm");
  });

  it("maps mime types", () => {
    expect(resolveAudioExtension(undefined, "audio/webm;codecs=opus")).toBe(".webm");
    expect(resolveAudioExtension(undefined, "audio/mp4")).toBe(".m4a");
    expect(resolveAudioExtension(undefined, "audio/mpeg")).toBe(".mp3");
  });

  it("falls back to webm", () => {
    expect(resolveAudioExtension(undefined, undefined)).toBe(".webm");
  });
});

describe("resolveAsrEngine", () => {
  it("prefers request model, then env, then sense-voice", () => {
    expect(resolveAsrEngine({ model: "whisper-turbo" } as never, env)).toBe("whisper-turbo");
    expect(resolveAsrEngine({} as never, { ...env, SHERPA_ONNX_ASR_MODEL: "whisper-turbo" })).toBe(
      "whisper-turbo",
    );
    expect(resolveAsrEngine({ model: "gpt-4o-transcribe" } as never, env)).toBe("sense-voice");
  });

  it("resolveDefaultAsrEngine reads env", () => {
    expect(resolveDefaultAsrEngine({ ...env, SHERPA_ONNX_ASR_MODEL: "whisper-turbo" })).toBe(
      "whisper-turbo",
    );
    expect(resolveDefaultAsrEngine(env)).toBe("sense-voice");
  });
});

describe("transcribeWithSherpa", () => {
  it("runs the CLI against transcoded audio and returns the transcript", async () => {
    const { wavPath } = setupFakeEngine({ stdout: "Text:今天天气不错\n" });
    const buffer = fs.readFileSync(wavPath);
    const result = await transcribeWithSherpa(
      {
        buffer,
        fileName: "voice.webm",
        mime: "audio/webm",
        apiKey: "unused",
        timeoutMs: 30_000,
      },
      env,
    );
    expect(result.text).toBe("今天天气不错");
    expect(result.model).toBe("sense-voice");
  }, 30_000);

  it("throws when the runtime is missing", async () => {
    await expect(
      transcribeWithSherpa(
        {
          buffer: Buffer.from("x"),
          fileName: "a.wav",
          apiKey: "unused",
          timeoutMs: 5_000,
        },
        { ...env, SHERPA_ONNX_RUNTIME_DIR: path.join(tmpRoot, "missing") },
      ),
    ).rejects.toThrow("sherpa-onnx runtime not available");
  });
});

describe("isAsrReadySync", () => {
  it("reports ready when binary + model files exist", () => {
    setupFakeEngine();
    expect(isAsrReadySync(env)).toBe(true);
  });

  it("reports not ready when model weights are missing", () => {
    setupFakeEngine();
    fs.rmSync(path.join(tmpRoot, "sherpa-speech", "models", "sense-voice", "model.int8.onnx"));
    expect(isAsrReadySync(env)).toBe(false);
  });

  it("reports not ready without a runtime binary", () => {
    setupFakeEngine();
    expect(isAsrReadySync({ ...env, SHERPA_ONNX_RUNTIME_DIR: path.join(tmpRoot, "nope") })).toBe(
      false,
    );
  });
});
