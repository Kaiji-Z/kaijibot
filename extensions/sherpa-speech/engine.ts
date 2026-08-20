/**
 * Engine readiness checks + background warm-up downloads.
 */

import fs from "node:fs";
import path from "node:path";
import type { MediaUnderstandingProvider } from "kaijibot/plugin-sdk/media-understanding";
import { transcribeWithSherpa } from "./asr.js";
import { ensureAsrModel, ensureRuntime } from "./model-manager.js";
import { ASR_MODEL_MANIFESTS, resolveSherpaSpeechPaths, type AsrEngine } from "./models.js";

function asrBinaryName(): string {
  return process.platform === "win32" ? "sherpa-onnx-offline.exe" : "sherpa-onnx-offline";
}

function resolveAsrBinarySync(env: NodeJS.ProcessEnv): string | null {
  const paths = resolveSherpaSpeechPaths(env);
  const candidates = [
    ...(env.SHERPA_ONNX_RUNTIME_DIR?.trim()
      ? [
          path.join(env.SHERPA_ONNX_RUNTIME_DIR.trim(), "bin", asrBinaryName()),
          path.join(env.SHERPA_ONNX_RUNTIME_DIR.trim(), asrBinaryName()),
        ]
      : []),
    path.join(paths.runtimeBinDir, asrBinaryName()),
    asrBinaryName(),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function asrModelReadySync(env: NodeJS.ProcessEnv, engine: AsrEngine): boolean {
  const manifest = ASR_MODEL_MANIFESTS[engine];
  const modelDir = resolveSherpaSpeechPaths(env).modelDir(engine);
  const hasRequired = manifest.requiredFiles.every((file) =>
    fs.existsSync(path.join(modelDir, file)),
  );
  const hasWeights = manifest.modelFileCandidates.some((candidate) =>
    fs.existsSync(path.join(modelDir, candidate)),
  );
  return hasRequired && hasWeights;
}

/**
 * Sync readiness probe (used by resolveSyntheticAuth, which cannot await).
 * Only the default engine needs to be ready for the provider to pass the
 * media-understanding auth gate.
 */
export function isAsrReadySync(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!resolveAsrBinarySync(env)) {
    return false;
  }
  return asrModelReadySync(env, resolveDefaultAsrEngine(env));
}

export function resolveDefaultAsrEngine(env: NodeJS.ProcessEnv = process.env): AsrEngine {
  const envModel = env.SHERPA_ONNX_ASR_MODEL?.trim().toLowerCase();
  if (envModel && envModel in ASR_MODEL_MANIFESTS) {
    return envModel as AsrEngine;
  }
  return "sense-voice";
}

/** Media-understanding provider for the local engine. Fails fast when not ready. */
export function buildSherpaMediaUnderstandingProvider(): MediaUnderstandingProvider {
  return {
    id: "sherpa-speech",
    capabilities: ["audio"],
    defaultModels: { audio: resolveDefaultAsrEngine(process.env) },
    autoPriority: { audio: 5 },
    transcribeAudio: async (req) => await transcribeWithSherpa(req, process.env),
  };
}

let warmupStarted = false;

/**
 * Background warm-up after gateway boot: download runtime + default ASR model
 * so the local engine is ready without user action.
 * Opt out with SHERPA_ONNX_AUTO_DOWNLOAD=0.
 */
export function startBackgroundWarmup(log: (message: string) => void): void {
  if (warmupStarted) {
    return;
  }
  warmupStarted = true;
  if (process.env.SHERPA_ONNX_AUTO_DOWNLOAD?.trim() === "0") {
    log("sherpa-speech: auto download disabled (SHERPA_ONNX_AUTO_DOWNLOAD=0)");
    return;
  }
  void (async () => {
    try {
      const runtime = await ensureRuntime({ log });
      if (!runtime.ok) {
        log(`sherpa-speech: runtime download failed: ${runtime.error}`);
        return;
      }
      const asr = await ensureAsrModel(resolveDefaultAsrEngine(process.env), { log });
      log(
        asr.ok
          ? `sherpa-speech: local ASR ready (${asr.model})`
          : `sherpa-speech: ASR model download failed: ${asr.error}`,
      );
    } catch (error) {
      log(
        `sherpa-speech: warm-up error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  })();
}

export { ensureAsrModel, ensureRuntime };
