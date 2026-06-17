import { describe, expect, it } from "vitest";
import {
  CARD_PHASES,
  type CardPhase,
  isTerminalPhase,
  PHASE_TRANSITIONS,
  TERMINAL_PHASES,
  THROTTLE_CONSTANTS,
  transitionPhase,
} from "./card-types.js";

// ---------------------------------------------------------------------------
// CARD_PHASES
// ---------------------------------------------------------------------------

describe("CARD_PHASES", () => {
  it("contains all expected phase values", () => {
    const phases = Object.values(CARD_PHASES);
    expect(phases).toEqual([
      "idle",
      "creating",
      "streaming",
      "completed",
      "aborted",
      "terminated",
      "creation_failed",
    ]);
  });

  it("has string values matching their keys", () => {
    for (const [key, value] of Object.entries(CARD_PHASES)) {
      expect(value).toBe(key);
    }
  });
});

// ---------------------------------------------------------------------------
// TERMINAL_PHASES
// ---------------------------------------------------------------------------

describe("TERMINAL_PHASES", () => {
  it("contains exactly the four terminal phases", () => {
    expect(TERMINAL_PHASES).toBeInstanceOf(Set);
    expect([...TERMINAL_PHASES]).toEqual(["completed", "aborted", "terminated", "creation_failed"]);
  });

  it("is frozen (readonly)", () => {
    // ReadonlySet prevents mutation — verify the type is ReadonlySet
    expect(typeof TERMINAL_PHASES.has).toBe("function");
    expect(typeof TERMINAL_PHASES.values).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// isTerminalPhase
// ---------------------------------------------------------------------------

describe("isTerminalPhase", () => {
  it.each([
    ["completed", true],
    ["aborted", true],
    ["terminated", true],
    ["creation_failed", true],
  ] as const)("returns true for terminal phase %s", (phase, expected) => {
    expect(isTerminalPhase(phase)).toBe(expected);
  });

  it.each([
    ["idle", false],
    ["creating", false],
    ["streaming", false],
  ] as const)("returns false for non-terminal phase %s", (phase, expected) => {
    expect(isTerminalPhase(phase)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// PHASE_TRANSITIONS
// ---------------------------------------------------------------------------

describe("PHASE_TRANSITIONS", () => {
  it("has an entry for every CardPhase", () => {
    const phases = Object.values(CARD_PHASES);
    for (const phase of phases) {
      expect(PHASE_TRANSITIONS).toHaveProperty(phase);
      expect(PHASE_TRANSITIONS[phase]).toBeInstanceOf(Set);
    }
  });

  it("terminal phases have no outgoing transitions", () => {
    for (const phase of TERMINAL_PHASES) {
      expect(PHASE_TRANSITIONS[phase].size).toBe(0);
    }
  });

  it("idle can transition to creating, aborted, terminated", () => {
    const allowed = PHASE_TRANSITIONS.idle;
    expect(allowed.has("creating")).toBe(true);
    expect(allowed.has("aborted")).toBe(true);
    expect(allowed.has("terminated")).toBe(true);
    expect(allowed.size).toBe(3);
  });

  it("idle cannot transition to streaming directly", () => {
    expect(PHASE_TRANSITIONS.idle.has("streaming")).toBe(false);
  });

  it("creating can transition to streaming, creation_failed, aborted, terminated", () => {
    const allowed = PHASE_TRANSITIONS.creating;
    expect(allowed.has("streaming")).toBe(true);
    expect(allowed.has("creation_failed")).toBe(true);
    expect(allowed.has("aborted")).toBe(true);
    expect(allowed.has("terminated")).toBe(true);
    expect(allowed.size).toBe(4);
  });

  it("streaming can transition to completed, aborted, terminated", () => {
    const allowed = PHASE_TRANSITIONS.streaming;
    expect(allowed.has("completed")).toBe(true);
    expect(allowed.has("aborted")).toBe(true);
    expect(allowed.has("terminated")).toBe(true);
    expect(allowed.size).toBe(3);
  });

  it("every target phase is a valid CardPhase value", () => {
    const allPhases = new Set<string>(Object.values(CARD_PHASES));
    for (const [, targets] of Object.entries(PHASE_TRANSITIONS)) {
      for (const target of targets) {
        expect(allPhases.has(target)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// transitionPhase
// ---------------------------------------------------------------------------

describe("transitionPhase", () => {
  it("returns the target phase for a valid transition", () => {
    expect(transitionPhase("idle", "creating")).toBe("creating");
    expect(transitionPhase("creating", "streaming")).toBe("streaming");
    expect(transitionPhase("streaming", "completed")).toBe("completed");
    expect(transitionPhase("idle", "aborted")).toBe("aborted");
  });

  it("throws for invalid transitions", () => {
    expect(() => transitionPhase("idle", "streaming")).toThrow(
      "Invalid phase transition: idle → streaming",
    );
    expect(() => transitionPhase("completed", "idle")).toThrow(
      "Invalid phase transition: completed → idle (completed is terminal)",
    );
  });

  it("throws for self-transitions on non-terminal phases", () => {
    expect(() => transitionPhase("idle", "idle")).toThrow("Invalid phase transition: idle → idle");
    expect(() => transitionPhase("streaming", "streaming")).toThrow();
  });

  it("throws for any transition from a terminal phase", () => {
    const terminalPhases: CardPhase[] = ["completed", "aborted", "terminated", "creation_failed"];
    const allPhases: CardPhase[] = Object.values(CARD_PHASES);

    for (const terminal of terminalPhases) {
      for (const target of allPhases) {
        expect(() => transitionPhase(terminal, target)).toThrow();
      }
    }
  });

  it("allows all documented valid transitions without throwing", () => {
    const validTransitions: Array<[CardPhase, CardPhase]> = [
      ["idle", "creating"],
      ["idle", "aborted"],
      ["idle", "terminated"],
      ["creating", "streaming"],
      ["creating", "creation_failed"],
      ["creating", "aborted"],
      ["creating", "terminated"],
      ["streaming", "completed"],
      ["streaming", "aborted"],
      ["streaming", "terminated"],
    ];
    for (const [from, to] of validTransitions) {
      expect(transitionPhase(from, to)).toBe(to);
    }
  });
});

// ---------------------------------------------------------------------------
// THROTTLE_CONSTANTS
// ---------------------------------------------------------------------------

describe("THROTTLE_CONSTANTS", () => {
  it("has all expected keys", () => {
    expect(Object.keys(THROTTLE_CONSTANTS)).toEqual([
      "CARDKIT_MS",
      "PATCH_MS",
      "LONG_GAP_THRESHOLD_MS",
      "BATCH_AFTER_GAP_MS",
      "REASONING_STATUS_MS",
    ]);
  });

  it("has positive integer values", () => {
    for (const value of Object.values(THROTTLE_CONSTANTS)) {
      expect(value).toBeGreaterThan(0);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("PATCH_MS is larger than CARDKIT_MS (stricter rate limit)", () => {
    expect(THROTTLE_CONSTANTS.PATCH_MS).toBeGreaterThan(THROTTLE_CONSTANTS.CARDKIT_MS);
  });

  it("LONG_GAP_THRESHOLD_MS is larger than PATCH_MS", () => {
    expect(THROTTLE_CONSTANTS.LONG_GAP_THRESHOLD_MS).toBeGreaterThan(THROTTLE_CONSTANTS.PATCH_MS);
  });

  it("BATCH_AFTER_GAP_MS is smaller than LONG_GAP_THRESHOLD_MS", () => {
    expect(THROTTLE_CONSTANTS.BATCH_AFTER_GAP_MS).toBeLessThan(
      THROTTLE_CONSTANTS.LONG_GAP_THRESHOLD_MS,
    );
  });
});
