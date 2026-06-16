import { describe, expect, it, afterEach } from "vitest";
import { hasCorrectionSignals, setRuntimePatternResolver } from "./extractor.js";

describe("hasCorrectionSignals runtime pattern merge", () => {
  afterEach(() => {
    // Reset to default (no runtime patterns)
    setRuntimePatternResolver(null);
  });

  it("detects text matching a runtime-promoted pattern", () => {
    setRuntimePatternResolver(() => [/特殊格式错误/]);
    expect(hasCorrectionSignals("这个特殊格式错误需要修复")).toBe(true);
  });

  it("still detects static patterns when runtime resolver is null", () => {
    setRuntimePatternResolver(null);
    expect(hasCorrectionSignals("不对，你应该用另一个方法")).toBe(true);
  });

  it("returns false when neither static nor runtime patterns match", () => {
    setRuntimePatternResolver(() => [/完全不相关的模式/]);
    expect(hasCorrectionSignals("今天天气不错，我们聊聊项目进度吧")).toBe(false);
  });

  it("returns false for empty string even with runtime patterns", () => {
    setRuntimePatternResolver(() => [/something/]);
    expect(hasCorrectionSignals("")).toBe(false);
  });

  it("handles resolver that throws (non-fatal, falls back to static)", () => {
    setRuntimePatternResolver(() => {
      throw new Error("boom");
    });
    // Should not throw; static patterns still work
    expect(hasCorrectionSignals("不对，你应该用另一个方法")).toBe(true);
    expect(hasCorrectionSignals("今天天气不错")).toBe(false);
  });
});
