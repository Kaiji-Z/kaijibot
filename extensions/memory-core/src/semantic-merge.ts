/**
 * Semantic topic merge — Jaccard pre-filter + LLM confirmation.
 *
 * Identifies pairs of memory topics that should be consolidated by first
 * filtering with cheap Jaccard similarity, then confirming with LLM judgment.
 */

import { jaccardSimilarity, tokenize } from "./memory/mmr.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  generateText: (prompt: string) => Promise<string>;
  jaccardPreFilter?: number;
  llmThreshold?: number;
}

export interface SemanticMergeResult {
  merges: MergeCandidate[];
  skipped: number;
  llmCalls: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_JACCARD_PRE_FILTER = 0.3;
const DEFAULT_LLM_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute Jaccard similarity between two topics using subject + sampleContent.
 */
export function computeTopicJaccard(a: TopicForMerge, b: TopicForMerge): number {
  const textA = `${a.subject} ${a.sampleContent}`;
  const textB = `${b.subject} ${b.sampleContent}`;
  return jaccardSimilarity(tokenize(textA), tokenize(textB));
}

// ---------------------------------------------------------------------------
// LLM prompt builder
// ---------------------------------------------------------------------------

function buildMergePrompt(topicA: TopicForMerge, topicB: TopicForMerge): string {
  return `You are evaluating whether two memory topics should be merged into one.

## Topic A: "${topicA.name}"
Subject: ${topicA.subject}
Sample content: ${topicA.sampleContent.slice(0, 300)}

## Topic B: "${topicB.name}"
Subject: ${topicB.subject}
Sample content: ${topicB.sampleContent.slice(0, 300)}

Should these topics be merged? Consider:
- Do they cover the same domain or closely related domains?
- Would merging lose important distinction?
- "feishu-api" and "feishu-bot" → YES, merge
- "philosophy" and "cooking" → NO, don't merge

Reply with ONLY a JSON object:
{ "shouldMerge": true/false, "confidence": 0.0-1.0, "reason": "brief explanation" }

Do not include markdown fences or commentary.`;
}

// ---------------------------------------------------------------------------
// JSON parsing with code-fence stripping
// ---------------------------------------------------------------------------

function parseMergeResponse(
  raw: string,
): { shouldMerge: boolean; confidence: number; reason: string } | null {
  let text = raw.trim();
  // Strip markdown code fences
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    text = fenceMatch[1]!.trim();
  }
  try {
    const parsed = JSON.parse(text);
    if (
      typeof parsed.shouldMerge === "boolean" &&
      typeof parsed.confidence === "number" &&
      typeof parsed.reason === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Identify topic pairs to merge using a two-phase pipeline:
 *   Phase 1 — Jaccard pre-filter (cheap, local)
 *   Phase 2 — LLM confirmation (expensive, remote)
 */
export async function semanticTopicMerge(
  params: SemanticMergeParams,
): Promise<SemanticMergeResult> {
  const { topics, generateText } = params;
  const jaccardThreshold = params.jaccardPreFilter ?? DEFAULT_JACCARD_PRE_FILTER;
  const llmThreshold = params.llmThreshold ?? DEFAULT_LLM_THRESHOLD;

  const merges: MergeCandidate[] = [];
  let skipped = 0;
  let llmCalls = 0;

  if (topics.length < 2) {
    return { merges, skipped: 0, llmCalls: 0 };
  }

  // Phase 1: collect candidate pairs via Jaccard pre-filter
  const candidates: Array<{ a: TopicForMerge; b: TopicForMerge }> = [];

  for (let i = 0; i < topics.length; i++) {
    for (let j = i + 1; j < topics.length; j++) {
      const a = topics[i]!;
      const b = topics[j]!;
      const sim = computeTopicJaccard(a, b);
      if (sim >= jaccardThreshold) {
        candidates.push({ a, b });
      } else {
        skipped++;
      }
    }
  }

  // Phase 2: LLM confirmation for each candidate
  for (const { a, b } of candidates) {
    llmCalls++;
    let raw: string;
    try {
      raw = await generateText(buildMergePrompt(a, b));
    } catch {
      // LLM failure — skip this pair
      continue;
    }

    const parsed = parseMergeResponse(raw);
    if (!parsed) {
      continue;
    }

    if (parsed.shouldMerge && parsed.confidence >= llmThreshold) {
      // Merge smaller INTO larger (preserves topic with more history)
      const [from, into] = a.entryCount >= b.entryCount ? [b, a] : [a, b];
      merges.push({
        from: from.name,
        into: into.name,
        reason: parsed.reason,
        confidence: parsed.confidence,
      });
    }
  }

  return { merges, skipped, llmCalls };
}
