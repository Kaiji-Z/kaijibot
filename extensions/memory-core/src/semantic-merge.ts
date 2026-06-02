/**
 * Semantic topic merge — token-based grouping + LLM evaluation.
 *
 * Phase 1: tokenize each topic's slug + description → inverted index →
 *          union-find connected components.
 * Phase 2: one LLM call per component (≥2 topics) to decide merges.
 * Falls back to pure Jaccard when no LLM is available.
 */
import { jaccardSimilarity, tokenize } from "./memory/mmr.js";

// --- Types ---

export interface TopicForMerge {
  name: string;
  subject: string;
  entryCount: number;
  sampleContent: string;
}

export interface MergeCandidate {
  from: string;
  into: string;
  reason: string;
  confidence: number;
}

export interface SemanticMergeParams {
  topics: TopicForMerge[];
  generateText?: (prompt: string) => Promise<string>;
  llmThreshold?: number;
}

export interface SemanticMergeResult {
  merges: MergeCandidate[];
  groupsAnalyzed: number;
  llmCalls: number;
}

// --- Constants ---

const STOP_WORDS = new Set([
  "the", "and", "of", "a", "in", "to", "for", "with", "on", "at",
  "is", "it", "by", "an", "be", "this", "that", "are", "was", "or",
]);

const DEFAULT_LLM_THRESHOLD = 0.7;
const FALLBACK_JACCARD_THRESHOLD = 0.7;

// --- Helpers ---

/**
 * Compute Jaccard similarity between two topics using subject + sampleContent.
 * Used for fallback when no LLM is available.
 */
export function computeTopicJaccard(a: TopicForMerge, b: TopicForMerge): number {
  const textA = `${a.subject} ${a.sampleContent}`;
  const textB = `${b.subject} ${b.sampleContent}`;
  return jaccardSimilarity(tokenize(textA), tokenize(textB));
}

// --- Phase 1: Token-based grouping ---

function tokenizeTopic(topic: TopicForMerge): string[] {
  const slugTokens = topic.name.split("-").map((s) => s.toLowerCase());
  const descTokens = topic.subject.split(/\s+/).map((s) => s.toLowerCase());
  const combined = [...slugTokens, ...descTokens];
  const unique = new Set(combined);
  const filtered: string[] = [];
  for (const t of unique) {
    if (t.length > 0 && !STOP_WORDS.has(t)) {
      filtered.push(t);
    }
  }
  return filtered;
}

function buildInvertedIndex(topics: TopicForMerge[]): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>();
  for (let i = 0; i < topics.length; i++) {
    const tokens = tokenizeTopic(topics[i]!);
    for (const token of tokens) {
      let set = index.get(token);
      if (!set) {
        set = new Set<number>();
        index.set(token, set);
      }
      set.add(i);
    }
  }
  return index;
}

function findConnectedComponents(
  topics: TopicForMerge[],
  index: Map<string, Set<number>>,
): number[][] {
  const n = topics.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]!;
      x = parent[x]!;
    }
    return x;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent[ra] = rb;
    }
  }

  for (const indices of index.values()) {
    if (indices.size < 2) continue;
    const arr = [...indices];
    for (let i = 1; i < arr.length; i++) {
      union(arr[0]!, arr[i]!);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    let group = groups.get(root);
    if (!group) {
      group = [];
      groups.set(root, group);
    }
    group.push(i);
  }

  return [...groups.values()];
}

// --- Phase 2: LLM prompt & response parsing ---

function buildGroupMergePrompt(component: TopicForMerge[]): string {
  const topicBlocks = component
    .map(
      (t) =>
        `### "${t.name}" (subject: ${t.subject}, ${t.entryCount} entries)\n${t.sampleContent.slice(0, 200)}`,
    )
    .join("\n\n");

  return `You are evaluating whether any of these memory topics should be merged into one.

## Topics in this group
${topicBlocks}

Which topics should be merged? Consider semantic overlap:
- "feishu-api" and "feishu-bot" → YES, merge into "feishu"
- "philosophy" and "cooking" → NO, different domains

Reply with ONLY a JSON array of merge decisions. Empty array if none should merge:
[
  { "from": ["topic-a", "topic-b"], "into": "topic-c", "reason": "..." }
]
The "from" array contains topics to merge. The "into" is the target (must be one of the "from" topics, preferably the one with most entries). If only two topics merge, "from" has two elements.

Do not include markdown fences or commentary.`;
}

