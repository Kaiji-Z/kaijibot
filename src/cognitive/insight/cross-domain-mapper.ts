/**
 * Maps connections between different knowledge domains.
 * Uses semantic distance to find unexpected but relevant cross-domain links.
 */

/** Graph of domain adjacency relationships */
export type DomainGraph = Record<string, string[]>;

/** Known domain adjacency relationships */
const DEFAULT_DOMAIN_ADJACENCIES: DomainGraph = {
  "AI/机器学习": ["数据科学", "软件架构", "编程语言", "云/基础设施", "网络安全"],
  软件架构: ["编程语言", "云/基础设施", "网络安全", "AI/机器学习"],
  产品思维: ["创业/商业", "数据科学", "AI/机器学习"],
  "创业/商业": ["产品思维", "数据科学"],
  数据科学: ["AI/机器学习", "产品思维", "云/基础设施"],
  网络安全: ["云/基础设施", "软件架构"],
  编程语言: ["软件架构", "AI/机器学习"],
  "云/基础设施": ["软件架构", "网络安全", "数据科学"],
};

function resolveGraph(extendedGraph?: DomainGraph): DomainGraph {
  return { ...DEFAULT_DOMAIN_ADJACENCIES, ...extendedGraph };
}

export function findCrossDomainConnections(
  userDomains: string[],
  extendedGraph?: DomainGraph,
): Array<{ from: string; to: string; bridge: string[]; distance: number }> {
  const graph = resolveGraph(extendedGraph);
  const connections: Array<{ from: string; to: string; bridge: string[]; distance: number }> = [];

  for (const domain of userDomains) {
    const adjacent = graph[domain] ?? [];
    for (const target of adjacent) {
      if (userDomains.includes(target)) {
        continue;
      }

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

  return connections.toSorted((a, b) => a.distance - b.distance);
}

export function semanticDistance(
  domainA: string,
  domainB: string,
  extendedGraph?: DomainGraph,
): number {
  if (domainA === domainB) {
    return 0;
  }

  const graph = resolveGraph(extendedGraph);
  const adjacent = graph[domainA] ?? [];
  if (adjacent.includes(domainB)) {
    return 0.5;
  }

  for (const mid of adjacent) {
    const midAdjacent = graph[mid] ?? [];
    if (midAdjacent.includes(domainB)) {
      return 0.75;
    }
  }

  return 1.0;
}

export function discoverDomainsFromPersona(
  persona: {
    domains: Record<string, unknown>;
    identity: { expertDomains?: string[]; interestDomains?: string[]; curiosityDomains?: string[] };
  },
  existingGraph?: DomainGraph,
): string[] {
  const graph = existingGraph ?? DEFAULT_DOMAIN_ADJACENCIES;
  const knownDomains = new Set(Object.keys(graph));
  const discovered: string[] = [];

  for (const domain of Object.keys(persona.domains)) {
    if (!knownDomains.has(domain)) {
      discovered.push(domain);
    }
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
    if (domain in graph) {
      continue;
    }
    graph[domain] = suggestedConnections?.[domain] ?? ["AI/机器学习"];
  }

  return Object.freeze(graph);
}
