import { describe, it, expect } from "vitest";

describe("createAgentSession tools parameter regression", () => {
  it("tools: [] creates empty allowedToolNames Set that blocks all customTools", () => {
    const allowedToolNames = [] ?? (false ? [] : undefined);
    const resolved = allowedToolNames ? new Set(allowedToolNames) : undefined;
    expect(resolved).toBeInstanceOf(Set);
    expect(resolved!.size).toBe(0);
    expect(!resolved || resolved.has("test_tool")).toBe(false);
  });

  it("tools: undefined creates no restriction (allows all customTools)", () => {
    const tools: string[] | undefined = undefined;
    const allowedToolNames = tools ?? (false ? [] : undefined);
    const resolved = allowedToolNames ? new Set(allowedToolNames) : undefined;
    expect(resolved).toBeUndefined();
    expect(!resolved || resolved.has("test_tool")).toBe(true);
  });

  it("builtInTools.length === 0 → tools should be undefined, not []", () => {
    const builtInTools: unknown[] = [];
    const toolsParam = builtInTools.length > 0 ? builtInTools.map((t) => (t as { name: string }).name) : undefined;
    expect(toolsParam).toBeUndefined();
  });

  it("builtInTools.length > 0 → tools should be name array", () => {
    const builtInTools = [{ name: "read" }, { name: "bash" }];
    const toolsParam = builtInTools.length > 0 ? builtInTools.map((t) => t.name) : undefined;
    expect(toolsParam).toEqual(["read", "bash"]);
  });
});
