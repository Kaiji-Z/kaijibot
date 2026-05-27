/**
 * Route extracted items to the correct stores.
 *
 * Routing logic:
 * - domain_knowledge + stated_preference + goal_or_aspiration → persona (TypedInsight)
 * - behavioral_pattern → fragment store
 * - High-confidence items with correction evidence → correction store
 * - All items (deduped summary) → daily memory file
 *
 * All store operations use (agentId, userId) dual-key isolation.
 */

import type { ExtractedItem, RouteItem } from "./consolidation-types.js";

/** Brief correction record for the correction store. */
export type CorrectionRecord = {
  domain: string;
  trigger: string;
  mistake: string;
  correction: string;
  provenance: "consolidation";
};

/** Dependencies injected from the orchestrator — no direct imports from core. */
export type ConsolidationRouteDeps = {
  mergeTypedInsights: (
    agentId: string,
    userId: string,
    items: ExtractedItem[],
  ) => Promise<number>;
  addOrReinforceCorrection: (
    agentId: string,
    userId: string,
    record: CorrectionRecord,
  ) => Promise<string>;
  appendToMemoryFile: (workspaceDir: string, content: string) => Promise<void>;
  collectFragment: (
    agentId: string,
    userId: string,
    fragment: { text: string; strength: number; domains?: string[] },
  ) => Promise<void>;
  /** Write high-confidence extracted items to MEMORY.md inline sections. */
  updateMemoryIndex: (params: {
    workspaceDir: string;
    items: ExtractedItem[];
    date: string;
  }) => Promise<void>;
};

const CORRECTION_KEYWORDS = [
  "wrong",
  "mistake",
  "incorrect",
  "should be",
  "actually",
  "fixed",
  "correction",
  "not correct",
  "搞错",
  "错误",
  "不对",
  "应该是",
  "修正",
  "改错",
  "不对",
];

function looksLikeCorrection(evidence: string): boolean {
  const lower = evidence.toLowerCase();
  return CORRECTION_KEYWORDS.some((keyword) => lower.includes(keyword));
}

const CATEGORY_TO_SECTION: Record<string, string> = {
  domain_knowledge: "👤 User",
  stated_preference: "👤 User",
  goal_or_aspiration: "🎯 Active Focus",
  behavioral_pattern: "👤 User",
};

/**
 * Route extracted items to the appropriate stores.
 */
export async function routeToStores(params: {
  items: RouteItem[];
  workspaceDir: string;
  deps: ConsolidationRouteDeps;
}): Promise<{ routed: number; errors: string[] }> {
  const { items, workspaceDir, deps } = params;
  const errors: string[] = [];
  let routed = 0;

  if (items.length === 0) {
    return { routed: 0, errors };
  }

  // Group by (agentId, userId) for batch persona writes
  const personaGroups = new Map<string, { agentId: string; userId: string; items: ExtractedItem[] }>();
  const memorySummaryLines: string[] = [];

  for (const routeItem of items) {
    const { agentId, userId, item } = routeItem;
    const groupKey = `${agentId}:${userId}`;

    // Route to persona store: domain_knowledge, stated_preference, goal_or_aspiration
    if (
      item.category === "domain_knowledge" ||
      item.category === "stated_preference" ||
      item.category === "goal_or_aspiration"
    ) {
      const group = personaGroups.get(groupKey) ?? { agentId, userId, items: [] };
      group.items.push(item);
      personaGroups.set(groupKey, group);
    }

    // Route behavioral_pattern → fragment store
    if (item.category === "behavioral_pattern") {
      try {
        await deps.collectFragment(agentId, userId, {
          text: item.content,
          strength: item.confidence,
          domains: item.domain ? [item.domain] : [],
        });
        routed += 1;
      } catch (err) {
        errors.push(`Failed to route fragment for ${agentId}/${userId}: ${String(err)}`);
      }
    }

    // Route high-confidence corrections → correction store
    if (item.confidence >= 0.9 && looksLikeCorrection(item.evidence)) {
      try {
        await deps.addOrReinforceCorrection(agentId, userId, {
          domain: item.domain || item.category,
          trigger: item.evidence,
          mistake: item.evidence,
          correction: item.content,
          provenance: "consolidation",
        });
        routed += 1;
      } catch (err) {
        errors.push(`Failed to route correction for ${agentId}/${userId}: ${String(err)}`);
      }
    }

    memorySummaryLines.push(`- ${item.content}`);
  }

  // Batch persona writes
  for (const group of personaGroups.values()) {
    try {
      const count = await deps.mergeTypedInsights(group.agentId, group.userId, group.items);
      routed += count;
    } catch (err) {
      errors.push(
        `Failed to route persona insights for ${group.agentId}/${group.userId}: ${String(err)}`,
      );
    }
  }

  // Write high-confidence items to MEMORY.md inline sections
  const highConfidenceItems = items.filter((ri) => {
    if (ri.item.confidence < 0.7) return false;
    if (ri.item.category === "behavioral_pattern" && ri.item.confidence < 0.8) return false;
    return ri.item.category in CATEGORY_TO_SECTION;
  });
  if (highConfidenceItems.length > 0) {
    try {
      await deps.updateMemoryIndex({
        workspaceDir,
        items: highConfidenceItems.map((ri) => ri.item),
        date: new Date().toISOString().slice(0, 10),
      });
    } catch (err) {
      errors.push(`Failed to update MEMORY.md for ${workspaceDir}: ${String(err)}`);
    }
  }

  // Append deduped summary to daily memory file
  if (memorySummaryLines.length > 0) {
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const summary = `\n## Consolidation Summary (${dateStr})\n${memorySummaryLines.join("\n")}\n`;
      await deps.appendToMemoryFile(workspaceDir, summary);
    } catch (err) {
      errors.push(`Failed to append memory file for ${workspaceDir}: ${String(err)}`);
    }
  }

  return { routed, errors };
}
