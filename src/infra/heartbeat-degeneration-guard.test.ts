import { describe, expect, it } from "vitest";
import {
  buildDegenerateReplyFallback,
  isDegenerateReplyText,
} from "./heartbeat-degeneration-guard.js";

function legitVariedText(chars: number): string {
  const parts: string[] = [];
  let i = 0;
  while (parts.join("\n").length < chars) {
    i += 1;
    parts.push(
      `检查项 ${i}：深蹲容量 ${(i * 7) % 300}kg、静息心率 ${((i * 3) % 40) + 50}bpm、睡眠窗口 ${i % 8}h——每行内容互不相同，用于构造高区分度的合法长文本样本。`,
    );
  }
  return parts.join("\n");
}

/** Pattern taken verbatim from the 2026-08-21 incident transcript. */
function incidentStyleDegenerateText(repeat: number): string {
  const chunk = [
    "The insight: clean, short, warm, my reply now:",
    "My reply's the plan: apologize + relay. My reply:",
    "Here's the plan: apologize + apology + relay, once:",
    "The final message is the clean relay. Outputting it now, once, and ending the generation:",
    "Clean relay as the ONLY text, then stop:",
    "Relay. Once. Final. End:",
  ].join("\n");
  return Array.from({ length: repeat }, () => chunk).join("\n");
}

describe("isDegenerateReplyText", () => {
  it("passes short normal replies", () => {
    expect(isDegenerateReplyText("早上好，今天的洞察是……").degenerate).toBe(false);
  });

  it("passes long varied text (legit report)", () => {
    const text = legitVariedText(12_000);
    expect(text.length).toBeGreaterThan(10_000);
    expect(isDegenerateReplyText(text).degenerate).toBe(false);
  });

  it("blocks incident-style repetition above the scan threshold", () => {
    const text = incidentStyleDegenerateText(30);
    expect(text.length).toBeGreaterThan(6_000);
    expect(text.length).toBeLessThanOrEqual(24_000);
    const verdict = isDegenerateReplyText(text);
    if (!verdict.degenerate) {
      throw new Error(`expected degenerate verdict, got ratio ${String(verdict.shingleRatio)}`);
    }
    expect(verdict.reason).toBe("repetition");
  });

  it("blocks any reply over the absolute length cap regardless of variety", () => {
    const text = legitVariedText(30_000);
    expect(text.length).toBeGreaterThan(24_000);
    const verdict = isDegenerateReplyText(text);
    if (!verdict.degenerate) {
      throw new Error("expected degenerate verdict for over-cap text");
    }
    expect(verdict.reason).toBe("length");
  });

  it("does not scan medium-length repeated text below the scan threshold", () => {
    const medium = incidentStyleDegenerateText(15);
    expect(medium.length).toBeLessThanOrEqual(6_000);
    expect(isDegenerateReplyText(medium).degenerate).toBe(false);
  });
});

describe("buildDegenerateReplyFallback", () => {
  it("extracts the verified insight content from the stored event text", () => {
    const eventText =
      "[Cognitive Insight] 周报缺「身体回应」数据：建议每月末加体重、腰围、静息心率三行。\n（这是一条已生成的主动洞察，请用你自己的语言自然地分享给用户。）";
    const fallback = buildDegenerateReplyFallback(eventText);
    expect(fallback).toContain("洞察原文");
    expect(fallback).toContain("体重、腰围、静息心率");
    expect(fallback).not.toContain("[Cognitive Insight]");
    expect(fallback).not.toContain("请用你自己的语言");
  });

  it("caps over-long insight content", () => {
    const eventText = `[Cognitive Insight] ${legitVariedText(5_000)}`;
    const fallback = buildDegenerateReplyFallback(eventText);
    expect(fallback.length).toBeLessThan(2_400);
  });

  it("returns a generic notice when no insight event is available", () => {
    const fallback = buildDegenerateReplyFallback(undefined);
    expect(fallback).toContain("已自动拦截");
    expect(fallback).not.toContain("洞察原文");
  });
});
