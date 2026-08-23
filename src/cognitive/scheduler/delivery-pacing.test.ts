import { describe, it, expect } from "vitest";
import { createDefaultPersona } from "../persona/store.js";
import type { PersonaTree } from "../types.js";
import {
  checkDailyBudget,
  bumpDailySend,
  checkStochasticSpacing,
  MIN_SEND_GAP_H,
} from "./delivery-pacing.js";

const DAY_MS = 24 * 3_600_000;
const HR = 3_600_000;
// Mid-day anchor so +3h stays inside the same UTC day in every test.
const T0 = Math.floor(1_700_000_005_000 / DAY_MS) * DAY_MS + 12 * HR;

function personaWith(overrides: Partial<PersonaTree["feedbackProfile"]> = {}): PersonaTree {
  const persona = createDefaultPersona();
  persona.feedbackProfile = {
    ...persona.feedbackProfile,
    optimalFrequencyHours: 24,
    ...overrides,
  };
  return persona;
}

describe("checkDailyBudget", () => {
  it("allows when no sends recorded", () => {
    expect(checkDailyBudget(personaWith(), T0, 2).allowed).toBe(true);
  });

  it("blocks at cap within the same UTC day", () => {
    const p = personaWith();
    bumpDailySend(p, T0);
    bumpDailySend(p, T0 + 3 * HR);
    expect(checkDailyBudget(p, T0 + 5 * HR, 2).allowed).toBe(false);
    expect(p.feedbackProfile.dailySendCount).toBe(2);
  });

  it("self-resets on day rollover", () => {
    const p = personaWith();
    bumpDailySend(p, T0);
    bumpDailySend(p, T0 + 3 * HR);
    expect(checkDailyBudget(p, T0 + DAY_MS + HR, 2).allowed).toBe(true);
    expect(checkDailyBudget(p, T0 + DAY_MS + HR, 2).reason).toBe("new day");
  });

  it("partial budget still allows", () => {
    const p = personaWith();
    bumpDailySend(p, T0);
    expect(checkDailyBudget(p, T0 + 5 * HR, 2).allowed).toBe(true);
  });
});

describe("checkStochasticSpacing", () => {
  const lastSend = T0;
  const activeAfterSend = lastSend + HR;

  it("first contact passes unconditionally", () => {
    expect(checkStochasticSpacing(personaWith(), "timer", T0, 0.99).allowed).toBe(true);
  });

  it("absolute floor blocks sub-hour gaps even conversationally", () => {
    const p = personaWith({ lastProactiveAt: lastSend });
    p.lifecycle.lastActiveAt = lastSend + 30 * 60_000;
    const verdict = checkStochasticSpacing(p, "persona_change", lastSend + 45 * 60_000, 0);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("floor");
  });

  it("conversational moment (persona_change + user active <2h) bypasses hazard", () => {
    const p = personaWith({ lastProactiveAt: lastSend });
    p.lifecycle.lastActiveAt = activeAfterSend;
    expect(checkStochasticSpacing(p, "persona_change", lastSend + 2 * HR, 0.99).allowed).toBe(true);
  });

  it("timer events never take the conversational bypass", () => {
    const p = personaWith({ lastProactiveAt: lastSend });
    p.lifecycle.lastActiveAt = activeAfterSend;
    expect(checkStochasticSpacing(p, "timer", lastSend + 2 * HR, 0.99).allowed).toBe(false);
  });

  it("hazard rises with elapsed time at fixed roll", () => {
    const p = personaWith({ lastProactiveAt: lastSend });
    p.lifecycle.lastActiveAt = activeAfterSend;
    const roll = 0.5;
    // F=24 fast lane: hazard = (elapsedH-1)/24; passes when hazard > 0.5 → elapsed > 13h
    expect(checkStochasticSpacing(p, "timer", lastSend + 5 * HR, roll).allowed).toBe(false);
    expect(checkStochasticSpacing(p, "timer", lastSend + 12 * HR, roll).allowed).toBe(false);
    expect(checkStochasticSpacing(p, "timer", lastSend + 14 * HR, roll).allowed).toBe(true);
    expect(checkStochasticSpacing(p, "timer", lastSend + 30 * HR, roll).allowed).toBe(true);
  });

  it("unanswered send doubles the target gap (slow lane)", () => {
    // user last active BEFORE the send → unanswered → F*2 = 48h
    const p = personaWith({ lastProactiveAt: lastSend });
    p.lifecycle.lastActiveAt = lastSend - HR;
    const roll = 0.5;
    expect(checkStochasticSpacing(p, "timer", lastSend + 14 * HR, roll).allowed).toBe(false);
    expect(checkStochasticSpacing(p, "timer", lastSend + 26 * HR, roll).allowed).toBe(true);
  });

  it("elapsed beyond floor+targetGap always passes (bounded worst-case wait)", () => {
    const p = personaWith({ lastProactiveAt: lastSend });
    p.lifecycle.lastActiveAt = activeAfterSend;
    expect(
      checkStochasticSpacing(p, "timer", lastSend + (MIN_SEND_GAP_H + 24) * HR, 0.999).allowed,
    ).toBe(true);
  });
});
