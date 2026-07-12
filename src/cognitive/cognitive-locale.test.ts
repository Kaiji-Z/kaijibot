import { describe, expect, it } from "vitest";
import {
  DEFAULT_COGNITIVE_LOCALE,
  detectCognitiveLocale,
  L,
  pickLocalized,
} from "./cognitive-locale.js";
import type { PersonaTree } from "./types.js";

function makePersona(opts: {
  primaryLanguage?: string;
  preferredLanguage?: "zh" | "en" | "mixed";
}): PersonaTree {
  return {
    identity: {
      primaryLanguage: opts.primaryLanguage,
      communicationStyle: {
        preferredLanguage: opts.preferredLanguage ?? "zh",
      },
    },
    rapport: { trustScore: 0 },
  } as unknown as PersonaTree;
}

describe("detectCognitiveLocale", () => {
  it("returns zh when persona is missing", () => {
    expect(detectCognitiveLocale(null)).toBe(DEFAULT_COGNITIVE_LOCALE);
    expect(detectCognitiveLocale(undefined)).toBe(DEFAULT_COGNITIVE_LOCALE);
  });

  it("prefers primaryLanguage=en", () => {
    const persona = makePersona({ primaryLanguage: "en", preferredLanguage: "zh" });
    expect(detectCognitiveLocale(persona)).toBe("en");
  });

  it("falls back to preferredLanguage=en", () => {
    const persona = makePersona({ preferredLanguage: "en" });
    expect(detectCognitiveLocale(persona)).toBe("en");
  });

  it("maps preferredLanguage=mixed to zh", () => {
    const persona = makePersona({ preferredLanguage: "mixed" });
    expect(detectCognitiveLocale(persona)).toBe("zh");
  });

  it("maps preferredLanguage=zh to zh", () => {
    const persona = makePersona({ preferredLanguage: "zh" });
    expect(detectCognitiveLocale(persona)).toBe("zh");
  });

  it("returns zh when no language signal is present", () => {
    const persona = makePersona({});
    expect(detectCognitiveLocale(persona)).toBe("zh");
  });
});

describe("pickLocalized", () => {
  it("returns zh variant for zh locale", () => {
    expect(pickLocalized(L("你好", "hello"), "zh")).toBe("你好");
  });

  it("returns en variant for en locale", () => {
    expect(pickLocalized(L("你好", "hello"), "en")).toBe("hello");
  });
});

describe("L helper", () => {
  it("constructs a LocalizableString with both variants", () => {
    expect(L("zh-text", "en-text")).toEqual({ zh: "zh-text", en: "en-text" });
  });
});
