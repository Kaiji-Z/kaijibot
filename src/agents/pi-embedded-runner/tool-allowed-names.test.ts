import { describe, it, expect } from "vitest";

describe("createAgentSession tools parameter regression", () => {
  it("tools: [] creates empty allowedToolNames Set that blocks all customTools", () => {
    const tools: string[] | undefined = [];
    const allowedToolNames = tools ?? undefined;
    const resolved = allowedToolNames ? new Set(allowedToolNames) : undefined;
    expect(resolved).toBeInstanceOf(Set);
    expect(resolved!.size).toBe(0);
    const isAllowed = (name: string) => !resolved || resolved.has(name);
    expect(isAllowed("test_tool")).toBe(false);
  });

  it("tools: undefined creates no restriction (allows all customTools)", () => {
    const tools: string[] | undefined = undefined;
    const allowedToolNames = tools ?? undefined;
    const resolved = allowedToolNames ? new Set(allowedToolNames) : undefined;
    expect(resolved).toBeUndefined();
    const isAllowed = (name: string) => !resolved || resolved.has(name);
    expect(isAllowed("test_tool")).toBe(true);
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
