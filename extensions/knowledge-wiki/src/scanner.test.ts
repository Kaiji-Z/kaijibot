import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WikiConfig } from "./config.js";
import { readFileContent, scanWorkspace } from "./scanner.js";

function makeConfig(overrides?: Partial<WikiConfig["scan"]>): WikiConfig {
  return {
    enabled: true,
    cron: "0 */6 * * *",
    vault: { path: path.join(os.tmpdir(), "scanner-test-vault") },
    scan: {
      // Minimal scan config: only the hardcoded exclusions in scanner.ts apply.
      extensions: [".md"],
      excludeDirs: [],
      excludePatterns: [],
      maxFileSize: 1_048_576,
      includeMemoryCurated: true,
      ...overrides,
    },
    extraction: {
      minConfidence: 0.5,
      maxClaimsPerPage: 20,
    },
  };
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const full = path.join(root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

function relativePaths(files: readonly { relativePath: string }[]): string[] {
  return files.map((file) => file.relativePath);
}

describe("scanWorkspace", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scanner-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("finds .md files in workspace root", async () => {
    await writeFile(tmpDir, "alpha.md", "# Alpha");
    await writeFile(tmpDir, "beta.md", "# Beta");

    const result = await scanWorkspace(tmpDir, makeConfig());

    expect(relativePaths(result.files).toSorted()).toEqual(["alpha.md", "beta.md"]);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("finds .md files in subdirectories (recursive)", async () => {
    await writeFile(tmpDir, "root.md", "# Root");
    await writeFile(tmpDir, "docs/intro.md", "# Intro");
    await writeFile(tmpDir, "docs/nested/deep.md", "# Deep");

    const result = await scanWorkspace(tmpDir, makeConfig());

    expect(relativePaths(result.files).toSorted()).toEqual([
      "docs/intro.md",
      "docs/nested/deep.md",
      "root.md",
    ]);
  });

  it("excludes hardcoded dirs (.git, node_modules, wiki, sessions)", async () => {
    await writeFile(tmpDir, "keep.md", "# Keep");
    await writeFile(tmpDir, ".git/config.md", "# git");
    await writeFile(tmpDir, "node_modules/lib.md", "# nm");
    await writeFile(tmpDir, "wiki/compiled.md", "# wiki");
    await writeFile(tmpDir, "sessions/abc.md", "# sessions");

    const result = await scanWorkspace(tmpDir, makeConfig());

    expect(relativePaths(result.files)).toEqual(["keep.md"]);
  });

  it("excludes memory daily notes (memory/YYYY-MM-DD.md pattern)", async () => {
    await writeFile(tmpDir, "memory/2026-06-19.md", "# daily log");
    await writeFile(tmpDir, "memory/notes.md", "# kept notes");

    const result = await scanWorkspace(tmpDir, makeConfig());

    expect(relativePaths(result.files)).toEqual(["memory/notes.md"]);
    expect(result.skipped).toBe(1);
  });

  it("excludes memory/dialogues/ directory", async () => {
    await writeFile(tmpDir, "memory/dialogues/chat1.md", "# dialogue");
    await writeFile(tmpDir, "memory/kept.md", "# kept");

    const result = await scanWorkspace(tmpDir, makeConfig());

    expect(relativePaths(result.files)).toEqual(["memory/kept.md"]);
    // The whole directory is pruned before files are enumerated, so it does
    // not count toward `skipped`.
    expect(result.skipped).toBe(0);
  });

  it("includes memory/topics/*.md when includeMemoryCurated=true", async () => {
    await writeFile(tmpDir, "memory/topics/arch.md", "# Architecture");
    await writeFile(tmpDir, "memory/topics/rust.md", "# Rust");

    const result = await scanWorkspace(tmpDir, makeConfig({ includeMemoryCurated: true }));

    expect(relativePaths(result.files).toSorted()).toEqual([
      "memory/topics/arch.md",
      "memory/topics/rust.md",
    ]);
  });

  it("excludes memory/topics/*.md when includeMemoryCurated=false", async () => {
    await writeFile(tmpDir, "memory/topics/arch.md", "# Architecture");
    await writeFile(tmpDir, "memory/keep.md", "# keep");

    const result = await scanWorkspace(tmpDir, makeConfig({ includeMemoryCurated: false }));

    expect(relativePaths(result.files)).toEqual(["memory/keep.md"]);
    expect(result.skipped).toBe(1);
  });

  it("excludes non-whitelisted extensions (.json, .png, .py)", async () => {
    await writeFile(tmpDir, "data.json", "{}");
    await writeFile(tmpDir, "img.png", "png");
    await writeFile(tmpDir, "script.py", "print('hi')");
    await writeFile(tmpDir, "readme.md", "# Readme");

    const result = await scanWorkspace(tmpDir, makeConfig());

    expect(relativePaths(result.files)).toEqual(["readme.md"]);
    expect(result.skipped).toBe(3);
  });

  it("excludes files larger than maxFileSize", async () => {
    // maxFileSize is 100 bytes; write a 200-byte markdown file.
    const big = "# " + "x".repeat(200);
    await writeFile(tmpDir, "big.md", big);
    await writeFile(tmpDir, "small.md", "# small");

    const result = await scanWorkspace(tmpDir, makeConfig({ maxFileSize: 100 }));

    expect(relativePaths(result.files)).toEqual(["small.md"]);
    expect(result.skipped).toBe(1);
  });

  it("returns files sorted by relativePath", async () => {
    await writeFile(tmpDir, "zebra.md", "# z");
    await writeFile(tmpDir, "apple.md", "# a");
    await writeFile(tmpDir, "mango.md", "# m");
    await writeFile(tmpDir, "docs/aaa.md", "# aaa");
    await writeFile(tmpDir, "docs/zzz.md", "# zzz");

    const result = await scanWorkspace(tmpDir, makeConfig());

    expect(relativePaths(result.files)).toEqual([
      "apple.md",
      "docs/aaa.md",
      "docs/zzz.md",
      "mango.md",
      "zebra.md",
    ]);
  });

  it("handles non-existent directory gracefully (returns empty)", async () => {
    const missing = path.join(tmpDir, "does-not-exist");

    const result = await scanWorkspace(missing, makeConfig());

    expect(result.files).toHaveLength(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});

describe("readFileContent", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scanner-read-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reads UTF-8 text content", async () => {
    const file = path.join(tmpDir, "note.md");
    await fs.writeFile(file, "# Hello world", "utf8");

    await expect(readFileContent(file)).resolves.toBe("# Hello world");
  });

  it("rejects binary files containing null bytes", async () => {
    const file = path.join(tmpDir, "binary.bin");
    // A buffer with a null byte in the first 8000 bytes.
    await fs.writeFile(file, Buffer.from([0x68, 0x69, 0x00, 0x21]));

    await expect(readFileContent(file)).rejects.toThrow(/Binary file detected/);
  });
});
