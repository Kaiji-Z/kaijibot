import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtractedItem, RouteItem } from "./consolidation-types.js";
import { routeToStores, type ConsolidationRouteDeps } from "./consolidation-route.js";

function makeRouteItem(overrides: Partial<ExtractedItem> = {}): RouteItem {
  return {
    agentId: "test-agent",
    userId: "test-user",
    item: {
      category: "domain_knowledge",
      content: "User prefers TypeScript for backend",
      confidence: 0.85,
      source: "transcript",
      evidence: "I love TypeScript for backend development",
      ...overrides,
    },
  };
}

function makeMockDeps(): ConsolidationRouteDeps {
  return {
    mergeTypedInsights: vi.fn().mockResolvedValue(1),
    addOrReinforceCorrection: vi.fn().mockResolvedValue("saved"),
    appendToMemoryFile: vi.fn().mockResolvedValue(undefined),
    collectFragment: vi.fn().mockResolvedValue(undefined),
    updateMemoryIndex: vi.fn().mockResolvedValue(undefined),
  };
}

describe("routeToStores", () => {
  let deps: ConsolidationRouteDeps;

  beforeEach(() => {
    deps = makeMockDeps();
  });

  it("returns routed: 0 and empty errors for empty items", async () => {
    const result = await routeToStores({ items: [], workspaceDir: "/tmp/ws", deps });
    expect(result.routed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("routes domain_knowledge items to persona store via mergeTypedInsights", async () => {
    const items = [makeRouteItem({ category: "domain_knowledge" })];
    const result = await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.mergeTypedInsights).toHaveBeenCalledWith(
      "test-agent",
      "test-user",
      expect.arrayContaining([expect.objectContaining({ category: "domain_knowledge" })]),
    );
    expect(result.routed).toBeGreaterThanOrEqual(1);
  });

  it("routes stated_preference items to persona store", async () => {
    const items = [makeRouteItem({ category: "stated_preference" })];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.mergeTypedInsights).toHaveBeenCalledWith(
      "test-agent",
      "test-user",
      expect.arrayContaining([expect.objectContaining({ category: "stated_preference" })]),
    );
  });

  it("routes goal_or_aspiration items to persona store", async () => {
    const items = [makeRouteItem({ category: "goal_or_aspiration" })];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.mergeTypedInsights).toHaveBeenCalledWith(
      "test-agent",
      "test-user",
      expect.arrayContaining([expect.objectContaining({ category: "goal_or_aspiration" })]),
    );
  });

  it("routes behavioral_pattern items to fragment store", async () => {
    const items = [makeRouteItem({ category: "behavioral_pattern", confidence: 0.75 })];
    const result = await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.collectFragment).toHaveBeenCalledWith(
      "test-agent",
      "test-user",
      expect.objectContaining({
        text: "User prefers TypeScript for backend",
        strength: 0.75,
      }),
    );
    expect(result.routed).toBeGreaterThanOrEqual(1);
  });

  it("routes high-confidence correction items to correction store", async () => {
    const items = [
      makeRouteItem({
        category: "domain_knowledge",
        confidence: 0.95,
        evidence: "This was wrong, the correct approach is to use async",
        content: "Use async for I/O operations",
      }),
    ];
    const result = await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.addOrReinforceCorrection).toHaveBeenCalledWith(
      "test-agent",
      "test-user",
      expect.objectContaining({
        domain: "domain_knowledge",
        provenance: "consolidation",
      }),
    );
    expect(result.routed).toBeGreaterThanOrEqual(1);
  });

  it("detects Chinese correction keywords in evidence", async () => {
    const items = [
      makeRouteItem({
        category: "domain_knowledge",
        confidence: 0.92,
        evidence: "之前搞错了，应该用异步方式",
        content: "应该使用异步方式处理I/O",
      }),
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.addOrReinforceCorrection).toHaveBeenCalled();
  });

  it("does NOT route low-confidence correction items to correction store", async () => {
    const items = [
      makeRouteItem({
        category: "domain_knowledge",
        confidence: 0.8,
        evidence: "This was wrong, the correct approach is different",
      }),
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.addOrReinforceCorrection).not.toHaveBeenCalled();
  });

  it("appends memory file summary for all items", async () => {
    const items = [makeRouteItem({ category: "domain_knowledge" })];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.appendToMemoryFile).toHaveBeenCalledWith(
      "/tmp/ws",
      expect.stringContaining("Consolidation Summary"),
    );
  });

  it("captures store errors without stopping other routes", async () => {
    const failingDeps: ConsolidationRouteDeps = {
      ...deps,
      collectFragment: vi.fn().mockRejectedValue(new Error("fragment store down")),
    };
    const items = [
      makeRouteItem({ category: "behavioral_pattern", confidence: 0.8 }),
      makeRouteItem({ category: "domain_knowledge" }),
    ];
    const result = await routeToStores({ items, workspaceDir: "/tmp/ws", deps: failingDeps });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("fragment store down");
    // Persona store should still be called despite fragment failure
    expect(failingDeps.mergeTypedInsights).toHaveBeenCalled();
  });

  it("calls all correct stores for mixed categories", async () => {
    const items = [
      makeRouteItem({ category: "domain_knowledge" }),
      makeRouteItem({ category: "behavioral_pattern", confidence: 0.7 }),
      makeRouteItem({ category: "stated_preference" }),
      makeRouteItem({
        category: "domain_knowledge",
        confidence: 0.95,
        evidence: "This is a mistake that was corrected wrong",
      }),
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.mergeTypedInsights).toHaveBeenCalled();
    expect(deps.collectFragment).toHaveBeenCalledTimes(1);
    expect(deps.addOrReinforceCorrection).toHaveBeenCalledTimes(1);
    expect(deps.appendToMemoryFile).toHaveBeenCalledTimes(1);
  });

  it("groups persona items by agentId:userId key", async () => {
    const items = [
      { agentId: "agent-a", userId: "user-1", item: makeRouteItem().item },
      { agentId: "agent-b", userId: "user-2", item: makeRouteItem().item },
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.mergeTypedInsights).toHaveBeenCalledTimes(2);
    expect(deps.mergeTypedInsights).toHaveBeenCalledWith(
      "agent-a",
      "user-1",
      expect.any(Array),
    );
    expect(deps.mergeTypedInsights).toHaveBeenCalledWith(
      "agent-b",
      "user-2",
      expect.any(Array),
    );
  });

  it("routes with feishu ou_ userId without confusing it with agentId", async () => {
    const items = [
      { agentId: "main", userId: "ou_abc123", item: makeRouteItem({ category: "domain_knowledge" }).item },
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.mergeTypedInsights).toHaveBeenCalledWith(
      "main",
      "ou_abc123",
      expect.any(Array),
    );
  });

  it("calls updateMemoryIndex for items with confidence >= 0.7", async () => {
    const items = [
      makeRouteItem({ category: "domain_knowledge", confidence: 0.9, content: "User knows Rust" }),
      makeRouteItem({ category: "stated_preference", confidence: 0.85, content: "Likes dark mode" }),
      makeRouteItem({ category: "goal_or_aspiration", confidence: 0.75, content: "Learning Rust embedded" }),
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.updateMemoryIndex).toHaveBeenCalledOnce();
    const callArgs = (deps.updateMemoryIndex as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArgs.items).toHaveLength(3);
    expect(callArgs.workspaceDir).toBe("/tmp/ws");
    expect(callArgs.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("excludes items with confidence < 0.7 from updateMemoryIndex", async () => {
    const items = [
      makeRouteItem({ category: "domain_knowledge", confidence: 0.9, content: "High conf" }),
      makeRouteItem({ category: "domain_knowledge", confidence: 0.5, content: "Low conf" }),
      makeRouteItem({ category: "stated_preference", confidence: 0.65, content: "Mid conf" }),
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    const callArgs = (deps.updateMemoryIndex as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArgs.items).toHaveLength(1);
    expect(callArgs.items[0].content).toBe("High conf");
  });

  it("excludes behavioral_pattern with confidence < 0.8 from updateMemoryIndex", async () => {
    const items = [
      makeRouteItem({ category: "behavioral_pattern", confidence: 0.75, content: "Habit pattern" }),
      makeRouteItem({ category: "behavioral_pattern", confidence: 0.85, content: "Strong pattern" }),
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    const callArgs = (deps.updateMemoryIndex as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArgs.items).toHaveLength(1);
    expect(callArgs.items[0].content).toBe("Strong pattern");
  });

  it("does not call updateMemoryIndex when all items are low confidence", async () => {
    const items = [
      makeRouteItem({ category: "domain_knowledge", confidence: 0.3, content: "Low" }),
      makeRouteItem({ category: "behavioral_pattern", confidence: 0.6, content: "Noisy" }),
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.updateMemoryIndex).not.toHaveBeenCalled();
  });

  it("continues routing when updateMemoryIndex fails", async () => {
    const failingDeps: ConsolidationRouteDeps = {
      ...deps,
      updateMemoryIndex: vi.fn().mockRejectedValue(new Error("disk full")),
    };
    const items = [
      makeRouteItem({ category: "domain_knowledge", confidence: 0.9, content: "User knows X" }),
    ];
    const result = await routeToStores({ items, workspaceDir: "/tmp/ws", deps: failingDeps });
    expect(result.errors.some((e) => e.includes("MEMORY.md"))).toBe(true);
    expect(result.routed).toBeGreaterThanOrEqual(1);
  });

  it("passes domains array from item to fragment store", async () => {
    const items = [
      makeRouteItem({
        category: "behavioral_pattern",
        confidence: 0.8,
        content: "User prefers test-driven development",
        domains: ["软件工程"],
      }),
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.collectFragment).toHaveBeenCalledWith(
      "test-agent",
      "test-user",
      expect.objectContaining({
        text: "User prefers test-driven development",
        strength: 0.8,
        domains: ["软件工程"],
      }),
    );
  });

  it("passes multi-domain array to collectFragment", async () => {
    const items = [
      makeRouteItem({
        category: "behavioral_pattern",
        confidence: 0.85,
        content: "User deploys K8s with CI/CD pipelines",
        domains: ["Kubernetes", "DevOps"],
      }),
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.collectFragment).toHaveBeenCalledWith(
      "test-agent",
      "test-user",
      expect.objectContaining({
        domains: ["Kubernetes", "DevOps"],
      }),
    );
  });

  it("passes empty domains array when item.domains is undefined", async () => {
    const items = [
      makeRouteItem({
        category: "behavioral_pattern",
        confidence: 0.75,
        content: "User asks many follow-up questions",
      }),
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.collectFragment).toHaveBeenCalledWith(
      "test-agent",
      "test-user",
      expect.objectContaining({
        domains: [],
      }),
    );
  });

  it("uses item.domains[0] as correction domain when available", async () => {
    const items = [
      makeRouteItem({
        category: "domain_knowledge",
        confidence: 0.95,
        content: "Use async/await for I/O operations",
        evidence: "This was wrong, should use async",
        domains: ["异步编程"],
      }),
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.addOrReinforceCorrection).toHaveBeenCalledWith(
      "test-agent",
      "test-user",
      expect.objectContaining({
        domain: "异步编程",
        provenance: "consolidation",
      }),
    );
  });

  it("uses first domain for correction store when multiple domains exist", async () => {
    const items = [
      makeRouteItem({
        category: "domain_knowledge",
        confidence: 0.95,
        content: "Kubernetes cluster setup was incorrect",
        evidence: "This was wrong, the correct approach is different",
        domains: ["Kubernetes", "DevOps"],
      }),
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.addOrReinforceCorrection).toHaveBeenCalledWith(
      "test-agent",
      "test-user",
      expect.objectContaining({
        domain: "kubernetes",
        provenance: "consolidation",
      }),
    );
  });

  it("falls back to item.category as correction domain when item.domains is undefined", async () => {
    const items = [
      makeRouteItem({
        category: "domain_knowledge",
        confidence: 0.95,
        content: "Correct way to handle errors",
        evidence: "This was wrong, the correct approach is different",
        // domain intentionally omitted
      }),
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    expect(deps.addOrReinforceCorrection).toHaveBeenCalledWith(
      "test-agent",
      "test-user",
      expect.objectContaining({
        domain: "domain_knowledge",
        provenance: "consolidation",
      }),
    );
  });

  it("always sets correction provenance to consolidation literal", async () => {
    const items = [
      makeRouteItem({
        category: "stated_preference",
        confidence: 0.92,
        content: "Prefers light theme",
        evidence: "The mistake was choosing dark theme, should be light",
        domains: ["UI设计"],
      }),
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    const callArgs = (deps.addOrReinforceCorrection as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const record = callArgs[2] as { provenance: string };
    expect(record.provenance).toBe("consolidation");
  });

  it("writes clean format to daily file without category labels", async () => {
    const items = [
      makeRouteItem({ category: "domain_knowledge", confidence: 0.9, content: "User knows Rust" }),
    ];
    await routeToStores({ items, workspaceDir: "/tmp/ws", deps });
    const written = (deps.appendToMemoryFile as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(written).not.toContain("[domain_knowledge]");
    expect(written).not.toContain("confidence:");
    expect(written).toContain("- User knows Rust");
  });
});
