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
  /** Aggregate usage across all agents (populated by /api/fleet). */
  readonly usage?: {
    readonly totalTokens: number;
    readonly estimatedCostUsd: number;
    readonly totalToolCalls: number;
  };
  /** Aggregate cognitive store stats (populated by /api/fleet). */
  readonly cognitive?: {
    readonly domains: number;
    readonly insights: number;
    readonly corrections: number;
    readonly skills: number;
  };
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
