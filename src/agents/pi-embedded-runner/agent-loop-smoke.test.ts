import { describe, it, expect } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { splitSdkTools, resolveSessionToolsParam } from "./tool-split.js";

// Minimal fake tool that satisfies the AgentTool contract without `as any`.
// `as never` is required because the AgentTool parameters field is a TSchema
// type variable that we do not fully model in tests; this is the same pattern
// used by sibling tests (see tool-allowed-names.test.ts).
const fakeTool: AgentTool = {
  name: "test_bash",
  label: "Test Bash",
  description: "A test tool",
  parameters: { type: "object", properties: {}, required: [] } as never,
  execute: async () => ({ content: [{ type: "text", text: "ok" }], details: { ok: true } }),
};

describe("agent-loop smoke: tools reach createAgentSession", () => {
  it("splitSdkTools puts all tools into customTools, builtInTools is always empty", () => {
    const { builtInTools, customTools } = splitSdkTools({
      tools: [fakeTool] as never,
      sandboxEnabled: false,
    });
    expect(builtInTools).toHaveLength(0);
    expect(customTools.length).toBeGreaterThan(0);
  });

  it("resolveSessionToolsParam returns undefined for empty builtInTools (critical: NOT [])", () => {
    const { builtInTools } = splitSdkTools({
      tools: [fakeTool] as never,
      sandboxEnabled: false,
    });
    const toolsParam = resolveSessionToolsParam(builtInTools);
    expect(toolsParam).toBeUndefined();
    // Regression guard: if someone changes this back to [],
    // pi-coding-agent will create an empty allowedToolNames Set and block
    // ALL customTools.
    expect(toolsParam).not.toEqual([]);
  });

  it("full pipeline: tools -> splitSdkTools -> resolveSessionToolsParam produces valid session config", () => {
    const tools = [fakeTool];
    const { builtInTools, customTools } = splitSdkTools({
      tools: tools as never,
      sandboxEnabled: false,
    });
    const toolsParam = resolveSessionToolsParam(builtInTools);

    // Simulate what createAgentSession receives.
    const sessionConfig = {
      tools: toolsParam,
      customTools,
    };

    // tools must be undefined (not []) to avoid the empty Set blocking bug.
    expect(sessionConfig.tools).toBeUndefined();
    // customTools must contain our tool definitions.
    expect(sessionConfig.customTools.length).toBeGreaterThan(0);
    expect(sessionConfig.customTools[0].name).toBe("test_bash");
  });
});
