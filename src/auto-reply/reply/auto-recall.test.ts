import { describe, expect, it, vi } from "vitest";
import type { PersonaTree } from "../../cognitive/types.js";
import type { MemorySearchResult } from "../../memory-host-sdk/host/types.js";
import type { KaijiBotConfig } from "../../config/config.js";
import { buildAutoRecallContext } from "./auto-recall.js";

function makePersona(recentFocus: string[]): PersonaTree {
  return {
    identity: {
      coreTraits: {},
      expertDomains: [],
      interestDomains: [],
      curiosityDomains: [],
    },
    domains: {},
    recentFocus,
    feedbackProfile: {
      topicBandits: {},
      optimalFrequencyHours: 4,
      lastProactiveAt: 0,
      recentInsightIds: [],
      recentInsightContents: [],
      recentInsightDomains: [],
      recentInsightTypes: [],
    },
    rapport: {
      trustScore: 0.1,
      totalExchanges: 0,
      avgResponseLength: 0,
      selfDisclosureLevel: 0,
    },
    domainBlacklist: [],
    lifecycle: {
      stage: "new",
      lastActiveAt: 0,
      lastStageTransitionAt: 0,
      totalActiveDays: 0,
    },
    calibrationHistory: [],
    moodHistory: [],
  };
}

function makeSearchResult(overrides: Partial<MemorySearchResult> = {}): MemorySearchResult {
  return {
    path: "memory/project.md",
    startLine: 1,
    endLine: 10,
    score: 0.85,
    snippet: "Discussed architecture patterns for microservices.",
    source: "memory",
    ...overrides,
  };
}

const stubCfg = {} as KaijiBotConfig;

describe("buildAutoRecallContext", () => {
  it("returns formatted context when persona has recentFocus with 3 topics", async () => {
    const persona = makePersona(["Rust", "eBPF", "distributed tracing"]);
    const searchResults = [
      makeSearchResult({ snippet: "Rust info 1", path: "memory/rust.md" }),
      makeSearchResult({ snippet: "Rust info 2", path: "memory/rust2.md" }),
    ];
    const queries: string[] = [];
    const searchMemory = vi.fn(async (query: string) => {
      queries.push(query);
      return searchResults;
    });

    const result = await buildAutoRecallContext(
      { cfg: stubCfg, agentId: "main", persona },
      { searchMemory },
    );

    expect(result).toContain("## Recalled Context");
    expect(result).toContain("### Rust");
    expect(result).toContain("### eBPF");
    expect(result).toContain("### distributed tracing");
    expect(result).toContain("Rust info 1");
    expect(result).toContain("Source: memory/rust.md");
    expect(result).toMatch(/---$/m);
    expect(queries).toEqual(["Rust", "eBPF", "distributed tracing"]);
    expect(searchMemory).toHaveBeenCalledTimes(3);
  });

  it("returns empty string when persona has empty recentFocus", async () => {
    const persona = makePersona([]);
    const searchMemory = vi.fn(async () => []);

    const result = await buildAutoRecallContext(
      { cfg: stubCfg, agentId: "main", persona },
      { searchMemory },
    );

    expect(result).toBe("");
    expect(searchMemory).not.toHaveBeenCalled();
  });

  it("returns empty string when persona is undefined", async () => {
    const searchMemory = vi.fn(async () => []);

    const result = await buildAutoRecallContext(
      { cfg: stubCfg, agentId: "main", persona: undefined },
      { searchMemory },
    );

    expect(result).toBe("");
    expect(searchMemory).not.toHaveBeenCalled();
  });

  it("skips topic on search failure and continues with others", async () => {
    const persona = makePersona(["Rust", "eBPF", "distributed tracing"]);
    const searchMemory = vi.fn(async (query: string) => {
      if (query === "eBPF") throw new Error("search backend error");
      return [makeSearchResult({ snippet: `${query} result`, path: `memory/${query}.md` })];
    });

    const result = await buildAutoRecallContext(
      { cfg: stubCfg, agentId: "main", persona },
      { searchMemory },
    );

    expect(result).toContain("### Rust");
    expect(result).not.toContain("### eBPF");
    expect(result).toContain("### distributed tracing");
    expect(searchMemory).toHaveBeenCalledTimes(3);
  });

  it("limits queries to maxTopics even when recentFocus has more", async () => {
    const persona = makePersona(["A", "B", "C", "D", "E"]);
    const queries: string[] = [];
    const searchMemory = vi.fn(async (query: string) => {
      queries.push(query);
      return [makeSearchResult({ snippet: `${query} result` })];
    });

    const result = await buildAutoRecallContext(
      { cfg: stubCfg, agentId: "main", persona, maxTopics: 3 },
      { searchMemory },
    );

    expect(queries).toEqual(["A", "B", "C"]);
    expect(result).toContain("### A");
    expect(result).toContain("### B");
    expect(result).toContain("### C");
    expect(result).not.toContain("### D");
    expect(result).not.toContain("### E");
  });

  it("produces output matching expected structure", async () => {
    const persona = makePersona(["Rust"]);
    const searchMemory = vi.fn(async () => [
      makeSearchResult({
        snippet: "Rust ownership model discussion",
        path: "memory/rust-basics.md",
        startLine: 5,
        endLine: 12,
        score: 0.92,
      }),
    ]);

    const result = await buildAutoRecallContext(
      { cfg: stubCfg, agentId: "main", persona },
      { searchMemory },
    );

    expect(result).toMatch(/^## Recalled Context\n/);
    expect(result).toContain("### Rust\n");
    expect(result).toContain("Rust ownership model discussion");
    expect(result).toContain("Source: memory/rust-basics.md:5-12");
    expect(result).toMatch(/\n---$/);
  });

  it("truncates output when exceeding maxChars", async () => {
    const persona = makePersona(["topic-a"]);
    const longSnippet = "x".repeat(5000);
    const searchMemory = vi.fn(async () => [
      makeSearchResult({ snippet: longSnippet, path: "memory/big.md" }),
    ]);

    const result = await buildAutoRecallContext(
      { cfg: stubCfg, agentId: "main", persona, maxChars: 500 },
      { searchMemory },
    );

    expect(result.length).toBeLessThanOrEqual(500);
    expect(result).toMatch(/^## Recalled Context\n/);
    expect(result).toMatch(/\n---$/);
  });

  it("uses injected loadPersona when provided", async () => {
    const searchMemory = vi.fn(async () => [
      makeSearchResult({ snippet: "test result" }),
    ]);
    const loadedPersona = makePersona(["injected-topic"]);
    const loadPersona = vi.fn(async () => loadedPersona);

    const result = await buildAutoRecallContext(
      { cfg: stubCfg, agentId: "main", persona: undefined },
      { searchMemory, loadPersona },
    );

    expect(loadPersona).toHaveBeenCalledTimes(1);
    expect(result).toContain("### injected-topic");
  });

  it("returns empty string when all topics yield no results", async () => {
    const persona = makePersona(["obscure-topic"]);
    const searchMemory = vi.fn(async () => []);

    const result = await buildAutoRecallContext(
      { cfg: stubCfg, agentId: "main", persona },
      { searchMemory },
    );

    expect(result).toBe("");
  });
});
