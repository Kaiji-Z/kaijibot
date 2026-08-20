/**
 * Runtime + model download manager for the sherpa-speech extension.
 *
 * Downloads sherpa-onnx release tarballs into the extension state dir,
 * extracts them with the system `tar`, and records verified state in
 * `state.json` (atomic writes via plugin-sdk json-store).
 *
 * Downloads can be routed through a mirror by setting
 * `SHERPA_ONNX_DOWNLOAD_MIRROR` (a URL prefix such as
 * `https://gh-proxy.com/`), which is prepended to every github download URL.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readJsonFileWithFallback, writeJsonFileAtomically } from "kaijibot/plugin-sdk/json-store";
import {
  ASR_MODEL_MANIFESTS,
  RUNTIME_MANIFESTS,
  asrDownloadUrl,
  detectRuntimePlatform,
  resolveSherpaSpeechPaths,
  runtimeDownloadUrl,
  type AsrEngine,
} from "./models.js";

export type DownloadDeps = {
  fetchFn?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  /** Disable the archive size sanity check (tests with tiny fixtures). */
  skipSizeSanityCheck?: boolean;
};

export type DownloadResult = {
  ok: boolean;
  dir?: string;
  error?: string;
};

export type SherpaSpeechState = {
  runtime?: {
    version: string;
    platform: string;
    downloadedAt: string;
  };
  models?: Record<
    string,
    {
      downloadedAt: string;
      sha256?: string;
      bytes?: number;
    }
  >;
};

const inFlight = new Map<string, Promise<DownloadResult>>();

function mirrorUrl(url: string, env: NodeJS.ProcessEnv): string {
  const mirror = env.SHERPA_ONNX_DOWNLOAD_MIRROR?.trim();
  if (!mirror) {
    return url;
  }
  return `${mirror.replace(/\/+$/, "")}/${url}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runTar(
  archivePath: string,
  targetDir: string,
  stripComponents: number,
): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "tar",
      ["-xjf", archivePath, "-C", targetDir, `--strip-components=${stripComponents}`],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) {
        stderr = stderr.slice(-4000);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar exited with ${code}: ${stderr.trim()}`));
      }
    });
  });
}

