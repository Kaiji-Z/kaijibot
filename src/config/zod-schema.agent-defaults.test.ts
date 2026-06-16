import { describe, expect, it } from "vitest";
import { AgentDefaultsSchema } from "./zod-schema.agent-defaults.js";

describe("agent defaults schema", () => {
  it("accepts subagent archiveAfterMinutes=0 to disable archiving", () => {
    expect(() =>
      AgentDefaultsSchema.parse({
        subagents: {
          archiveAfterMinutes: 0,
        },
      }),
    ).not.toThrow();
  });

  it("accepts videoGenerationModel", () => {
    expect(() =>
      AgentDefaultsSchema.parse({
        videoGenerationModel: {
          primary: "qwen/wan2.6-t2v",
          fallbacks: ["minimax/video-01"],
        },
      }),
    ).not.toThrow();
  });

  it("accepts mediaGenerationAutoProviderFallback", () => {
    expect(() =>
      AgentDefaultsSchema.parse({
        mediaGenerationAutoProviderFallback: false,
      }),
    ).not.toThrow();
  });

  it("accepts contextInjection: always", () => {
    const result = AgentDefaultsSchema.parse({ contextInjection: "always" })!;
    expect(result.contextInjection).toBe("always");
  });

  it("accepts contextInjection: continuation-skip", () => {
    const result = AgentDefaultsSchema.parse({ contextInjection: "continuation-skip" })!;
    expect(result.contextInjection).toBe("continuation-skip");
  });

  it("rejects invalid contextInjection values", () => {
    expect(() => AgentDefaultsSchema.parse({ contextInjection: "never" })).toThrow();
  });

  it("accepts backgroundBatch boolean", () => {
    expect(() => AgentDefaultsSchema.parse({ backgroundBatch: true })).not.toThrow();
    const enabled = AgentDefaultsSchema.parse({ backgroundBatch: true })!;
    expect(enabled.backgroundBatch).toBe(true);
    const disabled = AgentDefaultsSchema.parse({ backgroundBatch: false })!;
    expect(disabled.backgroundBatch).toBe(false);
  });

  it("treats backgroundBatch as optional (default undefined)", () => {
    const result = AgentDefaultsSchema.parse({})!;
    expect(result.backgroundBatch).toBeUndefined();
  });

  it("rejects non-boolean backgroundBatch", () => {
    expect(() => AgentDefaultsSchema.parse({ backgroundBatch: "yes" })).toThrow();
  });
});
