/**
 * Maps connections between different knowledge domains.
 * Uses semantic distance to find unexpected but relevant cross-domain links.
 */

import type { LearnedDomainGraph, DomainGraphEdge } from "../types.js";

/** Graph of domain adjacency relationships */
export type DomainGraph = Record<string, string[]>;

/** Known domain adjacency relationships */
const DEFAULT_DOMAIN_ADJACENCIES: DomainGraph = {
  "AI/机器学习": ["数据科学", "软件架构", "编程语言", "云/基础设施", "网络安全"],
  "软件架构": ["编程语言", "云/基础设施", "网络安全", "AI/机器学习"],
  "产品思维": ["创业/商业", "数据科学", "AI/机器学习"],
  "创业/商业": ["产品思维", "数据科学"],
  "数据科学": ["AI/机器学习", "产品思维", "云/基础设施"],
  "网络安全": ["云/基础设施", "软件架构"],
  "编程语言": ["软件架构", "AI/机器学习"],
  "云/基础设施": ["软件架构", "网络安全", "数据科学"],
};

function resolveGraph(extendedGraph?: DomainGraph): DomainGraph {
  return { ...DEFAULT_DOMAIN_ADJACENCIES, ...extendedGraph };
}

const LN2 = Math.LN2;

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

function buildEdgeIndex(edges: DomainGraphEdge[]): Map<string, DomainGraphEdge> {
  const index = new Map<string, DomainGraphEdge>();
  for (const edge of edges) {
    index.set(edgeKey(edge.source, edge.target), edge);
  }
  return index;
}

export function seedDomainGraph(): LearnedDomainGraph {
  const nodes: string[] = Object.keys(DEFAULT_DOMAIN_ADJACENCIES);
  const edges: DomainGraphEdge[] = [];
  const now = 0;
  const seen = new Set<string>();

  for (const [source, targets] of Object.entries(DEFAULT_DOMAIN_ADJACENCIES)) {
    for (const target of targets) {
      const key = edgeKey(source, target);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        source,
        target,
        weight: 1.0,
        lastObserved: now,
        observations: 1,
      });
    }
  }

  return { nodes, edges, totalObservations: 0 };
}

export function observeCoOccurrence(
  graph: LearnedDomainGraph,
  domains: string[],
  timestamp: number,
): LearnedDomainGraph {
  if (domains.length < 2) return graph;

  const nodes = [...graph.nodes];
  const nodeSet = new Set(nodes);
  const edgeIndex = buildEdgeIndex(graph.edges);
  let newEdges = [...graph.edges];
  let addedNodes = false;

  for (const domain of domains) {
    if (!nodeSet.has(domain)) {
      nodes.push(domain);
      nodeSet.add(domain);
      addedNodes = true;
    }
  }

  let observationsAdded = 0;

  for (let i = 0; i < domains.length; i++) {
    for (let j = i + 1; j < domains.length; j++) {
      const key = edgeKey(domains[i], domains[j]);
      const existing = edgeIndex.get(key);
      observationsAdded++;

      if (existing) {
        const updated: DomainGraphEdge = {
          ...existing,
          weight: existing.weight + 0.1,
          lastObserved: timestamp,
          observations: existing.observations + 1,
        };
        newEdges = newEdges.map((e) =>
          edgeKey(e.source, e.target) === key ? updated : e,
        );
        edgeIndex.set(key, updated);
      } else {
        const [src, tgt] = domains[i] < domains[j]
          ? [domains[i], domains[j]]
          : [domains[j], domains[i]];
        const created: DomainGraphEdge = {
          source: src,
          target: tgt,
          weight: 0.1,
          lastObserved: timestamp,
          observations: 1,
        };
        newEdges = [...newEdges, created];
        edgeIndex.set(key, created);
      }
    }
  }

  return {
    nodes: addedNodes ? nodes : graph.nodes,
    edges: newEdges,
    totalObservations: graph.totalObservations + observationsAdded,
  };
}

export function decayEdges(
  graph: LearnedDomainGraph,
  now: number,
  halfLifeMs: number,
): LearnedDomainGraph {
  const pruned: DomainGraphEdge[] = [];

  for (const edge of graph.edges) {
    const ageMs = now - edge.lastObserved;
    const decayedWeight = edge.weight * Math.exp((-LN2 * ageMs) / halfLifeMs);
    if (decayedWeight >= 0.01) {
      pruned.push({ ...edge, weight: decayedWeight });
    }
  }

  return {
    nodes: graph.nodes,
    edges: pruned,
    totalObservations: graph.totalObservations,
  };
}

