import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureAsrModel, ensureRuntime } from "./model-manager.js";
import { ASR_MODEL_MANIFESTS, detectRuntimePlatform, resolveSherpaSpeechPaths } from "./models.js";

let tmpRoot: string;
let env: NodeJS.ProcessEnv;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sherpa-speech-test-"));
}

/** Build a real tar.bz2 with strip-prefix layout `<prefix>/<name>` per file. */
function makeTarball(files: Record<string, string>, prefix: string): Buffer {
  const dir = makeTmpDir();
  const staging = path.join(dir, "staging", prefix);
  fs.mkdirSync(staging, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(staging, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const archive = path.join(dir, "fixture.tar.bz2");
  execFileSync("tar", ["-cjf", archive, "-C", path.join(dir, "staging"), prefix]);
  const buffer = fs.readFileSync(archive);
  fs.rmSync(dir, { recursive: true, force: true });
  return buffer;
}

function fetchOkWith(payload: Buffer): typeof fetch {
  return (async () =>
    new Response(payload as unknown as BodyInit, {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    })) as unknown as typeof fetch;
}

beforeEach(() => {
  tmpRoot = makeTmpDir();
  env = {
    ...process.env,
    KAIJIBOT_STATE_DIR: tmpRoot,
    HOME: tmpRoot,
    SHERPA_ONNX_DOWNLOAD_MIRROR: "",
    SHERPA_ONNX_RUNTIME_DIR: "",
  };
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("models manifest", () => {
  it("sense-voice and whisper-turbo manifests are well-formed", () => {
    for (const manifest of Object.values(ASR_MODEL_MANIFESTS)) {
      expect(manifest.asset.length).toBeGreaterThan(0);
      expect(manifest.requiredFiles).toContain("tokens.txt");
      expect(manifest.modelFileCandidates.length).toBeGreaterThan(0);
    }
  });

  it("detects a concrete runtime platform on this machine", () => {
    expect(detectRuntimePlatform()).not.toBeNull();
  });

  it("resolves paths under the state dir", () => {
    const paths = resolveSherpaSpeechPaths(env);
    expect(paths.modelDir("sense-voice")).toBe(
      path.join(tmpRoot, "sherpa-speech", "models", "sense-voice"),
    );
    expect(paths.stateFilePath).toBe(path.join(tmpRoot, "sherpa-speech", "state.json"));
  });
});

describe("ensureRuntime", () => {
  it("downloads, extracts, and marks the binary dir", async () => {
    const platform = detectRuntimePlatform();
    if (!platform || platform === "macos-universal" || platform === "win-x64") {
      return; // binary name check below is POSIX-specific
    }
    const binaryName = "sherpa-onnx-offline";
    const tarball = makeTarball(
      { [`bin/${binaryName}`]: "#!/bin/sh\necho fake\n" },
      `sherpa-onnx-${process.platform}-${process.arch}-dir`,
    );
    const result = await ensureRuntime({
      fetchFn: fetchOkWith(tarball),
      env,
    });
    expect(result.ok, `download error: ${result.error}`).toBe(true);
    const binaryPath = path.join(tmpRoot, "sherpa-speech", "runtime", "bin", binaryName);
    expect(fs.existsSync(binaryPath)).toBe(true);
    const state = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, "sherpa-speech", "state.json"), "utf-8"),
    ) as { runtime?: { platform: string } };
    expect(state.runtime?.platform).toBe(platform);
  });

  it("short-circuits when the binary already exists", async () => {
    fs.mkdirSync(path.join(tmpRoot, "sherpa-speech", "runtime", "bin"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpRoot, "sherpa-speech", "runtime", "bin", "sherpa-onnx-offline"),
      "#!/bin/sh\n",
    );
    let called = 0;
    const result = await ensureRuntime({
      fetchFn: (async () => {
        called += 1;
        throw new Error("network should not be touched");
      }) as unknown as typeof fetch,
      env,
    });
    expect(result.ok, `download error: ${result.error}`).toBe(true);
    expect(called).toBe(0);
  });
});

describe("ensureAsrModel", () => {
  it("downloads and extracts the sense-voice model files", async () => {
    const tarball = makeTarball(
      { "model.int8.onnx": "weights", "tokens.txt": "a b c" },
      "sherpa-onnx-sense-voice-int8",
    );
    const result = await ensureAsrModel("sense-voice", {
      fetchFn: fetchOkWith(tarball),
      env,
      skipSizeSanityCheck: true,
    });
    expect(result.ok, `download error: ${result.error}`).toBe(true);
    expect(result.model).toBe("sense-voice");
    expect(
      fs.existsSync(
        path.join(tmpRoot, "sherpa-speech", "models", "sense-voice", "model.int8.onnx"),
      ),
    ).toBe(true);
    const state = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, "sherpa-speech", "state.json"), "utf-8"),
    ) as { models?: Record<string, { sha256?: string }> };
    expect(state.models?.["asr:sense-voice"]?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects unknown model ids", async () => {
    const result = await ensureAsrModel("nope" as "sense-voice", { env });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("unknown ASR model");
  });

  it("rejects suspiciously small archives", async () => {
    const tarball = makeTarball({ "model.int8.onnx": "x" }, "tiny");
    const result = await ensureAsrModel("sense-voice", {
      fetchFn: fetchOkWith(tarball),
      env,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("suspiciously small");
    expect(fs.readdirSync(path.join(tmpRoot, "sherpa-speech")).toSorted()).toEqual([]);
  });

  it("prepends the download mirror when configured", async () => {
    const tarball = makeTarball(
      { "model.int8.onnx": "weights", "tokens.txt": "a" },
      "sherpa-onnx-sense-voice-int8",
    );
    const seenUrls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      seenUrls.push(String(input));
      return new Response(tarball as unknown as BodyInit, { status: 200 });
    }) as unknown as typeof fetch;
    const result = await ensureAsrModel("sense-voice", {
      fetchFn,
      env: { ...env, SHERPA_ONNX_DOWNLOAD_MIRROR: "https://gh-proxy.example/" },
      skipSizeSanityCheck: true,
    });
    expect(result.ok, `download error: ${result.error}`).toBe(true);
    expect(seenUrls[0]?.startsWith("https://gh-proxy.example/https://github.com/")).toBe(true);
  });
});
