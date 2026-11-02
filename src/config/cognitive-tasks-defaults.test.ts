import { describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "./config.js";
import { applyCognitiveDefaults } from "./defaults.js";
import { CognitiveSchema } from "./zod-schema.cognitive.js";

const base = { agents: { defaults: {} } } as unknown as KaijiBotConfig;

describe("cognitive.tasks config flag", () => {
  it("fills enabled=true (with brakes) when the section is absent", () => {
    const cfg = applyCognitiveDefaults({
      ...base,
      cognitive: { enabled: true },
    } as KaijiBotConfig);
    expect(cfg.cognitive?.tasks?.enabled).toBe(true);
    expect(cfg.cognitive?.tasks?.maxSteps).toBe(12);
    expect(cfg.cognitive?.tasks?.progressMessages).toBe(true);
  });

  it("fills enabled=true and maxSteps=12 when the section exists but is sparse", () => {
    const cfg = applyCognitiveDefaults({
      ...base,
      cognitive: { enabled: true, tasks: {} },
    } as KaijiBotConfig);
    expect(cfg.cognitive?.tasks?.enabled).toBe(true);
    expect(cfg.cognitive?.tasks?.maxSteps).toBe(12);
    expect(cfg.cognitive?.tasks?.progressMessages).toBe(true);
  });

  it("preserves explicit values, including explicit opt-out", () => {
    const cfg = applyCognitiveDefaults({
      ...base,
      cognitive: { tasks: { enabled: true, maxSteps: 3, progressMessages: false } },
    } as KaijiBotConfig);
    expect(cfg.cognitive?.tasks?.enabled).toBe(true);
    expect(cfg.cognitive?.tasks?.maxSteps).toBe(3);
    expect(cfg.cognitive?.tasks?.progressMessages).toBe(false);

    const optedOut = applyCognitiveDefaults({
      ...base,
      cognitive: { tasks: { enabled: false } },
    } as unknown as KaijiBotConfig);
    expect(optedOut.cognitive?.tasks?.enabled).toBe(false);
  });

  it("zod schema defaults tasks.enabled to true and rejects unknown keys", () => {
    const parsed = CognitiveSchema.parse({ tasks: {} });
    expect(parsed?.tasks?.enabled).toBe(true);

    expect(() => CognitiveSchema.parse({ tasks: { unknownKey: true } })).toThrow();
  });
});
