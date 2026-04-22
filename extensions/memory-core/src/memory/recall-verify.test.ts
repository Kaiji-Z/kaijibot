import { describe, expect, it } from "vitest";
import {
  type FileReader,
  type VerifiableResult,
  verifySearchResults,
} from "./recall-verify.js";

function createMockReader(files: Map<string, string>): FileReader {
  return {
    readFile: async (relPath: string) => files.get(relPath) ?? null,
  };
}

function makeResult(overrides: Partial<VerifiableResult> = {}): VerifiableResult {
  return {
    path: "notes.md",
    startLine: 3,
    endLine: 5,
    snippet: "hello world\nline three\nline four",
    score: 0.9,
    ...overrides,
  };
}

const FILE_CONTENT = [
  "line 0",
  "line 1",
  "hello world",
  "line three",
  "line four",
  "line 5",
  "line 6",
  "line 7",
  "line 8",
  "line 9",
  "line 10",
  "line 11",
  "line 12",
].join("\n");

describe("verifySearchResults", () => {
  it("marks results as verified when snippet is at correct lines", async () => {
    const files = new Map([["notes.md", FILE_CONTENT]]);
    const reader = createMockReader(files);
    const results = [makeResult()];

    const verified = await verifySearchResults(results, reader, { enabled: true });

    expect(verified).toHaveLength(1);
    expect(verified[0].verified).toBe(true);
    expect(verified[0].actualStartLine).toBeUndefined();
    expect(verified[0].actualEndLine).toBeUndefined();
  });

  it("finds snippet shifted 3 lines down and returns corrected lines", async () => {
    const shifted = [
      "line 0",
      "line 1",
      "INSERTED",
      "INSERTED",
      "INSERTED",
      "hello world",
      "line three",
      "line four",
      "trailing",
    ].join("\n");
    const files = new Map([["notes.md", shifted]]);
    const reader = createMockReader(files);
    const results = [makeResult({ startLine: 3, endLine: 5 })];

    const verified = await verifySearchResults(results, reader, {
      enabled: true,
      fuzzyWindow: 10,
    });

    expect(verified[0].verified).toBe(true);
    expect(verified[0].actualStartLine).toBe(6);
    expect(verified[0].actualEndLine).toBe(8);
  });

  it("finds snippet shifted 3 lines up and returns corrected lines", async () => {
    const content = [
      "line 0",
      "hello world",
      "line three",
      "line four",
      "REMOVED",
      "REMOVED",
      "REMOVED",
      "line 7",
    ].join("\n");
    const files = new Map([["notes.md", content]]);
    const reader = createMockReader(files);
    const results = [makeResult({ startLine: 5, endLine: 7 })];

    const verified = await verifySearchResults(results, reader, {
      enabled: true,
      fuzzyWindow: 10,
    });

    expect(verified[0].verified).toBe(true);
    expect(verified[0].actualStartLine).toBe(2);
    expect(verified[0].actualEndLine).toBe(4);
  });

  it("returns verified false when file is deleted", async () => {
    const files = new Map<string, string>();
    const reader = createMockReader(files);
    const results = [makeResult()];

    const verified = await verifySearchResults(results, reader, { enabled: true });

    expect(verified[0].verified).toBe(false);
  });

  it("returns verified false when snippet content has completely changed", async () => {
    const changed = [
      "line 0",
      "line 1",
      "completely different",
      "content here now",
      "nothing matches",
    ].join("\n");
    const files = new Map([["notes.md", changed]]);
    const reader = createMockReader(files);
    const results = [makeResult({ startLine: 3, endLine: 5, snippet: "hello world\nline three\nline four" })];

    const verified = await verifySearchResults(results, reader, { enabled: true });

    expect(verified[0].verified).toBe(false);
  });

  it("returns empty array for empty input", async () => {
    const reader = createMockReader(new Map());

    const verified = await verifySearchResults([], reader, { enabled: true });

    expect(verified).toHaveLength(0);
  });

  it("verifies a single result correctly", async () => {
    const files = new Map([["notes.md", FILE_CONTENT]]);
    const reader = createMockReader(files);
    const results = [
      makeResult({
        path: "notes.md",
        startLine: 3,
        endLine: 5,
        snippet: "hello world\nline three\nline four",
        score: 1.0,
        extra: "data",
      }),
    ];

    const verified = await verifySearchResults(results, reader, { enabled: true });

    expect(verified).toHaveLength(1);
    expect(verified[0].verified).toBe(true);
    expect(verified[0].score).toBe(1.0);
    expect((verified[0] as unknown as VerifiableResult & { extra: string }).extra).toBe("data");
  });

  it("trusts all results when enabled is false (default)", async () => {
    const files = new Map<string, string>();
    const reader = createMockReader(files);
    const results = [makeResult()];

    const verified = await verifySearchResults(results, reader);

    expect(verified[0].verified).toBe(true);
  });

  it("trusts all results when explicitly disabled", async () => {
    const files = new Map<string, string>();
    const reader = createMockReader(files);
    const results = [makeResult()];

    const verified = await verifySearchResults(results, reader, { enabled: false });

    expect(verified[0].verified).toBe(true);
  });

  it("respects custom fuzzyWindow", async () => {
    const farShift = [
      "line 0",
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
      "line 6",
      "line 7",
      "hello world",
      "line three",
      "line four",
    ].join("\n");
    const files = new Map([["notes.md", farShift]]);
    const reader = createMockReader(files);
    const results = [makeResult({ startLine: 3, endLine: 5 })];

    const smallWindow = await verifySearchResults(results, reader, {
      enabled: true,
      fuzzyWindow: 3,
    });
    expect(smallWindow[0].verified).toBe(false);

    const largeWindow = await verifySearchResults(results, reader, {
      enabled: true,
      fuzzyWindow: 10,
    });
    expect(largeWindow[0].verified).toBe(true);
    expect(largeWindow[0].actualStartLine).toBe(9);
    expect(largeWindow[0].actualEndLine).toBe(11);
  });

  it("normalizes whitespace so differences do not cause false negatives", async () => {
    const spaced = [
      "line 0",
      "line 1",
      "hello   world",
      "line   three",
      "line four",
    ].join("\n");
    const files = new Map([["notes.md", spaced]]);
    const reader = createMockReader(files);
    const results = [makeResult({
      startLine: 3,
      endLine: 5,
      snippet: "hello world\nline three\nline four",
    })];

    const verified = await verifySearchResults(results, reader, { enabled: true });

    expect(verified[0].verified).toBe(true);
  });

  it("preserves extra fields from the original result", async () => {
    const files = new Map([["notes.md", FILE_CONTENT]]);
    const reader = createMockReader(files);

    const extended = makeResult();
    (extended as VerifiableResult & { source: string }).source = "vector";
    (extended as VerifiableResult & { tags: string[] }).tags = ["ai", "ml"];

    const verified = await verifySearchResults([extended], reader, { enabled: true });

    expect(verified[0].verified).toBe(true);
    expect((verified[0] as unknown as VerifiableResult & { source: string }).source).toBe("vector");
    expect((verified[0] as unknown as VerifiableResult & { tags: string[] }).tags).toEqual(["ai", "ml"]);
  });
});
