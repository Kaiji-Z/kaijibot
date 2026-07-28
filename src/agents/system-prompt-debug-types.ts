/**
 * Context layer classification.
 *
 * - L1: Hardcoded system prompt sections (Capabilities, Tooling, Safety, etc.)
 * - L2: User-authored workspace files (AGENTS.md, SOUL.md, MEMORY.md, etc.)
 * - L3: Auto-extracted cognitive state (persona, corrections, evolution, mode)
 *
 * See `.omo/research/context-engineering.md` for the full mapping and
 * `.omo/plans/context-engineering-optimization.md` Wave 1 for the rationale.
 */
export type ContextLayer = "L1" | "L2" | "L3";
