import { describe, expect, it, vi } from "vitest";
import { hasCorrectionSignals, extractCorrectionsFromTranscript } from "./extractor.js";

describe("hasCorrectionSignals", () => {
  it("returns true for Chinese correction pattern", () => {
    expect(hasCorrectionSignals("不对，你应该用另一个方法")).toBe(true);
  });

  it("returns true for English correction pattern", () => {
    expect(hasCorrectionSignals("That's wrong, try again")).toBe(true);
  });

  it("returns true for agent apology pattern", () => {
    expect(hasCorrectionSignals("抱歉，我搞错了")).toBe(true);
  });

  it("returns false for normal conversation", () => {
    expect(hasCorrectionSignals("今天天气不错，我们聊聊项目进度吧")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(hasCorrectionSignals("")).toBe(false);
  });
});

describe("extractCorrectionsFromTranscript", () => {
  it("extracts corrections from clear user correction", async () => {
    const mockGenerateText = vi.fn().mockResolvedValue(
      JSON.stringify([
        { domain: "feishu-doc", trigger: "创建飞书文档", mistake: "只传标题参数", correction: "创建后必须用update API写入正文" },
      ]),
    );
    const result = await extractCorrectionsFromTranscript("some transcript", mockGenerateText);
    expect(result).toHaveLength(1);
    expect(result[0]!.domain).toBe("feishu-doc");
    expect(result[0]!.provenance).toBe("user");
    expect(result[0]!.id).toBeDefined();
  });

  it("returns [] when LLM returns []", async () => {
    const mockGenerateText = vi.fn().mockResolvedValue("[]");
    const result = await extractCorrectionsFromTranscript("normal conversation", mockGenerateText);
    expect(result).toEqual([]);
  });

  it("returns [] when LLM call throws", async () => {
    const mockGenerateText = vi.fn().mockRejectedValue(new Error("LLM failed"));
    const result = await extractCorrectionsFromTranscript("transcript", mockGenerateText);
    expect(result).toEqual([]);
  });

  it("returns [] for invalid JSON", async () => {
    const mockGenerateText = vi.fn().mockResolvedValue("not json at all");
    const result = await extractCorrectionsFromTranscript("transcript", mockGenerateText);
    expect(result).toEqual([]);
  });

  it("handles JSON in markdown code blocks", async () => {
    const mockGenerateText = vi.fn().mockResolvedValue(
      '```json\n[{"domain":"test","trigger":"test","mistake":"wrong","correction":"right"}]\n```',
    );
    const result = await extractCorrectionsFromTranscript("transcript", mockGenerateText);
    expect(result).toHaveLength(1);
  });

  it("skips malformed entries", async () => {
    const mockGenerateText = vi.fn().mockResolvedValue(
      JSON.stringify([
        { domain: "test", mistake: "wrong", correction: "right" },
        { domain: "test", mistake: "" },
        "not an object",
      ]),
    );
    const result = await extractCorrectionsFromTranscript("transcript", mockGenerateText);
    expect(result).toHaveLength(1);
  });

  it("assigns provenance user to all corrections", async () => {
    const mockGenerateText = vi.fn().mockResolvedValue(
      JSON.stringify([
        { domain: "a", trigger: "a", mistake: "m", correction: "c" },
        { domain: "b", trigger: "b", mistake: "m2", correction: "c2" },
      ]),
    );
    const result = await extractCorrectionsFromTranscript("transcript", mockGenerateText);
    for (const r of result) {
      expect(r.provenance).toBe("user");
    }
  });
});
