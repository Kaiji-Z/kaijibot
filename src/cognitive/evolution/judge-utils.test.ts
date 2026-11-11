import { describe, expect, it } from "vitest";
import { parseJsonLoose, truncateForJudge, JUDGE_BODY_MAX_CHARS } from "./judge-utils.js";

describe("parseJsonLoose", () => {
  it("parses a bare JSON object", () => {
    expect(parseJsonLoose('{"approved": true}')).toEqual({ approved: true });
  });

  it("parses JSON wrapped in a markdown fence", () => {
    const fenced = '```json\n{"approved": false, "confidence": 0.4}\n```';
    expect(parseJsonLoose(fenced)).toEqual({ approved: false, confidence: 0.4 });
  });

  it("parses JSON embedded in leading/trailing prose", () => {
    const chatty = 'Here is my evaluation:\n{"score": 0.8}\nHope this helps!';
    expect(parseJsonLoose(chatty)).toEqual({ score: 0.8 });
  });

  it("throws on prose without any JSON object", () => {
    expect(() => parseJsonLoose("I cannot evaluate this.")).toThrow();
  });

  it("throws on truncated JSON (verdict cut off mid-object)", () => {
    const truncated = '{"actionable": 0.9, "validTools": 0.8, "critique": "the workflow is';
    expect(() => parseJsonLoose(truncated)).toThrow();
  });
});

describe("truncateForJudge", () => {
  it("returns short bodies unchanged", () => {
    expect(truncateForJudge("short body")).toBe("short body");
  });

  it("caps long bodies and marks the cut", () => {
    const body = "x".repeat(JUDGE_BODY_MAX_CHARS + 5000);
    const truncated = truncateForJudge(body);
    expect(truncated.length).toBeLessThan(body.length);
    expect(truncated).toContain("body truncated, 5000 chars omitted");
    expect(truncated.startsWith("x".repeat(JUDGE_BODY_MAX_CHARS))).toBe(true);
  });

  it("honors a custom budget", () => {
    const truncated = truncateForJudge("abcdefghij", 4);
    expect(truncated.startsWith("abcd")).toBe(true);
    expect(truncated).toContain("6 chars omitted");
  });
});