interface GroupMergeDecision {
  from: string[];
  into: string;
  reason: string;
}

function parseGroupMergeResponse(raw: string): GroupMergeDecision[] {
  let text = raw.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    text = fenceMatch[1]!.trim();
  }
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    const results: GroupMergeDecision[] = [];
    for (const item of parsed) {
      if (
        Array.isArray(item.from) &&
        item.from.length >= 2 &&
        typeof item.into === "string" &&
        typeof item.reason === "string"
      ) {
        results.push({ from: item.from, into: item.into, reason: item.reason });
      }
    }
    return results;
  } catch {
    return [];
  }
}

// --- Main function ---

/**
 * Identify topics to merge using token-based grouping + LLM evaluation.
 * Falls back to pure Jaccard when no generateText is provided.
 */
export async function semanticTopicMerge(
  params: SemanticMergeParams,
): Promise<SemanticMergeResult> {
  const { topics } = params;
  const llmThreshold = params.llmThreshold ?? DEFAULT_LLM_THRESHOLD;

  if (topics.length < 2) {
    return { merges: [], groupsAnalyzed: 0, llmCalls: 0 };
  }

  // No LLM → pure Jaccard fallback
  if (!params.generateText) {
    return jaccardFallback(topics, FALLBACK_JACCARD_THRESHOLD);
  }

  const generateText = params.generateText;

  // Phase 1: token-based grouping
  const index = buildInvertedIndex(topics);
  const components = findConnectedComponents(topics, index);

  // Phase 2: one LLM call per multi-topic component
  const merges: MergeCandidate[] = [];
  let groupsAnalyzed = 0;
  let llmCalls = 0;
  const nameMap = new Map(topics.map((t) => [t.name, t]));

  for (const component of components) {
    if (component.length < 2) continue;
    groupsAnalyzed++;
    llmCalls++;

    const componentTopics = component.map((i) => topics[i]!);
    let raw: string;
    try {
      raw = await generateText(buildGroupMergePrompt(componentTopics));
    } catch {
      continue;
    }

    const decisions = parseGroupMergeResponse(raw);

    for (const decision of decisions) {
      // Resolve topic names to objects, skip unknown names
      const fromTopics: TopicForMerge[] = [];
      for (const name of decision.from) {
        const t = nameMap.get(name);
        if (t) fromTopics.push(t);
      }
      if (fromTopics.length < 2) continue;

      const intoTopic = nameMap.get(decision.into);
      if (!intoTopic || !fromTopics.includes(intoTopic)) continue;

      // Each non-target topic merges INTO the target
      for (const topic of fromTopics) {
        if (topic === intoTopic) continue;
        merges.push({
          from: topic.name,
          into: intoTopic.name,
          reason: decision.reason,
          confidence: llmThreshold,
        });
      }
    }
  }

  return { merges, groupsAnalyzed, llmCalls };
}

// --- Jaccard fallback (no LLM) ---

function jaccardFallback(
  topics: TopicForMerge[],
  threshold: number,
): SemanticMergeResult {
  const merges: MergeCandidate[] = [];

  for (let i = 0; i < topics.length; i++) {
    for (let j = i + 1; j < topics.length; j++) {
      const a = topics[i]!;
      const b = topics[j]!;
      const sim = computeTopicJaccard(a, b);
      if (sim >= threshold) {
        const [from, into] = a.entryCount >= b.entryCount ? [b, a] : [a, b];
        merges.push({
          from: from.name,
          into: into.name,
          reason: `Jaccard similarity ${sim.toFixed(2)}`,
          confidence: sim,
        });
      }
    }
  }

  return { merges, groupsAnalyzed: 0, llmCalls: 0 };
}
