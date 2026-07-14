import type { KindleConfig } from "../config.js";
/**
 * Cognitive map graph builder.
 *
 * Merges PersonaStore domains with knowledge-wiki entities/concepts into a
 * single `MapGraph` ready for PNG rendering. Pure data transformation —
 * no I/O, no side effects. All inputs are already-loaded objects.
 *
 * Pipeline:
 *   1. Build domain nodes from persona (sorted by strength desc, truncated
 *      to `cfg.maxDomains`; `truncated` metadata recorded when slicing occurs).
 *   2. Overlay wiki nodes (strength 0.5) and raw wiki edges — only when
 *      `cfg.showWiki` is true. Missing/empty wiki with `showWiki=true`
 *      surfaces a `warning` on the result.
 *   3. Cross-domain edges: pairs of high-strength (>0.4) domain nodes whose
 *      labels share tokens (Jaccard ≥ 0.5). Labeled "related".
 *   4. Persona-wiki cross edges: domain↔wiki pairs with Jaccard ≥ 0.5.
 *      Labeled "wiki".
 *   5. Dedup nodes by id (first wins; domain before wiki, so domain wins
 *      on collision).
 *   6. Dedup edges as unordered pairs; drop self-edges.
 *
 * Tokenizer preserves CJK characters (\u4e00-\u9fff) as part of tokens so
 * Chinese/Japanese/Korean labels tokenize correctly.
 */
import type {
  MapEdge,
  MapGraph,
  MapNode,
  PersonaDomainNode,
  PersonaTree,
  WikiEdge,
  WikiNode,
} from "../types.js";
import { computeStrength } from "./strength.js";

export interface WikiData {
  readonly nodes: readonly WikiNode[];
  readonly edges: readonly WikiEdge[];
}

/** Categories excluded from `insightCount` (per TypedInsight filter convention). */
const EXCLUDED_INSIGHT_CATEGORIES: ReadonlySet<string> = new Set([
  "tool_config",
  "contextual_fact",
]);

/** Default strength assigned to wiki-derived nodes. */
const WIKI_DEFAULT_STRENGTH = 0.5;

/** Both endpoints of a cross-domain edge must clear this strength threshold. */
const CROSS_DOMAIN_STRENGTH_THRESHOLD = 0.4;

/** Label-overlap Jaccard threshold for edge creation. */
const JACCARD_THRESHOLD = 0.5;

/** Warning text when `showWiki=true` but wiki vault is missing or empty. */
const WIKI_MISSING_WARNING = "knowledge-wiki vault not found or empty";

/**
 * Tokenize a label for Jaccard similarity.
 *
 * Lowercases, then splits on any run of characters that are NOT lowercase
 * ASCII letters, digits, or CJK ideographs (\u4e00-\u9fff). Tokens shorter
 * than 2 characters are dropped. Returns a Set for efficient set ops.
 */
function tokenize(label: string): Set<string> {
  return new Set(
    label
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/)
      .filter((t) => t.length >= 2),
  );
}

/**
 * Jaccard similarity `|A ∩ B| / |A ∪ B|` between two token sets.
 * Returns 0 if either set is empty (avoids vacuous overlap).
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) {
      intersection++;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Deterministic unordered-pair key for edge dedup ({A,B} ≡ {B,A}). */
