import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { MemoryIndexManager } = await import("./manager.js");

type MemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: "memory" | "sessions";
  citation?: string;
};

describe("applyVerification (post-search verification hook)", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tmpDirs.map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }),
    );
    tmpDirs.length = 0;
  });

  async function createTmpDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-verify-test-"));
    tmpDirs.push(dir);
    return dir;
  }

  async function createWorkspaceWithFiles(
    files: Map<string, string>,
  ): Promise<string> {
    const dir = await createTmpDir();
    for (const [relPath, content] of files) {
      const fullPath = path.join(dir, relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
    }
    return dir;
  }

  function makeResults(
    overrides: Partial<MemorySearchResult>[] = [],
  ): MemorySearchResult[] {
    return overrides.map((o) => ({
      path: o.path ?? "notes.md",
      startLine: o.startLine ?? 1,
      endLine: o.endLine ?? 1,
      score: o.score ?? 0.9,
      snippet: o.snippet ?? "hello world",
      source: (o.source ?? "memory") as "memory" | "sessions",
      citation: o.citation,
    }));
  }

  async function callApplyVerification(params: {
    workspaceFiles: Map<string, string>;
    results: MemorySearchResult[];
    verifyConfig?: Partial<{ enabled: boolean; fuzzyWindow: number }>;
  }): Promise<MemorySearchResult[]> {
    const workspaceDir = await createWorkspaceWithFiles(params.workspaceFiles);
    const verify = params.verifyConfig ?? {};

    type ManagerLike = {
      workspaceDir: string;
      settings: { query: { verify?: Partial<{ enabled: boolean; fuzzyWindow: number }> } };
    };
    const manager: ManagerLike = {
      workspaceDir,
      settings: {
        query: { verify },
      },
    };

    const method = (
      MemoryIndexManager.prototype as unknown as Record<string, unknown>
    ).applyVerification as (
      this: ManagerLike,
      results: MemorySearchResult[],
    ) => Promise<MemorySearchResult[]>;

    return await method.call(manager, params.results);
  }

  it("passes all results through when verification is disabled (default)", async () => {
    const results = makeResults([
      { path: "a.md", snippet: "alpha" },
      { path: "b.md", snippet: "beta" },
    ]);
    const output = await callApplyVerification({
      workspaceFiles: new Map(),
      results,
      verifyConfig: { enabled: false },
    });
    expect(output).toEqual(results);
  });

  it("passes all results through when no verify config is set", async () => {
    const results = makeResults([{ path: "a.md", snippet: "alpha" }]);
    const output = await callApplyVerification({
      workspaceFiles: new Map(),
      results,
    });
    expect(output).toEqual(results);
  });

  it("keeps results that match the file content at the claimed lines", async () => {
    const content = ["header", "hello world", "footer"].join("\n");
    const results = makeResults([
      { path: "notes.md", startLine: 2, endLine: 2, snippet: "hello world" },
    ]);
    const output = await callApplyVerification({
      workspaceFiles: new Map([["notes.md", content]]),
      results,
      verifyConfig: { enabled: true },
    });
    expect(output).toHaveLength(1);
    expect(output[0].path).toBe("notes.md");
    expect(output[0].startLine).toBe(2);
    expect(output[0].endLine).toBe(2);
  });

  it("filters out results when the file has been deleted", async () => {
    const results = makeResults([
      { path: "gone.md", startLine: 1, endLine: 1, snippet: "vanished" },
    ]);
    const output = await callApplyVerification({
      workspaceFiles: new Map(),
      results,
      verifyConfig: { enabled: true },
    });
    expect(output).toHaveLength(0);
  });

  it("corrects line numbers when snippet shifted down", async () => {
    const content = [
      "line 0",
      "INSERTED A",
      "INSERTED B",
      "INSERTED C",
      "hello world",
      "line three",
      "line four",
      "trailing",
    ].join("\n");
    const results = makeResults([
      {
        path: "notes.md",
        startLine: 2,
        endLine: 4,
        snippet: "hello world\nline three\nline four",
      },
    ]);
    const output = await callApplyVerification({
      workspaceFiles: new Map([["notes.md", content]]),
      results,
      verifyConfig: { enabled: true, fuzzyWindow: 10 },
    });
    expect(output).toHaveLength(1);
    expect(output[0].startLine).toBe(5);
    expect(output[0].endLine).toBe(7);
  });

  it("filters mixed results: keeps valid, removes stale", async () => {
    const validContent = ["hello world"].join("\n");
    const results = makeResults([
      { path: "exists.md", startLine: 1, endLine: 1, snippet: "hello world" },
      { path: "deleted.md", startLine: 1, endLine: 1, snippet: "gone" },
    ]);
    const output = await callApplyVerification({
      workspaceFiles: new Map([["exists.md", validContent]]),
      results,
      verifyConfig: { enabled: true },
    });
    expect(output).toHaveLength(1);
    expect(output[0].path).toBe("exists.md");
  });
});
