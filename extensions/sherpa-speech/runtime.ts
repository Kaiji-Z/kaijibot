/**
 * Resolve sherpa-onnx CLI binaries.
 *
 * Order: SHERPA_ONNX_RUNTIME_DIR env → managed state dir → PATH.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { resolveSherpaSpeechPaths } from "./models.js";

export type SherpaRuntimeBinaries = {
  offlineAsr: string;
};

async function firstExisting(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function exeName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

export async function resolveSherpaBinaries(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SherpaRuntimeBinaries | null> {
  const paths = resolveSherpaSpeechPaths(env);
  const envRuntimeDir = env.SHERPA_ONNX_RUNTIME_DIR?.trim();
  const searchDirs = [
    ...(envRuntimeDir ? [path.join(envRuntimeDir, "bin"), envRuntimeDir] : []),
    paths.runtimeBinDir,
    paths.runtimeDir,
  ];
  const asrCandidates = [
    ...searchDirs.map((dir) => path.join(dir, exeName("sherpa-onnx-offline"))),
    exeName("sherpa-onnx-offline"),
  ];
  const offlineAsr = await firstExisting(asrCandidates);
  if (!offlineAsr) {
    return null;
  }
  return { offlineAsr };
}

export async function isSherpaRuntimeReady(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  return (await resolveSherpaBinaries(env)) !== null;
}
