import { afterEach, beforeEach, vi } from "vitest";

// Deterministic RNG for the cognitive suite: the proactive pipeline uses
// bandit-weighted selection and epsilon-greedy promotion (Math.random).
// Without a fixed seed these tests flake. Each test resets to the same seed.
beforeEach(() => {
  let seed = 0x9e37_79b9;
  vi.spyOn(Math, "random").mockImplementation(() => {
    seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return seed / 4_294_967_296;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
