import { tokenize, jaccardSimilarity } from "./mmr.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An item eligible for semantic deduplication. */
export type DedupableItem = {
  /** Unique identifier for the item */
  id: string;
  /** Relevance score (higher = better) */
  score: number;
  /** Text content to compare for similarity */
  content: string;
};

/** Configuration for semantic deduplication. */
export type SemanticDedupConfig = {
  /** Enable/disable semantic dedup. Default: false */
  enabled: boolean;
  /** Jaccard similarity threshold above which items are considered duplicates. Default: 0.85 */
  threshold: number;
};

export const DEFAULT_SEMANTIC_DEDUP_CONFIG: SemanticDedupConfig = {
  enabled: false,
  threshold: 0.85,
};

/** Result item with optional merge metadata. */
export type DedupedItem<T extends DedupableItem = DedupableItem> = T & {
  /** If this item replaced duplicates, list their IDs */
  mergedFrom?: string[];
};

// ---------------------------------------------------------------------------
// Union-Find helper
// ---------------------------------------------------------------------------

class UnionFind {
  private parent: Map<string, string> = new Map();
  private rank: Map<string, number> = new Map();

  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // Path compression
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra) ?? 0;
    const rankB = this.rank.get(rb) ?? 0;
    if (rankA < rankB) {
      this.parent.set(ra, rb);
    } else if (rankA > rankB) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Deduplicate items by semantic similarity using Jaccard on tokenized content.
 * For pairs above the similarity threshold, keeps the higher-scored item.
 * Returns filtered array preserving original order of kept items.
 */
export function deduplicateBySimilarity<T extends DedupableItem>(
  items: T[],
  config: Partial<SemanticDedupConfig> = {},
): DedupedItem<T>[] {
  const resolved: SemanticDedupConfig = {
    ...DEFAULT_SEMANTIC_DEDUP_CONFIG,
    ...config,
  };

  if (!resolved.enabled || items.length <= 1) {
    return items.map((item) => ({ ...item }));
  }

  const threshold = resolved.threshold;

  // Pre-tokenize all items
  const tokens: Map<string, Set<string>> = new Map();
  for (const item of items) {
    tokens.set(item.id, tokenize(item.content));
  }

  // Build merge groups via union-find
  const uf = new UnionFind();
  const ids = items.map((i) => i.id);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const sim = jaccardSimilarity(tokens.get(ids[i])!, tokens.get(ids[j])!);
      if (sim >= threshold) {
        uf.union(ids[i], ids[j]);
      }
    }
  }

  // Group items by their root
  const groups: Map<string, T[]> = new Map();
  for (const item of items) {
    const root = uf.find(item.id);
    let group = groups.get(root);
    if (!group) {
      group = [];
      groups.set(root, group);
    }
    group.push(item);
  }

  // For each group, pick the highest-scored item as representative
  const representativeIds: Set<string> = new Set();
  const mergedFromMap: Map<string, string[]> = new Map();

  for (const group of groups.values()) {
    // Sort by score descending to pick the best; break ties by original order
    const sorted = [...group].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return ids.indexOf(a.id) - ids.indexOf(b.id);
    });
    const winner = sorted[0];
    const losers = sorted.slice(1);
    representativeIds.add(winner.id);
    if (losers.length > 0) {
      mergedFromMap.set(winner.id, losers.map((l) => l.id));
    }
  }

  // Return items in original order, only representatives, with mergedFrom
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const result: DedupedItem<T>[] = [];

  for (const id of ids) {
    if (!representativeIds.has(id)) continue;
    const item = itemMap.get(id)!;
    const merged = mergedFromMap.get(id);
    if (merged && merged.length > 0) {
      result.push({ ...item, mergedFrom: merged });
    } else {
      result.push({ ...item });
    }
  }

  return result;
}