async function downloadTo(
  url: string,
  destinationPath: string,
  fetchFn: typeof fetch,
  log?: (message: string) => void,
): Promise<{ bytes: number; sha256: string }> {
  const response = await fetchFn(url);
  if (!response.ok || !response.body) {
    throw new Error(`download failed: ${url} -> HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new Error(`downloaded empty file: ${url}`);
  }
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, buffer);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  log?.(`downloaded ${url} (${(buffer.byteLength / 1_048_576).toFixed(1)} MB)`);
  return { bytes: buffer.byteLength, sha256 };
}

async function readState(stateFilePath: string): Promise<SherpaSpeechState> {
  const result = await readJsonFileWithFallback<SherpaSpeechState>(stateFilePath, {});
  return result.value;
}

async function updateState(
  stateFilePath: string,
  mutate: (state: SherpaSpeechState) => SherpaSpeechState,
): Promise<void> {
  const current = await readState(stateFilePath);
  await writeJsonFileAtomically(stateFilePath, mutate(current));
}

/** Ensure the sherpa-onnx runtime binaries exist locally; download when missing. */
export async function ensureRuntime(deps: DownloadDeps = {}): Promise<DownloadResult> {
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetchFn ?? fetch;
  const paths = resolveSherpaSpeechPaths(env);
  const platform = detectRuntimePlatform();
  if (!platform) {
    return { ok: false, error: `unsupported platform: ${process.platform}/${process.arch}` };
  }
  const manifest = RUNTIME_MANIFESTS[platform];
  const asrBinaryName = platform === "win-x64" ? "sherpa-onnx-offline.exe" : "sherpa-onnx-offline";
  const asrBinaryCandidates = [
    path.join(paths.runtimeBinDir, asrBinaryName),
    path.join(paths.runtimeDir, asrBinaryName),
  ];
  const asrBinaryFound = async () => {
    for (const candidate of asrBinaryCandidates) {
      if (await fileExists(candidate)) {
        return candidate;
      }
    }
    return null;
  };
  if (await asrBinaryFound()) {
    return { ok: true, dir: paths.runtimeDir };
  }
  const key = `runtime:${platform}`;
  const existing = inFlight.get(key);
  if (existing) {
    return await existing;
  }
  const task = (async (): Promise<DownloadResult> => {
    const archivePath = path.join(paths.rootDir, `download-${manifest.asset}`);
    try {
      deps.log?.(`downloading sherpa-onnx runtime ${manifest.asset} ...`);
      await downloadTo(
        mirrorUrl(runtimeDownloadUrl(manifest), env),
        archivePath,
        fetchFn,
        deps.log,
      );
      await runTar(archivePath, paths.runtimeDir, manifest.stripComponents);
      await fs.rm(archivePath, { force: true });
      if (!(await asrBinaryFound())) {
        throw new Error(`runtime archive extracted but ${asrBinaryName} not found`);
      }
      await updateState(paths.stateFilePath, (state) => ({
        ...state,
        runtime: {
          version: manifest.asset,
          platform,
          downloadedAt: new Date().toISOString(),
        },
      }));
      return { ok: true, dir: paths.runtimeDir };
    } catch (error) {
      await fs.rm(archivePath, { force: true });
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  return await task;
}

async function ensureTarballModel(params: {
  key: string;
  downloadUrl: string;
  targetDir: string;
  requiredFiles: string[];
  approximateBytes: number;
  deps: DownloadDeps;
}): Promise<DownloadResult> {
  const { key, downloadUrl, targetDir, requiredFiles, approximateBytes, deps } = params;
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetchFn ?? fetch;
  const paths = resolveSherpaSpeechPaths(env);

  const allPresent = async () => {
    for (const file of requiredFiles) {
      if (!(await fileExists(path.join(targetDir, file)))) {
        return false;
      }
    }
    return true;
  };
  if (await allPresent()) {
    return { ok: true, dir: targetDir };
  }
  const existing = inFlight.get(key);
  if (existing) {
    return await existing;
  }
  const task = (async (): Promise<DownloadResult> => {
    const archivePath = path.join(paths.rootDir, `download-${path.basename(downloadUrl)}`);
    try {
      const url = mirrorUrl(downloadUrl, env);
      deps.log?.(`downloading model ${key} ...`);
      const { bytes, sha256 } = await downloadTo(url, archivePath, fetchFn, deps.log);
      if (!deps.skipSizeSanityCheck && bytes < approximateBytes * 0.5) {
        throw new Error(
          `downloaded archive suspiciously small (${bytes} bytes < 50% of expected ${approximateBytes})`,
        );
      }
      await runTar(archivePath, targetDir, 1);
      await fs.rm(archivePath, { force: true });
      if (!(await allPresent())) {
        throw new Error(`model archive extracted but required files missing in ${targetDir}`);
      }
      await updateState(paths.stateFilePath, (state) => ({
        ...state,
        models: {
          ...state.models,
          [key]: {
            downloadedAt: new Date().toISOString(),
            sha256,
            bytes,
          },
        },
      }));
      return { ok: true, dir: targetDir };
    } catch (error) {
      await fs.rm(archivePath, { force: true });
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  return await task;
}

export type EnsureAsrModelResult = DownloadResult & { model?: AsrEngine };

/** Ensure an ASR model exists locally. Defaults to sense-voice. */
export async function ensureAsrModel(
  model: AsrEngine = "sense-voice",
  deps: DownloadDeps = {},
): Promise<EnsureAsrModelResult> {
  const manifest = ASR_MODEL_MANIFESTS[model];
  if (!manifest) {
    return { ok: false, error: `unknown ASR model: ${model}` };
  }
  const env = deps.env ?? process.env;
  const paths = resolveSherpaSpeechPaths(env);
  const result = await ensureTarballModel({
    key: `asr:${model}`,
    downloadUrl: asrDownloadUrl(manifest),
    targetDir: paths.modelDir(model),
    requiredFiles: manifest.requiredFiles,
    approximateBytes: manifest.approximateBytes,
    deps,
  });
  return { ...result, model };
}

export async function readSherpaSpeechState(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SherpaSpeechState> {
  return await readState(resolveSherpaSpeechPaths(env).stateFilePath);
}
