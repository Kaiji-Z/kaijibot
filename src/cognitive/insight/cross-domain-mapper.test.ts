import { describe, it, expect } from "vitest";
import {
  findCrossDomainConnections,
  semanticDistance,
  discoverDomainsFromPersona,
  extendDomainGraph,
} from "./cross-domain-mapper.js";

describe("findCrossDomainConnections", () => {
  it("finds connections between known domains", () => {
    const connections = findCrossDomainConnections(["AI/机器学习", "软件架构"]);
    expect(connections.length).toBeGreaterThan(0);
  });

  it("returns connections sorted by distance", () => {
    const connections = findCrossDomainConnections(["AI/机器学习"]);
    for (let i = 1; i < connections.length; i++) {
      expect(connections[i].distance).toBeGreaterThanOrEqual(connections[i - 1].distance);
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
      domains: { 量子计算: {}, "AI/机器学习": {} },
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
      domains: { "AI/机器学习": {}, 软件架构: {} },
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
      domains: { 量子计算: {} },
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
      量子计算: ["数据科学", "软件架构"],
    });
    expect(extended["量子计算"]).toEqual(["数据科学", "软件架构"]);
  });

  it("skips domains already in the graph", () => {
    const extended = extendDomainGraph(undefined, ["AI/机器学习"]);
    expect(extended["AI/机器学习"]).toEqual(expect.arrayContaining(["数据科学", "软件架构"]));
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
    const extendedGraph = { 量子计算: ["AI/机器学习"] };
    expect(semanticDistance("量子计算", "AI/机器学习", extendedGraph)).toBe(0.5);
  });

  it("finds two-hop path in extended graph", () => {
    const extendedGraph = { 量子计算: ["AI/机器学习"] };
    expect(semanticDistance("量子计算", "数据科学", extendedGraph)).toBe(0.75);
  });
});
