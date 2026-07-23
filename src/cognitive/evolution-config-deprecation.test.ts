import { afterEach, describe, expect, it, vi } from "vitest";

import { CognitiveEvolutionSchema } from "../config/zod-schema.cognitive.js";

describe("CognitiveEvolutionSchema — deprecated field stripping", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  afterEach(() => {
    warnSpy.mockClear();
  });

  it("strips clawhubEnabled and warns", () => {
    const parsed = CognitiveEvolutionSchema.parse({
      enabled: true,
      clawhubEnabled: true,
    });
    expect(parsed).toEqual({ enabled: true });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("clawhubEnabled"),
    );
  });

  it("strips minComplexity and warns", () => {
    const parsed = CognitiveEvolutionSchema.parse({
      enabled: false,
      minComplexity: 0.8,
    });
    expect(parsed).toEqual({ enabled: false });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("minComplexity"),
    );
  });

  it("strips all five deprecated keys at once", () => {
    const parsed = CognitiveEvolutionSchema.parse({
      enabled: true,
      minComplexity: 0.5,
      errorComplexityThreshold: 0.3,
      clawhubEnabled: true,
      clawhubRegistry: "https://example.com",
      clawhubAutoPublish: true,
    });
    expect(parsed).toEqual({ enabled: true });
    expect(warnSpy).toHaveBeenCalledTimes(5);
  });

  it("still rejects truly unknown keys (strict mode preserved)", () => {
    expect(() =>
      CognitiveEvolutionSchema.parse({
        enabled: true,
        completelyUnknownField: 42,
      }),
    ).toThrow();
  });

  it("does not warn when no deprecated keys present", () => {
    CognitiveEvolutionSchema.parse({ enabled: true });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("accepts undefined (optional schema)", () => {
    expect(CognitiveEvolutionSchema.parse(undefined)).toBeUndefined();
  });
});
