import { describe, expect, it } from "vitest";
import type { PersonaTree } from "../types.js";
import { createDefaultPersona } from "./store.js";
import { buildPersonaSummary } from "./summary-builder.js";

describe("buildPersonaSummary", () => {
  it("returns empty string for undefined persona", () => {
    expect(buildPersonaSummary(undefined)).toBe("");
  });

  it("returns heading for default persona with no data", () => {
    const persona = createDefaultPersona();
    const result = buildPersonaSummary(persona);
    expect(result).toContain("## User Cognitive Profile");
  });

  it("includes high-confidence traits only", () => {
    const persona: PersonaTree = {
      ...createDefaultPersona(),
      identity: {
        ...createDefaultPersona().identity,
        coreTraits: {
          称呼: {
            value: "Kaiji",
            confidence: 0.9,
            evidenceCount: 5,
            lastUpdated: 0,
            source: "explicit",
          },
          role: {
            value: "engineer",
            confidence: 0.8,
            evidenceCount: 3,
            lastUpdated: 0,
            source: "inferred",
          },
          lowConf: {
            value: "maybe",
            confidence: 0.3,
            evidenceCount: 1,
            lastUpdated: 0,
            source: "inferred",
          },
        },
      },
    };
    const result = buildPersonaSummary(persona);
    expect(result).toContain("称呼: Kaiji");
    expect(result).toContain("role: engineer");
    expect(result).not.toContain("lowConf");
  });

  it("limits active domains to top 3 by recency", () => {
    const persona: PersonaTree = {
      ...createDefaultPersona(),
      domains: {
        a: {
          depth: 5,
          recurrence: 3,
          lastMentioned: 100,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
        b: {
          depth: 4,
          recurrence: 2,
          lastMentioned: 300,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
        c: {
          depth: 3,
          recurrence: 1,
          lastMentioned: 200,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
        d: {
          depth: 6,
          recurrence: 5,
          lastMentioned: 50,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
      },
    };
    const result = buildPersonaSummary(persona);
    const activeLines = result.split("\n").filter((l) => l.startsWith("- "));
    expect(activeLines).toHaveLength(3);
    expect(activeLines[0]).toContain("b");
    expect(activeLines[1]).toContain("c");
    expect(activeLines[2]).toContain("a");
  });

  it("includes top insight per domain", () => {
    const persona: PersonaTree = {
      ...createDefaultPersona(),
      domains: {
        coding: {
          depth: 5,
          recurrence: 3,
          lastMentioned: 100,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
          insights: [
            {
              text: "prefers TypeScript",
              category: "durable",
              confidence: 0.9,
              source: "explicit",
              firstObserved: 0,
              lastReinforced: 0,
              evidenceCount: 3,
              halfLifeDays: 30,
            },
            {
              text: "dislikes any",
              category: "durable",
              confidence: 0.5,
              source: "inferred",
              firstObserved: 0,
              lastReinforced: 0,
              evidenceCount: 1,
              halfLifeDays: 30,
            },
          ],
        },
      },
    };
    const result = buildPersonaSummary(persona);
    expect(result).toContain("prefers TypeScript");
    expect(result).not.toContain("dislikes any");
  });

  it("includes trust level indicator", () => {
    const highTrust = {
      ...createDefaultPersona(),
      rapport: { ...createDefaultPersona().rapport, trustScore: 0.8 },
    };
    expect(buildPersonaSummary(highTrust)).toContain("Trust: high");

    const midTrust = {
      ...createDefaultPersona(),
      rapport: { ...createDefaultPersona().rapport, trustScore: 0.5 },
    };
    expect(buildPersonaSummary(midTrust)).toContain("Trust: building");

    const lowTrust = {
      ...createDefaultPersona(),
      rapport: { ...createDefaultPersona().rapport, trustScore: 0.2 },
    };
    expect(buildPersonaSummary(lowTrust)).not.toContain("Trust");
  });

  it("produces output significantly smaller than buildPersonaContext", () => {
    const persona: PersonaTree = {
      ...createDefaultPersona(),
      identity: {
        ...createDefaultPersona().identity,
        coreTraits: {
          称呼: {
            value: "Kaiji",
            confidence: 0.9,
            evidenceCount: 5,
            lastUpdated: 0,
            source: "explicit",
          },
        },
        expertDomains: ["AI", "systems", "product"],
      },
      domains: Object.fromEntries(
        Array.from({ length: 5 }, (_, i) => [
          `domain${i}`,
          {
            depth: 4 + i,
            recurrence: 3,
            lastMentioned: 100 + i,
            keyInsights: [`insight ${i}-1`, `insight ${i}-2`, `insight ${i}-3`],
            activeQuestions: [],
            negationSignals: 0,
            insights: Array.from({ length: 3 }, (_, j) => ({
              text: `typed insight ${i}-${j}`,
              category: "durable" as const,
              confidence: 0.7 - j * 0.1,
              source: "explicit" as const,
              firstObserved: 0,
              lastReinforced: 0,
              evidenceCount: 2,
              halfLifeDays: 30,
            })),
          },
        ]),
      ),
      recentFocus: ["topic1", "topic2", "topic3", "topic4", "topic5"],
    };

    const summary = buildPersonaSummary(persona);
    expect(summary.length).toBeLessThan(800);
  });
});
