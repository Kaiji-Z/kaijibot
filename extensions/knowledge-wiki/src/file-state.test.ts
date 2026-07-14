import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeContentHash,
  isFileChanged,
  loadFileState,
  removeStaleEntries,
  saveFileState,
  updateEntry,
} from "./file-state.js";
import type { FileStateEntry, FileStateMap } from "./types.js";

describe("computeContentHash", () => {
  it("returns a consistent SHA-256 hex string (same content -> same hash)", () => {
    const a = computeContentHash("hello world");
    const b = computeContentHash("hello world");

    expect(a).toBe(b);
    // SHA-256 hex digest is 64 lowercase hex characters.
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns different hashes for different content", () => {
    const a = computeContentHash("hello");
    const b = computeContentHash("world");

    expect(a).not.toBe(b);
  });
});

describe("loadFileState", () => {
  it("returns an empty Map for a non-existent state file", async () => {
    const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "fs-empty-"));

    try {
      const state = await loadFileState(vaultRoot);

      expect(state).toBeInstanceOf(Map);
      expect(state.size).toBe(0);
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });
});

describe("saveFileState / loadFileState round-trip", () => {
  let vaultRoot: string;

  beforeEach(async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "fs-roundtrip-"));
  });

  afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  });

  it("round-trips entries through saveFileState -> loadFileState", async () => {
    const original = new Map<string, FileStateEntry>();
    updateEntry(original, "notes/a.md", "hash-a", ["page.a"]);
    updateEntry(original, "notes/b.md", "hash-b", ["page.b1", "page.b2"]);

    await saveFileState(vaultRoot, original);
    const loaded = await loadFileState(vaultRoot);

    expect(loaded.size).toBe(2);
    const entryA = loaded.get("notes/a.md");
    const entryB = loaded.get("notes/b.md");
    expect(entryA?.hash).toBe("hash-a");
    expect(entryA?.pageIds).toEqual(["page.a"]);
    expect(entryB?.hash).toBe("hash-b");
    expect(entryB?.pageIds).toEqual(["page.b1", "page.b2"]);
    // lastIngestedAt is an ISO timestamp string and survives the round trip.
    expect(typeof entryA?.lastIngestedAt).toBe("string");
    expect(entryA?.lastIngestedAt).toBe(original.get("notes/a.md")?.lastIngestedAt);
  });

  it("writes the state file under .kaijibot-wiki/file-state.json", async () => {
    const state = new Map<string, FileStateEntry>();
    updateEntry(state, "x.md", "h", ["p"]);

    await saveFileState(vaultRoot, state);

    const stateFile = path.join(vaultRoot, ".kaijibot-wiki", "file-state.json");
    await expect(fs.access(stateFile)).resolves.toBeUndefined();
  });
});

describe("isFileChanged", () => {
  it("returns true for new files not present in the state map", () => {
    const state: FileStateMap = new Map();

    expect(isFileChanged(state, "new.md", "any-hash")).toBe(true);
  });

  it("returns false for an unchanged hash", () => {
    const state = new Map<string, FileStateEntry>([
      [
        "kept.md",
        { path: "kept.md", hash: "abc", lastIngestedAt: "2025-01-01T00:00:00.000Z", pageIds: [] },
      ],
    ]);

    expect(isFileChanged(state, "kept.md", "abc")).toBe(false);
  });

  it("returns true for a changed hash", () => {
    const state = new Map<string, FileStateEntry>([
      [
        "changed.md",
        {
          path: "changed.md",
          hash: "old",
          lastIngestedAt: "2025-01-01T00:00:00.000Z",
          pageIds: [],
        },
      ],
    ]);

    expect(isFileChanged(state, "changed.md", "new")).toBe(true);
  });
});

describe("updateEntry", () => {
  it("adds entries to the map", () => {
    const state = new Map<string, FileStateEntry>();

    updateEntry(state, "doc.md", "hash-1", ["page-1"]);

    expect(state.size).toBe(1);
    const entry = state.get("doc.md");
    expect(entry?.hash).toBe("hash-1");
    expect(entry?.pageIds).toEqual(["page-1"]);
    expect(entry?.lastIngestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("overwrites existing entries", () => {
    const state = new Map<string, FileStateEntry>();
    updateEntry(state, "doc.md", "hash-old", ["page-old"]);

    updateEntry(state, "doc.md", "hash-new", ["page-new"]);

    expect(state.size).toBe(1);
    const entry = state.get("doc.md");
    expect(entry?.hash).toBe("hash-new");
    expect(entry?.pageIds).toEqual(["page-new"]);
  });
});

describe("removeStaleEntries", () => {
  it("removes entries not in the validPaths set and returns the count", () => {
    const state = new Map<string, FileStateEntry>();
    updateEntry(state, "a.md", "h-a", []);
    updateEntry(state, "b.md", "h-b", []);
    updateEntry(state, "c.md", "h-c", []);

    const removed = removeStaleEntries(state, new Set(["a.md", "c.md"]));

    expect(removed).toBe(1);
    expect([...state.keys()].toSorted()).toEqual(["a.md", "c.md"]);
  });

  it("removes nothing when all entries are valid", () => {
    const state = new Map<string, FileStateEntry>();
    updateEntry(state, "a.md", "h-a", []);
    updateEntry(state, "b.md", "h-b", []);

    const removed = removeStaleEntries(state, new Set(["a.md", "b.md"]));

    expect(removed).toBe(0);
    expect(state.size).toBe(2);
  });

  it("removes everything when validPaths is empty", () => {
    const state = new Map<string, FileStateEntry>();
    updateEntry(state, "a.md", "h-a", []);
    updateEntry(state, "b.md", "h-b", []);

    const removed = removeStaleEntries(state, new Set());

    expect(removed).toBe(2);
    expect(state.size).toBe(0);
  });
});
