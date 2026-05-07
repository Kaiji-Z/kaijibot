import { describe, it, expect } from "vitest";
import type { UserLifecycle } from "../types.js";
import {
  computeLifecycleStage,
  shouldReEngage,
  getDecayMultiplier,
  getProactiveFrequencyFactor,
} from "./lifecycle.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeLifecycle(overrides: Partial<UserLifecycle> = {}): UserLifecycle {
  return {
    stage: "new",
    lastActiveAt: Date.now(),
    lastStageTransitionAt: Date.now(),
    totalActiveDays: 1,
    ...overrides,
  };
}

describe("computeLifecycleStage", () => {
  it("transitions new → active at 5 exchanges", () => {
    const lc = makeLifecycle({ stage: "new" });
    expect(computeLifecycleStage(lc, 5, Date.now())).toBe("active");
  });

  it("stays new at 4 exchanges", () => {
    const lc = makeLifecycle({ stage: "new" });
    expect(computeLifecycleStage(lc, 4, Date.now())).toBe("new");
  });

  it("transitions active → dormant after 14 days silence", () => {
    const now = Date.now();
    const lc = makeLifecycle({ stage: "active", lastActiveAt: now - 15 * DAY_MS });
    expect(computeLifecycleStage(lc, 10, now)).toBe("dormant");
  });

  it("stays active within 14 days", () => {
    const now = Date.now();
    const lc = makeLifecycle({ stage: "active", lastActiveAt: now - 13 * DAY_MS });
    expect(computeLifecycleStage(lc, 10, now)).toBe("active");
  });

  it("transitions dormant → lapsed after 45 days silence", () => {
    const now = Date.now();
    const lc = makeLifecycle({ stage: "dormant", lastActiveAt: now - 46 * DAY_MS });
    expect(computeLifecycleStage(lc, 10, now)).toBe("lapsed");
  });

  it("stays dormant within 45 days", () => {
    const now = Date.now();
    const lc = makeLifecycle({ stage: "dormant", lastActiveAt: now - 44 * DAY_MS });
    expect(computeLifecycleStage(lc, 10, now)).toBe("dormant");
  });
});

describe("shouldReEngage", () => {
  it("returns true for dormant user after 7 days silence", () => {
    const now = Date.now();
    const lc = makeLifecycle({ stage: "dormant", lastActiveAt: now - 8 * DAY_MS });
    expect(shouldReEngage(lc, now)).toBe(true);
  });

  it("returns false for dormant user within 7 days", () => {
    const now = Date.now();
    const lc = makeLifecycle({ stage: "dormant", lastActiveAt: now - 5 * DAY_MS });
    expect(shouldReEngage(lc, now)).toBe(false);
  });

  it("returns false for active users", () => {
    const now = Date.now();
    const lc = makeLifecycle({ stage: "active", lastActiveAt: now - 20 * DAY_MS });
    expect(shouldReEngage(lc, now)).toBe(false);
  });
});

describe("getDecayMultiplier", () => {
  it("returns 1.0 for active", () => {
    expect(getDecayMultiplier(makeLifecycle({ stage: "active" }))).toBe(1.0);
  });

  it("returns 1.5 for new", () => {
    expect(getDecayMultiplier(makeLifecycle({ stage: "new" }))).toBe(1.5);
  });

  it("returns 2.0 for dormant", () => {
    expect(getDecayMultiplier(makeLifecycle({ stage: "dormant" }))).toBe(2.0);
  });

  it("returns 3.0 for lapsed", () => {
    expect(getDecayMultiplier(makeLifecycle({ stage: "lapsed" }))).toBe(3.0);
  });
});

describe("getProactiveFrequencyFactor", () => {
  it("returns 1.0 for active", () => {
    expect(getProactiveFrequencyFactor(makeLifecycle({ stage: "active" }))).toBe(1.0);
  });

  it("returns 2.0 for new", () => {
    expect(getProactiveFrequencyFactor(makeLifecycle({ stage: "new" }))).toBe(2.0);
  });

  it("returns 0.5 for dormant", () => {
    expect(getProactiveFrequencyFactor(makeLifecycle({ stage: "dormant" }))).toBe(0.5);
  });

  it("returns 3.0 for lapsed", () => {
    expect(getProactiveFrequencyFactor(makeLifecycle({ stage: "lapsed" }))).toBe(3.0);
  });
});
