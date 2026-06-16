import { describe, it, expect, vi } from "vitest";
import { resolveSessionToolsParam } from "./tool-split.js";

describe("resolveSessionToolsParam — production regression test", () => {
  it("returns undefined when builtInTools is empty (allows all customTools)", () => {
    const result = resolveSessionToolsParam([]);
    expect(result).toBeUndefined();
  });

  it("returns name array when builtInTools is non-empty", () => {
    const tools = [
      { name: "read", label: "Read", description: "", parameters: {}, execute: vi.fn() },
      { name: "bash", label: "Bash", description: "", parameters: {}, execute: vi.fn() },
    ] as never[];
    const result = resolveSessionToolsParam(tools);
    expect(result).toEqual(["read", "bash"]);
  });
});
