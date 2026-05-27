/**
 * LLM-driven extraction from session transcripts.
 *
 * This is the only file in the consolidation pipeline that calls LLM.
 * The `generateText` callback is injected — extensions must NOT import LLM
 * utilities from core directly.
 */

import type { ExtractedItem, ConflictResolution, TranscriptBatch } from "./consolidation-types.js";

const EXTRACTION_PROMPT = `You are a memory consolidation assistant. Analyze the following session transcript and extract structured knowledge items.

For each item, provide:
- category: One of "domain_knowledge", "behavioral_pattern", "stated_preference", "goal_or_aspiration"
- content: A concise summary of the knowledge (1-2 sentences)
- confidence: Your confidence level from 0.0 to 1.0
- evidence: A brief quote from the transcript that supports this extraction
- domain: A short noun phrase identifying the knowledge domain (e.g. "TypeScript", "分布式系统设计", "Kubernetes", "AI Agent架构"). Use 2-6 words. Be specific, not generic (NOT "technology" or "programming").

Rules:
- Extract domain_knowledge for facts, concepts, and technical details the user discussed
- Extract behavioral_pattern for how the user approaches problems or their communication style
- Extract stated_preference for explicit likes, dislikes, or preferences stated by the user
- Extract goal_or_aspiration for things the user wants to achieve or work toward
- Do NOT extract tool_config or contextual_fact categories
- The domain field should identify the subject area, not the category
- Each item must have a direct quote as evidence
- Be conservative: only extract items with confidence >= 0.5
- Return a JSON array of items, or an empty array if nothing worth extracting

Transcript:
`;

const JACCARD_THRESHOLD = 0.7;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 0),
  );
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) {
    return 1;
  }
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function parseExtractedItems(raw: string): ExtractedItem[] {
  const trimmed = raw.trim();
  // Strip markdown code fences if present
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  const jsonText = fenceMatch ? fenceMatch[1]! : trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const validCategories = new Set<string>([
    "domain_knowledge",
    "behavioral_pattern",
    "stated_preference",
    "goal_or_aspiration",
  ]);

  const items: ExtractedItem[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const category = typeof record.category === "string" ? record.category : "";
    const content = typeof record.content === "string" ? record.content.trim() : "";
    const confidence = Number(record.confidence);
    const evidence = typeof record.evidence === "string" ? record.evidence.trim() : "";
    const domain = typeof record.domain === "string" ? record.domain.trim() : undefined;

    if (
      !validCategories.has(category) ||
      content.length === 0 ||
      !Number.isFinite(confidence) ||
      confidence < 0.5 ||
      confidence > 1 ||
      evidence.length === 0
    ) {
      continue;
    }

    items.push({
      category: category as ExtractedItem["category"],
      content,
      confidence,
      source: "transcript",
      evidence,
      domain: domain && domain.length > 0 ? domain : undefined,
    });
  }
  return items;
}

/**
 * Extract structured knowledge items from a batch of session transcripts using LLM.
 */
export async function extractFromBatch(
  batch: TranscriptBatch,
  generateText: (prompt: string) => Promise<string>,
): Promise<ExtractedItem[]> {
  if (batch.files.length === 0) {
    return [];
  }

  const transcriptSections = batch.files
    .map((file) => `--- File: ${file.path} ---\n${file.content}`)
    .join("\n\n");

  const prompt = `${EXTRACTION_PROMPT}${transcriptSections}`;

  const raw = await generateText(prompt);
  return parseExtractedItems(raw);
}

/**
 * Merge items from multiple batches, deduplicating by content similarity within
 * each category. Keeps the highest-confidence version.
 */
export function mergeAndDedupBatches(batches: ExtractedItem[][]): ExtractedItem[] {
  const all = batches.flat();
  if (all.length === 0) {
    return [];
  }

  // Group by category
  const byCategory = new Map<string, ExtractedItem[]>();
  for (const item of all) {
    const group = byCategory.get(item.category) ?? [];
    group.push(item);
    byCategory.set(item.category, group);
  }

  const result: ExtractedItem[] = [];
  for (const items of byCategory.values()) {
    // Dedup within category by Jaccard similarity
    const kept: ExtractedItem[] = [];
    for (const item of items) {
      const duplicateIndex = kept.findIndex(
        (existing) => jaccardSimilarity(existing.content, item.content) >= JACCARD_THRESHOLD,
      );
      if (duplicateIndex >= 0) {
        // Keep the higher confidence version
        if (item.confidence > kept[duplicateIndex]!.confidence) {
          kept[duplicateIndex] = item;
        }
      } else {
        kept.push(item);
      }
    }
    result.push(...kept);
  }
  return result;
}

/**
 * Detect contradictions (same topic, different claims) and resolve them.
 * Keeps the higher-confidence version.
 */
export function resolveConflicts(items: ExtractedItem[]): {
  resolved: ExtractedItem[];
  conflicts: ConflictResolution[];
} {
  if (items.length === 0) {
    return { resolved: items, conflicts: [] };
  }

  const conflicts: ConflictResolution[] = [];
  const resolved: ExtractedItem[] = [];
  const discarded = new Set<number>();

  // Compare items within the same category for contradictions
  for (let i = 0; i < items.length; i++) {
    if (discarded.has(i)) {
      continue;
    }
    for (let j = i + 1; j < items.length; j++) {
      if (discarded.has(j)) {
        continue;
      }
      if (items[i]!.category !== items[j]!.category) {
        continue;
      }
      const similarity = jaccardSimilarity(items[i]!.content, items[j]!.content);
      // Contradiction: similar topic (medium overlap) but different claims
      if (similarity >= 0.3 && similarity < JACCARD_THRESHOLD) {
        const kept = items[i]!.confidence >= items[j]!.confidence ? i : j;
        const dropped = kept === i ? j : i;
        discarded.add(dropped);
        conflicts.push({
          kept: items[kept]!,
          discarded: items[dropped]!.content,
          reason: `Contradicting claims with same topic (similarity=${similarity.toFixed(2)}). Kept higher confidence (${items[kept]!.confidence.toFixed(2)} vs ${items[dropped]!.confidence.toFixed(2)}).`,
        });
      }
    }
  }

  for (let i = 0; i < items.length; i++) {
    if (!discarded.has(i)) {
      resolved.push(items[i]!);
    }
  }

  return { resolved, conflicts };
}