function edgeKey(from: string, to: string): string {
  return from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`;
}

/**
 * Count persona insights that are NOT in the excluded category list.
 * Falls back to `keyInsights.length` when `insights` is undefined.
 */
function countMeaningfulInsights(node: PersonaDomainNode): number {
  if (node.insights !== undefined) {
    let n = 0;
    for (const i of node.insights) {
      const cat = i?.category;
      if (cat !== undefined && EXCLUDED_INSIGHT_CATEGORIES.has(cat)) {
        continue;
      }
      n++;
    }
    return n;
  }
  return node.keyInsights?.length ?? 0;
}

/**
 * Build the cognitive map graph from persona + wiki data.
 *
 * @param persona  Loaded PersonaTree (or null if missing/unparseable)
 * @param wiki     Loaded wiki graph (or null if vault absent)
 * @param cfg      `maxDomains` truncation cap + `showWiki` overlay flag
 * @returns Immutable MapGraph ready for rendering
 */
export function buildMapGraph(
  persona: PersonaTree | null,
  wiki: WikiData | null,
  cfg: Pick<KindleConfig, "maxDomains" | "showWiki">,
): MapGraph {
  // —— 1. Domain nodes from persona ——
  const domainNodes: MapNode[] = [];
  const domains = persona?.domains;
  if (domains != null && typeof domains === "object") {
    for (const [key, node] of Object.entries(domains)) {
      const strength = computeStrength(node);
      const insightCount = countMeaningfulInsights(node);
      const domainNode: MapNode = {
        id: key.toLowerCase(),
        label: key,
        kind: "domain",
        strength,
        insightCount,
        ...(node.phase !== undefined ? { phase: node.phase } : {}),
      };
      domainNodes.push(domainNode);
    }
  }
  domainNodes.sort((a, b) => b.strength - a.strength);

  let truncated: { readonly shown: number; readonly total: number } | undefined;
  if (domainNodes.length > cfg.maxDomains) {
    truncated = { shown: cfg.maxDomains, total: domainNodes.length };
  }
  const shownDomainNodes = truncated ? domainNodes.slice(0, cfg.maxDomains) : domainNodes;

  // —— 2. Wiki overlay (only when showWiki=true) ——
  let warning: string | undefined;
  const wikiNodes: MapNode[] = [];
  const wikiEdges: MapEdge[] = [];
  if (cfg.showWiki) {
    if (wiki === null || wiki.nodes.length === 0) {
      warning = WIKI_MISSING_WARNING;
    } else {
      for (const wn of wiki.nodes) {
        wikiNodes.push({
          id: wn.id,
          label: wn.label,
          kind: wn.kind,
          strength: WIKI_DEFAULT_STRENGTH,
        });
      }
      for (const we of wiki.edges) {
        wikiEdges.push({ from: we.from.toLowerCase(), to: we.to.toLowerCase() });
      }
    }
  }

  // Pre-compute domain label token sets (used by both edge builders).
  const domainTokensById = new Map<string, Set<string>>();
  for (const dn of shownDomainNodes) {
    domainTokensById.set(dn.id, tokenize(dn.label));
  }

  // —— 3. Cross-domain edges (both endpoints > 0.4 strength, Jaccard ≥ 0.5) ——
  const crossDomainEdges: MapEdge[] = [];
  for (let i = 0; i < shownDomainNodes.length; i++) {
    const a = shownDomainNodes[i];
    if (a.strength <= CROSS_DOMAIN_STRENGTH_THRESHOLD) {
      continue;
    }
    const aTokens = domainTokensById.get(a.id);
    if (aTokens === undefined) {
      continue;
    }
    for (let j = i + 1; j < shownDomainNodes.length; j++) {
      const b = shownDomainNodes[j];
      if (b.strength <= CROSS_DOMAIN_STRENGTH_THRESHOLD) {
        continue;
      }
      const bTokens = domainTokensById.get(b.id);
      if (bTokens === undefined) {
        continue;
      }
      if (jaccard(aTokens, bTokens) >= JACCARD_THRESHOLD) {
        crossDomainEdges.push({ from: a.id, to: b.id, label: "related" });
      }
    }
  }

  // —— 4. Persona-wiki cross edges (Jaccard ≥ 0.5 between labels) ——
  const personaWikiEdges: MapEdge[] = [];
  if (wiki !== null && wiki.nodes.length > 0) {
    for (const wn of wiki.nodes) {
      const wTokens = tokenize(wn.label);
      for (const dn of shownDomainNodes) {
        const dTokens = domainTokensById.get(dn.id);
        if (dTokens === undefined) {
          continue;
        }
        if (jaccard(dTokens, wTokens) >= JACCARD_THRESHOLD) {
          personaWikiEdges.push({
            from: dn.id,
            to: wn.id,
            label: "wiki",
          });
        }
      }
    }
  }

  // —— 5. Dedup nodes by id (domain first; first wins → domain wins on tie) ——
  const seenNodeIds = new Set<string>();
  const dedupedNodes: MapNode[] = [];
  for (const node of [...shownDomainNodes, ...wikiNodes]) {
    if (seenNodeIds.has(node.id)) {
      continue;
    }
    seenNodeIds.add(node.id);
    dedupedNodes.push(node);
  }

  // —— 6. Dedup edges (unordered pair key; drop self-edges) ——
  // Edge insertion order: raw wiki edges → cross-domain → persona-wiki.
  const seenEdgeKeys = new Set<string>();
  const dedupedEdges: MapEdge[] = [];
  for (const edge of [...wikiEdges, ...crossDomainEdges, ...personaWikiEdges]) {
    if (edge.from === edge.to) {
      continue;
    }
    const key = edgeKey(edge.from, edge.to);
    if (seenEdgeKeys.has(key)) {
      continue;
    }
    seenEdgeKeys.add(key);
    dedupedEdges.push(edge);
  }

  // —— 7. Assemble result with optional fields ——
  return {
    nodes: dedupedNodes,
    edges: dedupedEdges,
    ...(truncated !== undefined ? { truncated } : {}),
    ...(warning !== undefined ? { warning } : {}),
  };
}
