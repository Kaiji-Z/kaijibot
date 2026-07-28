import { describe, expect, it } from "vitest";
import { buildContextManifest } from "./context-manifest.js";
import type { CorrectionRecord } from "./correction/types.js";
import { createDefaultPersona } from "./persona/store.js";
import type { ModeClassification, PersonaTree } from "./types.js";

const baseClassification: ModeClassification = {
  mode: "task",
  confidence: 0.8,
  signals: ["imperative-verb"],
};

function makeCorrection(id: string): CorrectionRecord {
  return {
    id,
    domain: "test",
    trigger: "test",
    mistake: "mistake",
    correction: "correction",
    provenance: "self",
    reinforcedCount: 1,
    createdAt: 0,
    lastReinforced: 0,
  };
}

describe("buildContextManifest", () => {
  it("records mode and confidence from classification", () => {
    const m = buildContextManifest({
      classification: baseClassification,
      selectedCorrections: [],
      totalCorrectionsAvailable: 0,
      evolutionEnabled: true,
    });
    expect(m.mode).toBe("task");
    expect(m.modeConfidence).toBe(0.8);
  });

  it("records persona absence", () => {
    const m = buildContextManifest({
      classification: baseClassification,
      persona: undefined,
      selectedCorrections: [],
      totalCorrectionsAvailable: 0,
      evolutionEnabled: false,
    });
    expect(m.personaActive).toBe(false);
    expect(m.personaDomainCount).toBe(0);
  });

  it("records persona domain count", () => {
    const persona: PersonaTree = {
      ...createDefaultPersona(),
      domains: {
        a: {
          depth: 1,
          recurrence: 1,
          lastMentioned: 0,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
        b: {
          depth: 2,
          recurrence: 1,
          lastMentioned: 0,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
      },
    };
    const m = buildContextManifest({
      classification: baseClassification,
      persona,
      selectedCorrections: [],
      totalCorrectionsAvailable: 0,
      evolutionEnabled: false,
    });
    expect(m.personaActive).toBe(true);
    expect(m.personaDomainCount).toBe(2);
  });

  it("records selected vs available corrections", () => {
    const selected = [makeCorrection("a"), makeCorrection("b")];
    const m = buildContextManifest({
      classification: baseClassification,
      selectedCorrections: selected,
      totalCorrectionsAvailable: 10,
      evolutionEnabled: false,
    });
    expect(m.correctionsInjected).toBe(2);
    expect(m.correctionsAvailable).toBe(10);
    expect(m.correctionIds).toEqual(["a", "b"]);
  });

  it("records evolution flag", () => {
    const m = buildContextManifest({
      classification: baseClassification,
      selectedCorrections: [],
      totalCorrectionsAvailable: 0,
      evolutionEnabled: true,
    });
    expect(m.evolutionSectionActive).toBe(true);
  });

  it("always includes timestamp", () => {
    const before = Date.now();
    const m = buildContextManifest({
      classification: baseClassification,
      selectedCorrections: [],
      totalCorrectionsAvailable: 0,
      evolutionEnabled: false,
    });
    const after = Date.now();
    expect(m.timestamp).toBeGreaterThanOrEqual(before);
    expect(m.timestamp).toBeLessThanOrEqual(after);
  });
});
