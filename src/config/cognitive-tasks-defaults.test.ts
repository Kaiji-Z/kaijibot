import { describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "./config.js";
import { applyCognitiveDefaults } from "./defaults.js";
import { CognitiveSchema } from "./zod-schema.cognitive.js";

const base = { agents: { defaults: {} } } as unknown as KaijiBotConfig;

describe("cognitive.tasks config flag", () => {
  it("stays absent when the section is absent (runtime resolves to disabled)", () => {
    const cfg = applyCognitiveDefaults({
      ...base,
      cognitive: { enabled: true },
    } as KaijiBotConfig);
    expect(cfg.cognitive?.tasks).toBeUndefined();
  });

  it("fills enabled=false and maxSteps=12 when the section exists but is sparse", () => {
    const cfg = applyCognitiveDefaults({
      ...base,
      cognitive: { enabled: true, tasks: {} },
    } as KaijiBotConfig);
    expect(cfg.cognitive?.tasks?.enabled).toBe(false);
    expect(cfg.cognitive?.tasks?.maxSteps).toBe(12);
    expect(cfg.cognitive?.tasks?.progressMessages).toBe(true);
  });

  it("preserves explicit values", () => {
    const cfg = applyCognitiveDefaults({
      ...base,
      cognitive: { tasks: { enabled: true, maxSteps: 3, progressMessages: false } },
    } as KaijiBotConfig);
    expect(cfg.cognitive?.tasks?.enabled).toBe(true);
    expect(cfg.cognitive?.tasks?.maxSteps).toBe(3);
    expect(cfg.cognitive?.tasks?.progressMessages).toBe(false);
  });

  it("zod schema defaults tasks.enabled to false and rejects unknown keys", () => {
    const parsed = CognitiveSchema.parse({ tasks: {} });
    expect(parsed?.tasks?.enabled).toBe(false);
    expect(parsed?.tasks?.progressMessages).toBe(true);

    expect(() => CognitiveSchema.parse({ tasks: { unknownKey: true } })).toThrow();
  });
});
