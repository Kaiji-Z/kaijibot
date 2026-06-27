import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pass-through spies on fs mutators so we can prove readWikiGraph is
 * read-only. The spies forward to real impl so fixture setup still works.
 */
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    writeFile: vi.fn((...a: Parameters<typeof real.writeFile>) =>
      real.writeFile(...a),
    ),
    mkdir: vi.fn((...a: Parameters<typeof real.mkdir>) => real.mkdir(...a)),
    unlink: vi.fn((...a: Parameters<typeof real.unlink>) => real.unlink(...a)),
    rename: vi.fn((...a: Parameters<typeof real.rename>) => real.rename(...a)),
    cp: vi.fn((...a: Parameters<typeof real.cp>) => real.cp(...a)),
  };
});

const fs = await import("node:fs/promises");
const { mkdtemp, mkdir, rm, writeFile } = fs;
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWikiGraph } from "./wiki-reader.js";

function clearMutationSpies() {
  vi.mocked(fs.writeFile).mockClear();
  vi.mocked(fs.mkdir).mockClear();
  vi.mocked(fs.unlink).mockClear();
  vi.mocked(fs.rename).mockClear();
  vi.mocked(fs.cp).mockClear();
}

describe("readWikiGraph", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "kindle-wiki-"));
    clearMutationSpies();
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  async function writePage(
    subdir: "entities" | "concepts",
    filename: string,
    content: string,
  ): Promise<void> {
    const dir = join(tmp, "wiki", subdir);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), content, "utf-8");
  }

  it("reads entities + concepts", async () => {
    await writePage(
      "entities",
      "rust.md",
      "---\ntitle: Rust\n---\n\nUses [[tokio]] for async.\n",
    );
    await writePage(
      "concepts",
      "cap.md",
      "---\ntitle: CAP Theorem\n---\n\nConsistency, availability, partition tolerance.\n",
    );
    clearMutationSpies();

    const { nodes, edges } = await readWikiGraph(tmp);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ from: "rust", to: "tokio" });

    const kinds = Object.fromEntries(nodes.map((n) => [n.id, n.kind]));
    expect(kinds["rust"]).toBe("entity");
    expect(kinds["cap"]).toBe("concept");
  });

  it("extracts title from YAML frontmatter", async () => {
    await writePage(
      "entities",
      "rust.md",
      "---\npageType: entity\ntitle: Rust Programming\nupdatedAt: 2026-06-01T00:00:00Z\n---\n\nBody.\n",
    );
    clearMutationSpies();

    const { nodes } = await readWikiGraph(tmp);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].label).toBe("Rust Programming");
  });

  it("falls back to filename when title absent", async () => {
    await writePage(
      "entities",
      "rust.md",
      "No frontmatter at all, just body.\n",
    );
    clearMutationSpies();

    const { nodes } = await readWikiGraph(tmp);
    expect(nodes).toHaveLength(1);
    // Filename fallback; capitalization is preserved as label
    expect(nodes[0].label).toBe("rust");
  });

  it("lowercases node ids", async () => {
    await writePage(
      "entities",
      "Rust.md",
      "---\ntitle: Rust\n---\n\nbody\n",
    );
    clearMutationSpies();

    const { nodes } = await readWikiGraph(tmp);
    expect(nodes[0].id).toBe("rust");
  });

  it("dedupes edges (unordered pairs)", async () => {
    await writePage(
      "entities",
      "a.md",
      "---\ntitle: A\n---\n\nLinks to [[b]].\n",
    );
    await writePage(
      "entities",
      "b.md",
      "---\ntitle: B\n---\n\nLinks back to [[a]].\n",
    );
    clearMutationSpies();

    const { edges } = await readWikiGraph(tmp);
    // a→b and b→a collapse into 1 edge (unordered pair dedup)
    expect(edges).toHaveLength(1);
  });

  it("dedupes nodes by id", async () => {
    // Same id present in both entities/ and concepts/ — only one wins.
    await writePage(
      "entities",
      "rust.md",
      "---\ntitle: Rust Entity\n---\n\nbody\n",
    );
    await writePage(
      "concepts",
      "rust.md",
      "---\ntitle: Rust Concept\n---\n\nbody\n",
    );
    clearMutationSpies();

    const { nodes } = await readWikiGraph(tmp);
    expect(nodes).toHaveLength(1);
    // Per spec: entities wins by sort order (entities < concepts).
    expect(nodes[0].kind).toBe("entity");
    expect(nodes[0].label).toBe("Rust Entity");
  });

  it("missing vault returns empty", async () => {
    // No wiki/ directory created in tmp
    clearMutationSpies();
    const result = await readWikiGraph(tmp);
    expect(result).toEqual({ nodes: [], edges: [] });
  });

  it("missing entities dir tolerated", async () => {
    // Only concepts/ exists
    await writePage(
      "concepts",
      "cap.md",
      "---\ntitle: CAP\n---\n\nbody\n",
    );
    clearMutationSpies();

    const { nodes } = await readWikiGraph(tmp);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe("cap");
    expect(nodes[0].kind).toBe("concept");
  });

  it("skips malformed markdown files", async () => {
    // Bad file (binary junk, invalid as utf-8 but we wrote raw bytes)
    const badDir = join(tmp, "wiki", "entities");
    await mkdir(badDir, { recursive: true });
    // Write invalid UTF-8 byte sequence (lone continuation byte)
    await writeFile(join(badDir, "bad.md"), Buffer.from([0xff, 0xfe, 0x00]));
    // Valid file alongside
    await writePage(
      "entities",
      "good.md",
      "---\ntitle: Good\n---\n\nbody [[bad]]\n",
    );
    clearMutationSpies();

    const { nodes } = await readWikiGraph(tmp);
    // good.md still parsed; bad.md skipped (does not throw)
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain("good");
  });

  it("NEVER writes: spies on fs.promises.writeFile/mkdir/unlink/rename", async () => {
    await writePage(
      "entities",
      "rust.md",
      "---\ntitle: Rust\n---\n\n[[tokio]]\n",
    );
    clearMutationSpies();

    const result = await readWikiGraph(tmp);
    expect(result.nodes.length).toBeGreaterThan(0);

    // Assert none of the mutation entrypoints were touched by readWikiGraph.
    expect(fs.writeFile).toHaveBeenCalledTimes(0);
    expect(fs.mkdir).toHaveBeenCalledTimes(0);
    expect(fs.unlink).toHaveBeenCalledTimes(0);
    expect(fs.rename).toHaveBeenCalledTimes(0);
    expect(fs.cp).toHaveBeenCalledTimes(0);
  });
});
