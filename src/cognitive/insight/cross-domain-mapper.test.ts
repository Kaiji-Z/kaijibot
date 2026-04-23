import { describe, it, expect } from "vitest";
import {
  findCrossDomainConnections,
  semanticDistance,
  discoverDomainsFromPersona,
  extendDomainGraph,
  seedDomainGraph,
  observeCoOccurrence,
  decayEdges,
  getEdgeWeight,
} from "./cross-domain-mapper.js";
import type { LearnedDomainGraph } from "../types.js";

describe("findCrossDomainConnections", () => {
  it("finds connections between known domains", () => {
    const connections = findCrossDomainConnections(["AI/机器学习", "软件架构"]);
    expect(connections.length).toBeGreaterThan(0);
  });

  it("returns connections sorted by distance", () => {
    const connections = findCrossDomainConnections(["AI/机器学习"]);
    for (let i = 1; i < connections.length; i++) {
      expect(connections[i].distance).toBeGreaterThanOrEqual(
        connections[i - 1].distance,
      );
    }
  });

  it("returns empty for unknown domains", () => {
    const connections = findCrossDomainConnections(["完全未知领域"]);
    expect(connections).toEqual([]);
  });

  it("excludes domains the user already has", () => {
    const connections = findCrossDomainConnections(["AI/机器学习"]);
    const targets = connections.map((c) => c.to);
    expect(targets).not.toContain("AI/机器学习");
  });
});

describe("semanticDistance", () => {
  it("returns 0 for same domain", () => {
    expect(semanticDistance("AI/机器学习", "AI/机器学习")).toBe(0);
  });

  it("returns small distance for adjacent domains", () => {
    expect(semanticDistance("AI/机器学习", "数据科学")).toBeLessThan(1);
  });

  it("returns 0.5 for directly adjacent domains", () => {
    expect(semanticDistance("AI/机器学习", "数据科学")).toBe(0.5);
  });

  it("returns 1.0 for unrelated domains", () => {
    expect(semanticDistance("编程语言", "创业/商业")).toBe(1.0);
  });

  it("returns 0.75 for two-hop connections", () => {
    expect(semanticDistance("AI/机器学习", "产品思维")).toBe(0.75);
  });
});

describe("discoverDomainsFromPersona", () => {
  it("finds domains not in the default graph", () => {
    const persona = {
      domains: { "量子计算": {}, "AI/机器学习": {} },
      identity: {
        expertDomains: ["区块链"],
        interestDomains: ["数据科学"],
      },
    };
    const discovered = discoverDomainsFromPersona(persona);
    expect(discovered).toContain("量子计算");
    expect(discovered).toContain("区块链");
    expect(discovered).not.toContain("AI/机器学习");
    expect(discovered).not.toContain("数据科学");
  });

  it("returns empty for known domains only", () => {
    const persona = {
      domains: { "AI/机器学习": {}, "软件架构": {} },
      identity: {
        expertDomains: ["数据科学"],
        interestDomains: [],
      },
    };
    const discovered = discoverDomainsFromPersona(persona);
    expect(discovered).toEqual([]);
  });

  it("collects domains from curiosityDomains", () => {
    const persona = {
      domains: {},
      identity: {
        curiosityDomains: ["神经科学"],
      },
    };
    const discovered = discoverDomainsFromPersona(persona);
    expect(discovered).toEqual(["神经科学"]);
  });

  it("deduplicates across sources", () => {
    const persona = {
      domains: { "量子计算": {} },
      identity: {
        expertDomains: ["量子计算"],
        interestDomains: ["量子计算"],
      },
    };
    const discovered = discoverDomainsFromPersona(persona);
    expect(discovered).toEqual(["量子计算"]);
  });
});

describe("extendDomainGraph", () => {
  it("adds new domains to graph", () => {
    const extended = extendDomainGraph(undefined, ["量子计算"]);
    expect(extended["量子计算"]).toEqual(["AI/机器学习"]);
    expect(extended["AI/机器学习"]).toBeDefined();
  });

  it("does not modify the base graph (immutable)", () => {
    const extended = extendDomainGraph(undefined, ["量子计算"]);
    expect(Object.isFrozen(extended)).toBe(true);
  });

  it("uses suggested connections when provided", () => {
    const extended = extendDomainGraph(undefined, ["量子计算"], {
      "量子计算": ["数据科学", "软件架构"],
    });
    expect(extended["量子计算"]).toEqual(["数据科学", "软件架构"]);
  });

  it("skips domains already in the graph", () => {
    const extended = extendDomainGraph(undefined, ["AI/机器学习"]);
    expect(extended["AI/机器学习"]).toEqual(
      expect.arrayContaining(["数据科学", "软件架构"]),
    );
  });
});

