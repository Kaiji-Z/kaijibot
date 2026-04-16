import { describe, it, expect } from "vitest";
import { buildPersonaContext } from "./context-builder.js";
import { createDefaultPersona } from "./store.js";

describe("buildPersonaContext", () => {
  it("returns empty string for undefined persona", () => {
    expect(buildPersonaContext(undefined)).toBe("");
  });

  it("includes Blacklisted Topics section when domainBlacklist has entries", () => {
    const persona = createDefaultPersona();
    persona.domainBlacklist = ["数据科学", "区块链"];
    const context = buildPersonaContext(persona);
    expect(context).toContain("### Blacklisted Topics");
    expect(context).toContain("Never proactively suggest: 数据科学, 区块链");
  });

  it("omits Blacklisted Topics section when domainBlacklist is empty", () => {
    const persona = createDefaultPersona();
    persona.domainBlacklist = [];
    const context = buildPersonaContext(persona);
    expect(context).not.toContain("### Blacklisted Topics");
  });

  it("omits Blacklisted Topics section when domainBlacklist is not set", () => {
    const persona = createDefaultPersona();
    const context = buildPersonaContext(persona);
    expect(context).not.toContain("### Blacklisted Topics");
  });

  it("places Blacklisted Topics before Communication Style", () => {
    const persona = createDefaultPersona();
    persona.domainBlacklist = ["数据科学"];
    persona.identity.communicationStyle = {
      formality: "casual",
      verbosity: "moderate",
      technicalLevel: "expert",
      preferredLanguage: "zh",
    };
    const context = buildPersonaContext(persona);
    const blacklistIndex = context.indexOf("### Blacklisted Topics");
    const commStyleIndex = context.indexOf("### Communication Style");
    expect(blacklistIndex).toBeGreaterThan(-1);
    expect(commStyleIndex).toBeGreaterThan(-1);
    expect(blacklistIndex).toBeLessThan(commStyleIndex);
  });

  it("includes blacklist alongside other sections", () => {
    const persona = createDefaultPersona();
    persona.domainBlacklist = ["量子计算"];
    persona.identity.coreTraits = {
      职位: {
        value: "工程师",
        confidence: 0.9,
        evidenceCount: 3,
        lastUpdated: Date.now(),
        source: "explicit",
      },
    };
    persona.rapport.trustScore = 0.8;
    const context = buildPersonaContext(persona);
    expect(context).toContain("### Known Traits");
    expect(context).toContain("### Blacklisted Topics");
    expect(context).toContain("### Interaction Note");
  });
});
