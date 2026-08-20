/**
 * sherpa-onnx model manifest and local path resolution.
 *
 * Models are NOT bundled with the repo. They are downloaded at runtime into
 * `<stateDir>/sherpa-speech/models/<id>/` and the sherpa-onnx runtime binaries
 * into `<stateDir>/sherpa-speech/runtime/`.
 */

import path from "node:path";
import { resolveStateDir } from "kaijibot/plugin-sdk/state-paths";

export const SHERPA_ONNX_VERSION = "v1.13.6";

const GITHUB_RELEASE_BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download";

export type RuntimePlatform = "linux-x64" | "linux-aarch64" | "macos-universal" | "win-x64";

export type RuntimeManifest = {
  platform: RuntimePlatform;
  /** Tarball asset name on the sherpa-onnx release. */
  asset: string;
  /** Directory prefix inside the tarball (stripped on extract). */
  stripComponents: number;
};

export const RUNTIME_MANIFESTS: Record<RuntimePlatform, RuntimeManifest> = {
  "linux-x64": {
    platform: "linux-x64",
    asset: `sherpa-onnx-${SHERPA_ONNX_VERSION}-linux-x64-static.tar.bz2`,
    stripComponents: 1,
  },
  "linux-aarch64": {
    platform: "linux-aarch64",
    asset: `sherpa-onnx-${SHERPA_ONNX_VERSION}-linux-aarch64-static.tar.bz2`,
    stripComponents: 1,
  },
  "macos-universal": {
    platform: "macos-universal",
    asset: `sherpa-onnx-${SHERPA_ONNX_VERSION}-osx-universal2-shared.tar.bz2`,
    stripComponents: 1,
  },
  "win-x64": {
    platform: "win-x64",
    asset: `sherpa-onnx-${SHERPA_ONNX_VERSION}-win-x64-shared.tar.bz2`,
    stripComponents: 1,
  },
};

export type AsrEngine = "sense-voice" | "whisper-turbo";

export type AsrModelManifest = {
  id: AsrEngine;
  /** Tarball asset on the `asr-models` release tag. */
  asset: string;
  /** Approximate download size in bytes (for progress/size sanity check). */
  approximateBytes: number;
  /** Files (relative to the model dir) that must exist for the model to count as ready. */
  requiredFiles: string[];
  /** Optional alternative onnx weights (first existing wins at runtime). */
  modelFileCandidates: string[];
  description: string;
};

export const ASR_MODEL_MANIFESTS: Record<AsrEngine, AsrModelManifest> = {
  "sense-voice": {
    id: "sense-voice",
    asset: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
    approximateBytes: 163_000_000,
    requiredFiles: ["tokens.txt"],
    modelFileCandidates: ["model.int8.onnx", "model.onnx"],
    description: "SenseVoice Small int8 (zh/en/yue/ja/ko, punctuation, robust)",
  },
  "whisper-turbo": {
    id: "whisper-turbo",
    asset: "sherpa-onnx-whisper-turbo.tar.bz2",
    approximateBytes: 563_000_000,
    requiredFiles: ["tokens.txt"],
    modelFileCandidates: ["encoder.int8.onnx", "encoder.onnx", "decoder.int8.onnx", "decoder.onnx"],
    description: "Whisper large-v3-turbo (100+ languages, x64 servers only)",
  },
};

export function asrDownloadUrl(model: AsrModelManifest): string {
  return `${GITHUB_RELEASE_BASE}/asr-models/${model.asset}`;
}

export function runtimeDownloadUrl(manifest: RuntimeManifest): string {
  return `${GITHUB_RELEASE_BASE}/${SHERPA_ONNX_VERSION}/${manifest.asset}`;
}

export function detectRuntimePlatform(): RuntimePlatform | null {
  if (process.platform === "win32") {
    return "win-x64";
  }
  if (process.platform === "darwin") {
    return "macos-universal";
  }
  if (process.platform === "linux") {
    if (process.arch === "arm64") {
      return "linux-aarch64";
    }
    if (process.arch === "x64") {
      return "linux-x64";
    }
    return null;
  }
  return null;
}

export type SherpaSpeechPaths = {
  rootDir: string;
  runtimeDir: string;
  modelsDir: string;
  runtimeBinDir: string;
  modelDir: (modelId: string) => string;
  stateFilePath: string;
};

export function resolveSherpaSpeechPaths(env: NodeJS.ProcessEnv = process.env): SherpaSpeechPaths {
  const stateDir = resolveStateDir(env);
  const rootDir = path.join(stateDir, "sherpa-speech");
  const runtimeDir = path.join(rootDir, "runtime");
  const modelsDir = path.join(rootDir, "models");
  return {
    rootDir,
    runtimeDir,
    modelsDir,
    runtimeBinDir: path.join(runtimeDir, "bin"),
    modelDir: (modelId: string) => path.join(modelsDir, modelId),
    stateFilePath: path.join(rootDir, "state.json"),
  };
}