describe("findCrossDomainConnections with extended graph", () => {
  it("works with custom domains", () => {
    const extendedGraph = { "AI/机器学习": ["量子计算", "数据科学"] };
    const connections = findCrossDomainConnections(["AI/机器学习"], extendedGraph);
    const targets = connections.map((c) => c.to);
    expect(targets).toContain("量子计算");
  });

  it("respects extended adjacencies over defaults", () => {
    const extendedGraph = { "AI/机器学习": ["量子计算"] };
    const connections = findCrossDomainConnections(["AI/机器学习"], extendedGraph);
    expect(connections).toHaveLength(1);
    expect(connections[0].to).toBe("量子计算");
  });
});

describe("semanticDistance with extended graph", () => {
  it("calculates distance in extended graph", () => {
    const extendedGraph = { "量子计算": ["AI/机器学习"] };
    expect(semanticDistance("量子计算", "AI/机器学习", extendedGraph)).toBe(0.5);
  });

  it("finds two-hop path in extended graph", () => {
    const extendedGraph = { "量子计算": ["AI/机器学习"] };
    expect(semanticDistance("量子计算", "数据科学", extendedGraph)).toBe(0.75);
  });
});

describe("seedDomainGraph", () => {
  it("returns graph with 8 nodes matching DEFAULT_DOMAIN_ADJACENCIES", () => {
    const graph = seedDomainGraph();
    expect(graph.nodes).toHaveLength(8);
    expect(graph.nodes).toContain("AI/机器学习");
    expect(graph.nodes).toContain("软件架构");
    expect(graph.nodes).toContain("产品思维");
    expect(graph.nodes).toContain("创业/商业");
    expect(graph.nodes).toContain("数据科学");
    expect(graph.nodes).toContain("网络安全");
    expect(graph.nodes).toContain("编程语言");
    expect(graph.nodes).toContain("云/基础设施");
  });

  it("creates edges with weight 1.0", () => {
    const graph = seedDomainGraph();
    expect(graph.edges.length).toBeGreaterThan(0);
    for (const edge of graph.edges) {
      expect(edge.weight).toBe(1.0);
      expect(edge.observations).toBe(1);
    }
  });

  it("has no duplicate edges (undirected)", () => {
    const graph = seedDomainGraph();
    const keys = graph.edges.map((e) =>
      e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("observeCoOccurrence", () => {
  it("creates new edges for co-occurring domains", () => {
    const graph = seedDomainGraph();
    const result = observeCoOccurrence(graph, ["量子计算", "生物信息学"], 1000);
    expect(result.edges.some((e) =>
      (e.source === "量子计算" && e.target === "生物信息学") ||
      (e.source === "生物信息学" && e.target === "量子计算"),
    )).toBe(true);
    const newEdge = result.edges.find((e) =>
      (e.source === "量子计算" && e.target === "生物信息学") ||
      (e.source === "生物信息学" && e.target === "量子计算"),
    )!;
    expect(newEdge.weight).toBe(0.1);
    expect(newEdge.observations).toBe(1);
    expect(newEdge.lastObserved).toBe(1000);
  });

  it("adds new nodes to the graph", () => {
    const graph = seedDomainGraph();
    const result = observeCoOccurrence(graph, ["量子计算", "AI/机器学习"], 1000);
    expect(result.nodes).toContain("量子计算");
  });

  it("increments weight and observations on second observation", () => {
    let graph = observeCoOccurrence(seedDomainGraph(), ["量子计算", "生物信息学"], 1000);
    const firstEdge = graph.edges.find((e) =>
      (e.source === "量子计算" && e.target === "生物信息学") ||
      (e.source === "生物信息学" && e.target === "量子计算"),
    )!;
    expect(firstEdge.weight).toBe(0.1);
    expect(firstEdge.observations).toBe(1);

    graph = observeCoOccurrence(graph, ["量子计算", "生物信息学"], 2000);
    const secondEdge = graph.edges.find((e) =>
      (e.source === "量子计算" && e.target === "生物信息学") ||
      (e.source === "生物信息学" && e.target === "量子计算"),
    )!;
    expect(secondEdge.weight).toBeCloseTo(0.2);
    expect(secondEdge.observations).toBe(2);
    expect(secondEdge.lastObserved).toBe(2000);
  });

  it("returns unchanged graph for single domain", () => {
    const graph = seedDomainGraph();
    const result = observeCoOccurrence(graph, ["AI/机器学习"], 1000);
    expect(result).toBe(graph);
  });

  it("does not mutate the input graph", () => {
    const graph = seedDomainGraph();
    const edgesBefore = graph.edges.length;
    observeCoOccurrence(graph, ["量子计算", "生物信息学"], 1000);
    expect(graph.edges).toHaveLength(edgesBefore);
  });
});

describe("decayEdges", () => {
  it("applies exponential decay correctly", () => {
    let graph = observeCoOccurrence(seedDomainGraph(), ["量子计算", "生物信息学"], 0);
    graph = observeCoOccurrence(graph, ["量子计算", "生物信息学"], 0);
    const edgeBefore = graph.edges.find((e) =>
      (e.source === "量子计算" && e.target === "生物信息学") ||
      (e.source === "生物信息学" && e.target === "量子计算"),
    )!;
    expect(edgeBefore.weight).toBeCloseTo(0.2);

    const halfLife = 1000;
    const now = 1000;
    const decayed = decayEdges(graph, now, halfLife);
    const edgeAfter = decayed.edges.find((e) =>
      (e.source === "量子计算" && e.target === "生物信息学") ||
      (e.source === "生物信息学" && e.target === "量子计算"),
    )!;
    expect(edgeAfter.weight).toBeCloseTo(0.1);
  });

  it("prunes edges below 0.01 threshold", () => {
    const graph = observeCoOccurrence(
      seedDomainGraph(),
      ["量子计算", "生物信息学"],
      0,
    );
    const edge = graph.edges.find((e) =>
      (e.source === "量子计算" && e.target === "生物信息学") ||
      (e.source === "生物信息学" && e.target === "量子计算"),
    )!;
    expect(edge.weight).toBe(0.1);

    const halfLife = 1000;
    const now = 50000;
    const decayed = decayEdges(graph, now, halfLife);
    const prunedEdge = decayed.edges.find((e) =>
      (e.source === "量子计算" && e.target === "生物信息学") ||
      (e.source === "生物信息学" && e.target === "量子计算"),
    );
    expect(prunedEdge).toBeUndefined();
  });

  it("keeps edges that are still above threshold", () => {
    const graph = seedDomainGraph();
    const now = 100;
    const halfLife = 100000;
    const decayed = decayEdges(graph, now, halfLife);
    expect(decayed.edges.length).toBeGreaterThan(0);
  });
});

describe("getEdgeWeight", () => {
  it("returns learned weight for existing edge", () => {
    const graph = seedDomainGraph();
    expect(getEdgeWeight(graph, "AI/机器学习", "数据科学")).toBe(1.0);
  });

  it("returns 0.5 default for non-existent edge", () => {
    const graph = seedDomainGraph();
    expect(getEdgeWeight(graph, "AI/机器学习", "量子计算")).toBe(0.5);
  });

  it("is order-independent", () => {
    const graph = seedDomainGraph();
    expect(getEdgeWeight(graph, "数据科学", "AI/机器学习")).toBe(
      getEdgeWeight(graph, "AI/机器学习", "数据科学"),
    );
  });
});

describe("findCrossDomainConnections with learned graph", () => {
  it("returns different results than static when using learned graph", () => {
    const staticResult = findCrossDomainConnections(["量子计算"]);
    expect(staticResult).toEqual([]);

    let learned = seedDomainGraph();
    for (let i = 0; i < 5; i++) {
      learned = observeCoOccurrence(learned, ["量子计算", "生物信息学"], 1000 + i * 1000);
    }
    const learnedResult = findCrossDomainConnections(["量子计算"], undefined, learned);
    expect(learnedResult.length).toBeGreaterThan(0);
  });

  it("backward compat: calling without domainGraph produces same results", () => {
    const result1 = findCrossDomainConnections(["AI/机器学习", "软件架构"]);
    const result2 = findCrossDomainConnections(["AI/机器学习", "软件架构"], undefined, undefined);
    expect(result1).toEqual(result2);
  });

  it("includes connections from domainGraph edges not in default adjacencies", () => {
    const domainGraph: LearnedDomainGraph = {
      nodes: ["AI/机器学习", "软件架构", "NicheDomain"],
      edges: [
        { source: "AI/机器学习", target: "NicheDomain", weight: 0.8, lastObserved: Date.now(), observations: 5 },
      ],
      totalObservations: 5,
    };
    const withoutGraph = findCrossDomainConnections(["AI/机器学习"]);
    const targetsWithout = withoutGraph.map((c) => c.to);
    expect(targetsWithout).not.toContain("NicheDomain");

    const withGraph = findCrossDomainConnections(["AI/机器学习"], undefined, domainGraph);
    const targetsWith = withGraph.map((c) => c.to);
    expect(targetsWith).toContain("NicheDomain");
  });
});

describe("semanticDistance with learned graph", () => {
  it("uses learned weights when graph provided", () => {
    let graph = seedDomainGraph();
    for (let i = 0; i < 6; i++) {
      graph = observeCoOccurrence(graph, ["量子计算", "AI/机器学习"], 1000 + i * 1000);
    }

    const dist = semanticDistance("量子计算", "AI/机器学习", undefined, graph);
    expect(dist).toBeLessThan(0.5);
    expect(dist).toBeGreaterThan(0);
  });

  it("backward compat: calling without domainGraph produces same results", () => {
    expect(semanticDistance("AI/机器学习", "数据科学")).toBe(0.5);
    expect(semanticDistance("AI/机器学习", "数据科学", undefined, undefined)).toBe(0.5);
    expect(semanticDistance("编程语言", "创业/商业")).toBe(1.0);
  });
});
