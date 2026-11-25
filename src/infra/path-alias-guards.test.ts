import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSuiteTempRootTracker } from "../test-helpers/temp-dir.js";
import { assertNoPathAliasEscape } from "./path-alias-guards.js";

// The root must sit on a real (non-symlinked) path, so it is created under the repo rather
// than os.tmpdir(). withTempDir() never removes the mkdtemp prefix root it caches, which
// left an empty kaijibot-path-alias-* directory in the repo root on every run; the suite
// tracker removes the root in afterAll instead.
const aliasRootTracker = createSuiteTempRootTracker({
  prefix: "kaijibot-path-alias-",
  parentDir: process.cwd(),
});

async function withAliasRoot(cb: (root: string) => Promise<void>): Promise<void> {
  const base = await aliasRootTracker.make("case");
  const root = path.join(base, "root");
  await fs.mkdir(root, { recursive: true });
  try {
    await cb(root);
  } finally {
    await fs.rm(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 });
  }
}

let suiteRoot = "";

beforeAll(async () => {
  suiteRoot = await aliasRootTracker.setup();
});

afterAll(async () => {
  await aliasRootTracker.cleanup();
  // Fail-closed: the root lives in the repo working tree, so a leftover would dirty it.
  await expect(fs.stat(suiteRoot)).rejects.toMatchObject({ code: "ENOENT" });
});

describe("assertNoPathAliasEscape", () => {
  it.runIf(process.platform !== "win32").each([
    {
      name: "rejects broken final symlink targets outside root",
      setup: async (root: string) => {
        const outside = path.join(path.dirname(root), "outside");
        await fs.mkdir(outside, { recursive: true });
        const linkPath = path.join(root, "jump");
        await fs.symlink(path.join(outside, "owned.txt"), linkPath);
        return linkPath;
      },
      rejects: true,
    },
    {
      name: "allows broken final symlink targets that remain inside root",
      setup: async (root: string) => {
        const linkPath = path.join(root, "jump");
        await fs.symlink(path.join(root, "missing", "owned.txt"), linkPath);
        return linkPath;
      },
      rejects: false,
    },
    {
      name: "rejects broken targets that traverse via an in-root symlink alias",
      setup: async (root: string) => {
        const outside = path.join(path.dirname(root), "outside");
        await fs.mkdir(outside, { recursive: true });
        await fs.symlink(outside, path.join(root, "hop"));
        const linkPath = path.join(root, "jump");
        await fs.symlink(path.join("hop", "missing", "owned.txt"), linkPath);
        return linkPath;
      },
      rejects: true,
    },
  ])("$name", async ({ setup, rejects }) => {
    await withAliasRoot(async (root) => {
      const absolutePath = await setup(root);
      const promise = assertNoPathAliasEscape({
        absolutePath,
        rootPath: root,
        boundaryLabel: "sandbox root",
      });
      if (rejects) {
        await expect(promise).rejects.toThrow(/Symlink escapes sandbox root/);
        return;
      }
      await expect(promise).resolves.toBeUndefined();
    });
  });
});
