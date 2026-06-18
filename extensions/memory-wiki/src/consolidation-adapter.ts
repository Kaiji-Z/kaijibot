import type { CreateSynthesisMemoryWikiMutation } from "./apply.js";
import type { WikiClaim } from "./markdown.js";

export type WikiConsolidationInput = {
  readonly category: string;
  readonly domains: readonly string[];
  readonly content: string;
  readonly confidence: number;
  readonly source?: string;
  readonly evidence?: readonly string[];
};

export type MapOptions = {
  readonly minConfidence?: number;
  readonly date?: string;
  readonly maxPages?: number;
};

export function mapConsolidationItemsToWikiSynthesis(
  items: readonly WikiConsolidationInput[],
  opts?: MapOptions,
): CreateSynthesisMemoryWikiMutation[] {
  const minConfidence = opts?.minConfidence ?? 0.7;
  const date = opts?.date ?? new Date().toISOString().slice(0, 10);
  const maxPages = opts?.maxPages ?? 20;

  const eligible = items.filter((item) => item.confidence >= minConfidence);
  if (eligible.length === 0) return [];

  const groups = new Map<string, WikiConsolidationInput[]>();
  for (const item of eligible) {
    const key = item.domains[0] ?? "general";
    const arr = groups.get(key);
    if (arr) {
      arr.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  const mutations: CreateSynthesisMemoryWikiMutation[] = [];
  for (const [domain, groupItems] of groups) {
    if (mutations.length >= maxPages) break;

    const slug = domain
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const title = `${domain} — ${date}`;
    const sourceId = `consolidation:${date}:${slug}`;

    const body = groupItems
      .map((item) => {
        const evidenceText =
          item.evidence && item.evidence.length > 0
            ? `\n\n**Evidence:**\n${item.evidence.map((e) => `- ${e}`).join("\n")}`
            : "";
        return `#### ${item.content}${evidenceText}`;
      })
      .join("\n\n");

    const claims: WikiClaim[] = groupItems.slice(0, 10).map((item) => ({
      text: item.content,
      confidence: item.confidence,
      status: "active",
      evidence: item.evidence
        ? item.evidence.map((e) => ({ note: e }))
        : [],
    }));

    const pageConfidence = Math.max(...groupItems.map((i) => i.confidence));

    mutations.push({
      op: "create_synthesis",
      title,
      body,
      sourceIds: [sourceId],
      claims,
      confidence: pageConfidence,
      status: "active",
    });
  }

  return mutations;
}
