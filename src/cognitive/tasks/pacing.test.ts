import { describe, expect, it } from "vitest";
import type {
  FeedbackProfile,
  PersonaTree,
  RapportMetrics,
  UserLifecycle,
  UserLifecycleStage,
} from "../types.js";
import { evaluateTaskCreationGate, TASK_LEDGER_TRUST_FLOOR } from "./pacing.js";

function persona(
  overrides?: Partial<{
    consecutiveNoResponses: number | undefined;
    trustScore: number;
    suppressUntil: number | undefined;
    stage: UserLifecycleStage;
  }>,
): Pick<PersonaTree, "feedbackProfile" | "rapport" | "lifecycle"> {
  const feedbackProfile: FeedbackProfile = {
    topicBandits: {},
    optimalFrequencyHours: 48,
    lastProactiveAt: 0,
    recentInsightIds: [],
    recentInsightContents: [],
    ...(overrides?.consecutiveNoResponses !== undefined
      ? { consecutiveNoResponses: overrides.consecutiveNoResponses }
      : {}),
    ...(overrides?.suppressUntil !== undefined ? { suppressUntil: overrides.suppressUntil } : {}),
  };
  const rapport: RapportMetrics = {
    trustScore: overrides?.trustScore ?? 0.9,
    totalExchanges: 50,
    avgResponseLength: 100,
    selfDisclosureLevel: 0.5,
  };
  const lifecycle: UserLifecycle = {
    stage: overrides?.stage ?? "active",
    lastActiveAt: 0,
    lastStageTransitionAt: 0,
    totalActiveDays: 30,
  };
  return { feedbackProfile, rapport, lifecycle };
}

describe("evaluateTaskCreationGate (T3)", () => {
  const NOW = 1_700_000_000_000;

  it("allows task creation at ledger U below the cap", () => {
    expect(evaluateTaskCreationGate(persona({ consecutiveNoResponses: 2 }), NOW)).toEqual({
      allowed: true,
    });
    expect(evaluateTaskCreationGate(persona({ consecutiveNoResponses: 0 }), NOW)).toEqual({
      allowed: true,
    });
  });

  it("rejects task creation at ledger U >= 3 for trusted users (insight hard-veto parity)", () => {
    const result = evaluateTaskCreationGate(
      persona({ consecutiveNoResponses: 3, trustScore: 0.9 }),
      NOW,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("cap 3");
  });

  it("uses the tighter cap of 2 for low-trust users", () => {
    const result = evaluateTaskCreationGate(
      persona({ consecutiveNoResponses: 2, trustScore: TASK_LEDGER_TRUST_FLOOR - 0.01 }),
      NOW,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("cap 2");
    // High trust with U=2 is still allowed — the floor itself doesn't veto.
    expect(
      evaluateTaskCreationGate(
        persona({ consecutiveNoResponses: 2, trustScore: TASK_LEDGER_TRUST_FLOOR }),
        NOW,
      ).allowed,
    ).toBe(true);
  });

  it("rejects while the suppression window is active, and allows after it expires", () => {
    const active = evaluateTaskCreationGate(persona({ suppressUntil: NOW + 60_000 }), NOW);
    expect(active.allowed).toBe(false);
    expect(active.reason).toContain("suppression");

    const expired = evaluateTaskCreationGate(persona({ suppressUntil: NOW - 1 }), NOW);
    expect(expired.allowed).toBe(true);
  });
});
