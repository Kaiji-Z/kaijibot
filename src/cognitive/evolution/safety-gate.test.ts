import { describe, it, expect } from "vitest";
import { SafetyGate } from "./safety-gate.js";
import type { OperationRequest } from "./safety-gate.js";

function makeRequest(riskLevel: OperationRequest["riskLevel"]): OperationRequest {
  return {
    operation: "test-op",
    riskLevel,
    targetDescription: "test target",
    userId: "user-1",
  };
}

describe("SafetyGate", () => {
  const gate = new SafetyGate();

  it("read is always allowed regardless of trust", () => {
    for (const trust of [0.0, 0.5, 1.0]) {
      const decision = gate.evaluate(makeRequest("read"), trust);
      expect(decision.allowed).toBe(true);
      expect(decision.requiresConfirmation).toBe(false);
      expect(decision.reason).toContain("always allowed");
    }
  });

  it("suggest is always allowed regardless of trust", () => {
    for (const trust of [0.0, 0.5, 1.0]) {
      const decision = gate.evaluate(makeRequest("suggest"), trust);
      expect(decision.allowed).toBe(true);
      expect(decision.requiresConfirmation).toBe(false);
      expect(decision.reason).toContain("always allowed");
    }
  });

  it("write requires confirmation when trust < 0.5", () => {
    const decision = gate.evaluate(makeRequest("write"), 0.2);
    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toContain("< 0.50");
  });

  it("write is auto-approved when trust >= 0.5", () => {
    const decision = gate.evaluate(makeRequest("write"), 0.6);
    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(false);
    expect(decision.reason).toContain(">= 0.50");
  });

  it("destructive is denied when trust < 0.3", () => {
    const decision = gate.evaluate(makeRequest("destructive"), 0.1);
    expect(decision.allowed).toBe(false);
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toContain("< 0.30");
  });

  it("destructive requires individual confirmation when trust 0.3–0.7", () => {
    const decision = gate.evaluate(makeRequest("destructive"), 0.5);
    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toContain("individual confirmation");
  });

  it("destructive is batch-allowed when trust >= 0.7", () => {
    const decision = gate.evaluate(makeRequest("destructive"), 0.8);
    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toContain(">= 0.70");
    expect(decision.reason).toContain("batch ok");
  });

  it("decision includes human-readable reason with trust score", () => {
    const decision = gate.evaluate(makeRequest("write"), 0.42);
    expect(decision.reason).toContain("0.42");
    expect(decision.reason.length).toBeGreaterThan(10);
  });
});
