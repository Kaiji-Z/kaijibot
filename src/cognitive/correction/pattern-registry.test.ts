import { describe, it, expect } from "vitest";
import { PatternRegistry } from "./pattern-registry.js";

describe("PatternRegistry", () => {
  it("starts empty", () => {
    const reg = new PatternRegistry("/tmp/test-pat-" + Date.now());
    expect(reg.list()).toEqual([]);
  });

  it("add persists a pattern", async () => {
    const reg = new PatternRegistry("/tmp/test-pat2-" + Date.now());
    await reg.add({ pattern: "格式错误", flags: "i", source: "auto-promoted" });
    expect(reg.list()).toHaveLength(1);
    expect(reg.patterns()).toHaveLength(1);
  });

  it("patterns returns compiled RegExp array", async () => {
    const reg = new PatternRegistry("/tmp/test-pat3-" + Date.now());
    await reg.add({ pattern: "不对", flags: "i", source: "auto" });
    const pats = reg.patterns();
    expect(pats[0]).toBeInstanceOf(RegExp);
    expect(pats[0]!.test("这个不对")).toBe(true);
  });
});
