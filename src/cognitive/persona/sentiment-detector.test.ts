import { describe, it, expect } from "vitest";
import { detectSentiment } from "./sentiment-detector.js";

describe("detectSentiment", () => {
  // --- Frustrated ---
  it("detects 烦死 as frustrated", () => {
    const result = detectSentiment("这个东西烦死了");
    expect(result).toBeDefined();
    expect(result!.label).toBe("frustrated");
    expect(result!.confidence).toBe(0.85);
    expect(result!.evidence).toBe("烦死");
  });

  it("detects 受不了 as frustrated", () => {
    expect(detectSentiment("我真的受不了了")!.label).toBe("frustrated");
  });

  it("detects 崩溃 as frustrated", () => {
    expect(detectSentiment("我快崩溃了")!.label).toBe("frustrated");
  });

  it("detects 怎么又 as frustrated", () => {
    expect(detectSentiment("怎么又出bug了")!.label).toBe("frustrated");
  });

  it("detects 怎么总是 as frustrated", () => {
    expect(detectSentiment("怎么总是这样")!.label).toBe("frustrated");
  });

  it("detects 不靠谱 as frustrated", () => {
    expect(detectSentiment("这个方案太不靠谱了")!.label).toBe("frustrated");
  });

  it("detects 'fucking' as frustrated", () => {
    expect(detectSentiment("This is fucking broken")!.label).toBe("frustrated");
  });

  it("detects 'damn' as frustrated", () => {
    expect(detectSentiment("Damn it, not again")!.label).toBe("frustrated");
  });

  // --- Excited ---
  it("detects 太棒 as excited", () => {
    const result = detectSentiment("太棒了！");
    expect(result).toBeDefined();
    expect(result!.label).toBe("excited");
    expect(result!.confidence).toBe(0.8);
    expect(result!.evidence).toBe("太棒");
  });

  it("detects 太好了 as excited", () => {
    expect(detectSentiment("太好了，终于可以了")!.label).toBe("excited");
  });

  it("detects 太牛 as excited", () => {
    expect(detectSentiment("这个方案太牛了")!.label).toBe("excited");
  });

  it("detects 终于搞定 as excited", () => {
    expect(detectSentiment("终于搞定了！")!.label).toBe("excited");
  });

  it("detects 原来如此 as excited", () => {
    expect(detectSentiment("原来如此，我明白了")!.label).toBe("excited");
  });

  it("detects 'amazing' as excited", () => {
    expect(detectSentiment("This is amazing!")!.label).toBe("excited");
  });

  // --- Confused ---
  it("detects 不明白 as confused", () => {
    const result = detectSentiment("我不明白你的意思");
    expect(result).toBeDefined();
    expect(result!.label).toBe("confused");
    expect(result!.confidence).toBe(0.75);
  });

  it("detects 什么意思 as confused", () => {
    expect(detectSentiment("你说的什么意思")!.label).toBe("confused");
  });

  it("detects 没看懂 as confused", () => {
    expect(detectSentiment("这段代码没看懂")!.label).toBe("confused");
  });

  it("detects 怎么回事 as confused", () => {
    expect(detectSentiment("这是怎么回事")!.label).toBe("confused");
  });

  it("detects 'confused' as confused", () => {
    expect(detectSentiment("I'm confused about this")!.label).toBe("confused");
  });

  it("detects 能解释一下吗 as confused", () => {
    expect(detectSentiment("能解释一下吗？")!.label).toBe("confused");
  });

  // --- Neutral (returns undefined) ---
  it("returns undefined for neutral messages", () => {
    expect(detectSentiment("今天天气不错")).toBeUndefined();
  });

  it("returns undefined for simple questions", () => {
    expect(detectSentiment("这个函数怎么用？")).toBeUndefined();
  });

  it("returns undefined for technical discussion", () => {
    expect(detectSentiment("我们需要重构这个模块的架构")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(detectSentiment("")).toBeUndefined();
  });

  it("returns undefined for plain English", () => {
    expect(detectSentiment("Let's schedule a meeting tomorrow")).toBeUndefined();
  });
});
