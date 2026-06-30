/**
 * Shared types for the Kindle Portal extension.
 *
 * These types are local to the extension and are intentionally narrow — they
 * do not leak into the Plugin SDK surface. HTTP handlers, monitor state, map
 * builder, and PNG renderer all consume these.
 *
 * NOTE: `KindleConfig` lives in `./config.ts` because it is closely coupled
 * to the zod schema there. Re-export from this file is intentionally omitted
 * to avoid a circular type dependency.
 */

/**
 * Per-run record maintained by FleetState.
 *
 * Lifecycle: created on `lifecycle.start`, updated on item/tool/assistant
 * events, terminal on `lifecycle.end` or `error`, pruned after TTL.
 */
export interface FleetAgent {
  readonly runId: string;
  readonly sessionKey?: string;
  readonly agentId?: string;
  readonly userId?: string;
  readonly status: "thinking" | "tool_calling" | "completed" | "failed";
  readonly model?: string;
  readonly provider?: string;
  readonly toolName?: string;
  readonly toolCallCount: number;
  readonly startedAt: number;
  readonly lastEventAt: number;
  /** Flagged when no events observed for `staleAfterMs`. UI shows degraded tint. */
  readonly stale?: boolean;
  /** Stop reason captured from lifecycle.end or error. */
  readonly stopReason?: string;
  // — Enrichment fields populated by snapshot-source from the session store —
  readonly sessionLabel?: string;
  readonly totalTokens?: number;
  readonly estimatedCostUsd?: number;
}

/**
 * A registered agent (from `kaijibot.json` → `agents.list`), enriched with
 * session-store-derived stats. The monitor dashboard always shows every
 * registered agent, even when none have active runs.
 */
export interface RegisteredAgent {
  readonly id: string;
  readonly model: string;
  readonly isDefault: boolean;
  readonly status: "active" | "idle";
  readonly runStatus?: "thinking" | "tool_calling" | "completed" | "failed";
  readonly lastActiveAt?: number;
  readonly sessionCount: number;
  readonly contextUsed?: number;
  readonly contextMax?: number;
}

/**
 * Cumulative + today token/cost usage, computed by scanning JSONL session
 * files (see `monitor/usage-reader.ts`).
 */
export interface UsageSummary {
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly sessionCount: number;
  readonly todayTokens: number;
  readonly todayCostUsd: number;
  readonly todaySessions: number;
}

/**
 * Provider account quota usage (see `monitor/quota-reader.ts`).
 * Currently only ZAI is supported.
 */
export interface QuotaWindow {
  readonly label: string;
  readonly usedPercent: number;
  readonly resetAt?: number;
}

export interface ProviderQuota {
  readonly provider: string;
  readonly displayName: string;
  readonly plan?: string;
  readonly windows: readonly QuotaWindow[];
  readonly error?: string;
}

/**
 * Aggregate cognitive store stats (populated by /api/fleet). Surfaced for the
 * map page; the monitor dashboard no longer displays these directly.
 */
export interface CognitiveStats {
  readonly domains: number;
  readonly insights: number;
  readonly corrections: number;
  readonly skills: number;
}

/**
 * Snapshot returned by `/kindle/api/fleet`.
 *
 * Under Option A (pure plugin boundary), `lanes` is always empty and
 * `laneSupport` is "unavailable" because the queue/lane singletons live in
 * core and are not exposed via the Plugin SDK.
 */
export interface FleetSnapshot {
  readonly agents: readonly FleetAgent[];
  readonly lanes: readonly never[];
  readonly laneSupport: "unavailable";
  readonly idle: boolean;
  readonly generatedAt: number;
  /** PNG renderer capability flag, surfaced for operator visibility. */
  readonly pngCapability?: PngCapability;
  /** Cumulative + today usage from JSONL scanning (populated by /api/fleet). */
  readonly usage?: UsageSummary;
  /** Provider quota usage (populated by /api/fleet). `null` when unavailable. */
  readonly providerQuota?: ProviderQuota | null;
  /** Aggregate cognitive store stats (populated by /api/fleet). */
  readonly cognitive?: CognitiveStats;
  /**
   * All registered agents from config (populated by /api/fleet and the
   * monitor page). Always present in the enriched snapshot; absent in
   * bare test snapshots for backward compatibility.
   */
  readonly registeredAgents?: readonly RegisteredAgent[];
}

/**
 * Node in the cognitive map graph.
 *
 * - `domain`: from PersonaStore (user's interest domain)
 * - `concept` / `entity`: from knowledge-wiki vault (supplementary layer)
 */
export interface MapNode {
  readonly id: string;
  readonly label: string;
  readonly kind: "domain" | "concept" | "entity";
  /** 0..1, computed by `computeStrength` for domains; 0.5 default for wiki nodes. */
  readonly strength: number;
  readonly phase?: InterestPhase;
  readonly insightCount?: number;
}

/** Edge in the cognitive map graph (cross-domain or wiki-persona overlap). */
export interface MapEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

/**
 * Complete cognitive map graph, ready for PNG rendering.
 */
export interface MapGraph {
  readonly nodes: readonly MapNode[];
  readonly edges: readonly MapEdge[];
  /** Present when the domain count exceeded `maxDomains`. */
  readonly truncated?: { readonly shown: number; readonly total: number };
  /** Present when wiki was expected but missing/empty. */
  readonly warning?: string;
}

/**
 * PNG renderer capability, indicating which tier produced the image.
 * - `graphviz-dot`: native `dot` binary (best quality, native fonts)
 * - `viz-js-wasm`: `@viz-js/viz` WASM fallback (no binary dep)
 * - `handrolled-svg`: last-resort inline SVG string (degraded labels)
 * - `unknown`: not yet probed
 */
export type PngCapability = "graphviz-dot" | "viz-js-wasm" | "handrolled-svg" | "unknown";

/**
 * Interest lifecycle phase for a persona domain.
 * Mirrors `InterestPhase` from `src/cognitive/types.ts` (core-internal).
 */
export type InterestPhase = "emergent" | "stable" | "declining" | "dormant" | "revived";

/**
 * Lint issue produced by `lintKindleHtml` for ES5/old-WebKit compatibility.
 */
export interface LintIssue {
  readonly line: number;
  readonly token: string;
  readonly message: string;
}

/**
 * Minimal subset of PersonaStore's DomainNode used by the map builder.
 *
 * This is a structural type — actual PersonaStore DomainNode has additional
 * fields we don't need. We accept any object with this shape.
 */
export interface PersonaDomainNode {
  readonly phase?: InterestPhase;
  readonly insights?: readonly { readonly category?: string }[];
  readonly keyInsights?: readonly unknown[];
  /** Depth signal (optional, may not be present on all personas). */
  readonly depth?: number;
  /** Recurrence/evidence count signal (optional). */
  readonly recurrence?: number;
  readonly evidenceCount?: number;
  readonly confidence?: number;
}

/**
 * Minimal subset of PersonaTree used by the map builder.
 */
export interface PersonaTree {
  readonly identity?: { readonly displayName?: string };
  readonly coreTraits?: Record<string, unknown>;
  readonly domains: Record<string, PersonaDomainNode>;
}

/**
 * Wiki node extracted from knowledge-wiki entities/concepts markdown.
 */
export interface WikiNode {
  readonly id: string;
  readonly label: string;
  readonly kind: "entity" | "concept";
}

/**
 * Wiki edge extracted from `[[wikilinks]]` in knowledge-wiki pages.
 */
export interface WikiEdge {
  readonly from: string;
  readonly to: string;
}
