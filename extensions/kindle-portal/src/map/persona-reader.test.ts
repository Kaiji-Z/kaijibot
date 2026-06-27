import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Wrap mutation-prone fs/promises functions with pass-through spies so we can
 * assert `readPersona` never calls them. The spies forward to the real impl
 * so fixture setup (writeFile/mkdir in beforeEach) still works.
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
import { readPersona } from "./persona-reader.js";

/** Reset all mutation spies between tests. */
function clearMutationSpies() {
  vi.mocked(fs.writeFile).mockClear();
  vi.mocked(fs.mkdir).mockClear();
  vi.mocked(fs.unlink).mockClear();
  vi.mocked(fs.rename).mockClear();
  vi.mocked(fs.cp).mockClear();
}

describe("readPersona", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "kindle-persona-"));
    clearMutationSpies();
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  async function writePersona(
    agentId: string,
    userId: string,
    content: string,
  ): Promise<string> {
    const dir = join(tmp, "cognitive", "persona", agentId);
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${userId}.json`);
    await writeFile(file, content, "utf-8");
    // Discard the calls the fixture itself made so each test starts clean.
    clearMutationSpies();
    return file;
  }

  it("reads valid persona with 3 domains", async () => {
    await writePersona("agent-a", "ou_1", JSON.stringify({
      identity: { displayName: "Kaiji" },
      coreTraits: { 称呼: "Kaiji" },
      domains: {
        rust: { phase: "stable", depth: 3, recurrence: 5 },
        distributed: { phase: "emergent", depth: 1, recurrence: 2 },
        ml: { phase: "dormant", depth: 0, recurrence: 0 },
      },
    }));
    const tree = await readPersona(tmp, "agent-a", "ou_1");
    expect(tree).not.toBeNull();
    expect(Object.keys(tree!.domains)).toHaveLength(3);
    expect(tree!.domains.rust).toBeDefined();
    expect(tree!.domains.distributed).toBeDefined();
    expect(tree!.domains.ml).toBeDefined();
  });

  it("preserves identity.displayName", async () => {
    await writePersona("agent-a", "ou_1", JSON.stringify({
      identity: { displayName: "Kaiji" },
      domains: { x: { phase: "stable" } },
    }));
    const tree = await readPersona(tmp, "agent-a", "ou_1");
    expect(tree?.identity?.displayName).toBe("Kaiji");
  });

  it("missing file returns null", async () => {
    // No file written for this user
    const tree = await readPersona(tmp, "agent-a", "ou_nonexistent");
    expect(tree).toBeNull();
  });

  it("invalid JSON returns null", async () => {
    await writePersona("agent-a", "ou_1", "{ not valid json");
    const tree = await readPersona(tmp, "agent-a", "ou_1");
    expect(tree).toBeNull();
  });

  it("non-object JSON returns null", async () => {
    await writePersona("agent-a", "ou_1", "42");
    const tree = await readPersona(tmp, "agent-a", "ou_1");
    expect(tree).toBeNull();
  });

  it("object without domains returns null", async () => {
    await writePersona("agent-a", "ou_1", JSON.stringify({ foo: "bar" }));
    const tree = await readPersona(tmp, "agent-a", "ou_1");
    expect(tree).toBeNull();
  });

  it("tolerates extra fields", async () => {
    await writePersona("agent-a", "ou_1", JSON.stringify({
      identity: { displayName: "K", extra: "ignored" },
      domains: { x: { phase: "stable", unknownField: 123 } },
      extraTopLevel: { foo: 1 },
    }));
    const tree = await readPersona(tmp, "agent-a", "ou_1");
    expect(tree).not.toBeNull();
    expect(tree!.domains.x).toBeDefined();
    // Extra fields tolerated (cast carefully)
    expect(
      (tree!.domains.x as unknown as { unknownField: number }).unknownField,
    ).toBe(123);
  });

  it("NEVER writes: spies on fs.promises.writeFile/mkdir/unlink/rename", async () => {
    await writePersona("agent-a", "ou_1", JSON.stringify({
      identity: { displayName: "K" },
      domains: { x: { phase: "stable" } },
    }));
    // Sanity check: read succeeds
    const tree = await readPersona(tmp, "agent-a", "ou_1");
    expect(tree).not.toBeNull();

    // Assert none of the mutation entrypoints were touched by readPersona.
    expect(fs.writeFile).toHaveBeenCalledTimes(0);
    expect(fs.mkdir).toHaveBeenCalledTimes(0);
    expect(fs.unlink).toHaveBeenCalledTimes(0);
    expect(fs.rename).toHaveBeenCalledTimes(0);
    expect(fs.cp).toHaveBeenCalledTimes(0);
  });
});
