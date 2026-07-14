/**
 * Domain strength calculator.
 *
 * Maps a PersonaDomainNode's signals (phase, depth, recurrence) into a single
 * 0..1 scalar used by the map renderer to size/colorize nodes.
 *
 * Formula (per spec):
 *   phaseWeight = { stable:1, revived:1, emergent:0.6, declining:0.3, dormant:0.1 }[phase ?? "stable"]
 *   depthNorm   = min(depth/5, 1)
 *   recNorm     = min(rec/10, 1)
 *   strength    = depthNorm*0.5 + recNorm*0.3 + phaseWeight*0.2
 *
 * Read-only / pure — no I/O.
 */
import type { InterestPhase, PersonaDomainNode } from "../types.js";

const PHASE_WEIGHT: Readonly<Record<InterestPhase, number>> = {
  stable: 1,
  revived: 1,
  emergent: 0.6,
  declining: 0.3,
  dormant: 0.1,
};

export function computeStrength(node: PersonaDomainNode): number {
  const phase: InterestPhase = node.phase ?? "stable";
  const phaseWeight = PHASE_WEIGHT[phase] ?? 1;

  const depth = node.depth ?? 0;
  const depthNorm = Math.min(depth / 5, 1);

  const rec = node.recurrence ?? node.evidenceCount ?? node.insights?.length ?? 0;
  const recNorm = Math.min(rec / 10, 1);

  const raw = depthNorm * 0.5 + recNorm * 0.3 + phaseWeight * 0.2;
  return Math.max(0, Math.min(1, raw));
}
