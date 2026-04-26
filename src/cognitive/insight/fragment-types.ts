import { randomUUID } from "node:crypto";

// ─── Fragment ───

export type FragmentKind =
  | "assumption"
  | "unresolved_tension"
  | "methodological_habit"
  | "knowledge_gap"
  | "implicit_priority"
  | "contradictory_positions";

export type Fragment = {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  kind: FragmentKind;
  evidence: string;
  domains: string[];
  structuralTag: string;
  strength: number;
};

// ─── FragmentCluster ───

export type FragmentCluster = {
  id: string;
  fragmentIds: string[];
  domains: string[];
  structuralPattern: string;
  averageStrength: number;
  createdAt: number;
};

// ─── BlindSpotCandidate ───

export type BlindSpotCandidate = {
  id: string;
  blindSpot: string;
  supportingFragmentIds: string[];
  potentialImpact:
    | "direction_change"
    | "efficiency_gain"
    | "risk_avoidance"
    | "connection_reveal";
  domains: string[];
  unusedDomains: string[];
  crystallizationScore: number;
  // lifecycle tracking
  createdAt?: number;
  expiresAt?: number;
};

// ─── QualityAssessment ───

export type QualityAssessment = {
  structuralNovelty: number;
  actionability: number;
  emotionalReadiness: number;
  nonObviousness: number;
  composite: number;
  verdict: "deliver" | "park" | "discard";
};

export const QUALITY_PILLAR_WEIGHTS = {
  structuralNovelty: 0.20,
  actionability: 0.25,
  emotionalReadiness: 0.15,
  nonObviousness: 0.40,
} as const;

// ─── ParkedBlindSpot ───

export type ParkedBlindSpot = BlindSpotCandidate & {
  parkedAt: number;
  reassessmentCount: number;
};

// ─── File Format ───

export type FragmentStoreFile = {
  version: 1;
  fragments: Fragment[];
};

// ─── Constants ───

export const FRAGMENT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// ─── Helper Functions ───

export function computeQualityVerdict(composite: number): "deliver" | "park" | "discard" {
  if (composite >= 0.75) return "deliver";
  if (composite >= 0.60) return "park";
  return "discard";
}

export function computeComposite(
  assessment: Omit<QualityAssessment, "composite" | "verdict">,
): number {
  return (
    assessment.structuralNovelty * QUALITY_PILLAR_WEIGHTS.structuralNovelty +
    assessment.actionability * QUALITY_PILLAR_WEIGHTS.actionability +
    assessment.emotionalReadiness * QUALITY_PILLAR_WEIGHTS.emotionalReadiness +
    assessment.nonObviousness * QUALITY_PILLAR_WEIGHTS.nonObviousness
  );
}

export function isFragmentExpired(fragment: Fragment, now?: number): boolean {
  return (now ?? Date.now()) > fragment.expiresAt;
}

export function createDefaultFragment(
  overrides: Partial<Fragment> & Pick<Fragment, "userId" | "kind" | "evidence" | "domains" | "structuralTag">,
): Fragment {
  const createdAt = Date.now();
  return {
    id: randomUUID(),
    createdAt,
    expiresAt: createdAt + FRAGMENT_TTL_MS,
    strength: 0.5,
    ...overrides,
  };
}

export function computeFragmentDecay(fragment: Fragment, now?: number): number {
  const current = now ?? Date.now();
  const elapsed = current - fragment.createdAt;
  if (elapsed >= FRAGMENT_TTL_MS) return 0;
  return Math.max(0, fragment.strength * (1 - elapsed / FRAGMENT_TTL_MS));
}