export function getEdgeWeight(
  graph: LearnedDomainGraph,
  source: string,
  target: string,
): number {
  const key = edgeKey(source, target);
  for (const edge of graph.edges) {
    if (edgeKey(edge.source, edge.target) === key) {
      return edge.weight;
    }
  }
  return 0.5;
}

function buildAdjacencyFromLearned(graph: LearnedDomainGraph): DomainGraph {
  const adj: DomainGraph = {};
  for (const node of graph.nodes) {
    adj[node] = [];
  }
  for (const edge of graph.edges) {
    if (edge.weight >= 0.3) {
      if (!adj[edge.source]) adj[edge.source] = [];
      if (!adj[edge.target]) adj[edge.target] = [];
      adj[edge.source].push(edge.target);
      adj[edge.target].push(edge.source);
    }
  }
  return adj;
}

export function findCrossDomainConnections(
  userDomains: string[],
  extendedGraph?: DomainGraph,
  domainGraph?: LearnedDomainGraph,
): Array<{ from: string; to: string; bridge: string[]; distance: number }> {
  const graph = domainGraph
    ? buildAdjacencyFromLearned(domainGraph)
    : resolveGraph(extendedGraph);
  const connections: Array<{ from: string; to: string; bridge: string[]; distance: number }> = [];

  for (const domain of userDomains) {
    const adjacent = graph[domain] ?? [];
    for (const target of adjacent) {
      if (userDomains.includes(target)) continue;

      const targetAdjacent = graph[target] ?? [];
      const bridges = targetAdjacent.filter((t) => userDomains.includes(t));

      connections.push({
        from: domain,
        to: target,
        bridge: bridges,
        distance: bridges.length === 0 ? 2 : 1,
      });
    }
  }

  return connections.sort((a, b) => a.distance - b.distance);
}

export function semanticDistance(
  domainA: string,
  domainB: string,
  extendedGraph?: DomainGraph,
  domainGraph?: LearnedDomainGraph,
): number {
  if (domainA === domainB) return 0;

  if (domainGraph) {
    const directWeight = getEdgeWeight(domainGraph, domainA, domainB);
    if (directWeight > 0.5) return 1 - directWeight;

    for (const edge of domainGraph.edges) {
      const edgeDomains = [edge.source, edge.target];
      if (edgeDomains.includes(domainA)) {
        const mid = edgeDomains[0] === domainA ? edgeDomains[1] : edgeDomains[0];
        const midWeight = getEdgeWeight(domainGraph, mid, domainB);
        if (midWeight > 0.5) {
          return 1 - Math.min(directWeight, midWeight) * 0.75;
        }
      }
    }

    if (directWeight > 0) return 1 - directWeight;
  }

  const graph = resolveGraph(extendedGraph);
  const adjacent = graph[domainA] ?? [];
  if (adjacent.includes(domainB)) return 0.5;

  for (const mid of adjacent) {
    const midAdjacent = graph[mid] ?? [];
    if (midAdjacent.includes(domainB)) return 0.75;
  }

  return 1.0;
}

export function discoverDomainsFromPersona(
  persona: { domains: Record<string, unknown>; identity: { expertDomains?: string[]; interestDomains?: string[]; curiosityDomains?: string[] } },
  existingGraph?: DomainGraph,
): string[] {
  const graph = existingGraph ?? DEFAULT_DOMAIN_ADJACENCIES;
  const knownDomains = new Set(Object.keys(graph));
  const discovered: string[] = [];

  for (const domain of Object.keys(persona.domains)) {
    if (!knownDomains.has(domain)) discovered.push(domain);
  }

  const identityLists = [
    persona.identity.expertDomains ?? [],
    persona.identity.interestDomains ?? [],
    persona.identity.curiosityDomains ?? [],
  ];
  for (const list of identityLists) {
    for (const domain of list) {
      if (!knownDomains.has(domain) && !discovered.includes(domain)) {
        discovered.push(domain);
      }
    }
  }

  return discovered;
}

export function extendDomainGraph(
  baseGraph: DomainGraph | undefined,
  newDomains: string[],
  suggestedConnections?: Record<string, string[]>,
): DomainGraph {
  const graph: DomainGraph = { ...(baseGraph ?? DEFAULT_DOMAIN_ADJACENCIES) };

  for (const domain of newDomains) {
    if (domain in graph) continue;
    graph[domain] = suggestedConnections?.[domain] ?? ["AI/机器学习"];
  }

  return Object.freeze(graph);
}
