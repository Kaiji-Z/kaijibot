import { describe, it, expect } from "vitest";

function textToBigrams(text: string): Set<string> {
  const clean = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, "");
  const result = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) {
    result.add(clean.slice(i, i + 2));
  }
  return result;
}

function bigramSimilarity(a: string, b: string): number {
  const setA = textToBigrams(a);
  const setB = textToBigrams(b);
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) {
      intersection++;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const FOLLOWUP_PATTERNS = [
  "展开", "详细", "具体", "深入", "解释", "说明", "什么意思",
  "举例", "例子", "比如", "怎么理解", "怎么看", "继续", "然后呢",
  "接着说", "为什么", "你是说", "你的意思是", "讲讲", "多说点",
  "tell me more", "elaborate", "explain", "what do you mean",
  "how so", "example", "go on", "continue", "interesting",
];

function matchesFollowUp(text: string): boolean {
  const lower = text.toLowerCase();
  return FOLLOWUP_PATTERNS.some((p) => lower.includes(p));
}

describe("bigramSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(bigramSimilarity("空间思维", "空间思维")).toBeCloseTo(1.0, 5);
  });

  it("returns 0 for completely different strings", () => {
    expect(bigramSimilarity("abcdefgh", "xyzwvuts")).toBe(0);
  });

  it("returns 0 for empty strings", () => {
    expect(bigramSimilarity("", "hello")).toBe(0);
    expect(bigramSimilarity("hello", "")).toBe(0);
  });

  it("detects Chinese content overlap — discussing insight", () => {
    const insight = "从建筑设计的承重路径到AI agent的文件系统探路，结构墙必须画在图纸上";
    const userReply = "空间思维确实能用到代码架构上，建筑的承重路径和代码的依赖结构很像";
    expect(bigramSimilarity(userReply, insight)).toBeGreaterThan(0.05);
  });

  it("rejects unrelated Chinese messages", () => {
    const insight = "从建筑设计到AI coding，跨学科生命轨迹的底层逻辑";
    const userReply = "帮我查一下明天北京的天气";
    expect(bigramSimilarity(userReply, insight)).toBeLessThan(0.05);
  });

  it("detects English content overlap", () => {
    const insight = "WebGPU is turning the browser into a local AI runtime";
    const userReply = "WebGPU compute shader performance is impressive for local inference";
    expect(bigramSimilarity(userReply, insight)).toBeGreaterThan(0.12);
  });

  it("handles mixed Chinese-English text", () => {
    const insight = "LookatStudy用Propose→Apply构筑安全沙盒，AI的本质仅作建议";
    const userReply = "LookatStudy的Propose Apply机制确实安全，但GitHub直灌SRS击穿了底线";
    expect(bigramSimilarity(userReply, insight)).toBeGreaterThan(0.15);
  });
});

describe("FOLLOWUP_PATTERNS", () => {
  it("matches Chinese followup requests", () => {
    expect(matchesFollowUp("展开解释一下")).toBe(true);
    expect(matchesFollowUp("详细说说")).toBe(true);
    expect(matchesFollowUp("举个例子？")).toBe(true);
    expect(matchesFollowUp("这个怎么理解")).toBe(true);
    expect(matchesFollowUp("继续")).toBe(true);
    expect(matchesFollowUp("你是说建筑和编程有关系？")).toBe(true);
  });

  it("matches English followup requests", () => {
    expect(matchesFollowUp("tell me more about this")).toBe(true);
    expect(matchesFollowUp("elaborate please")).toBe(true);
    expect(matchesFollowUp("can you explain?")).toBe(true);
    expect(matchesFollowUp("interesting, go on")).toBe(true);
  });

  it("does not match unrelated messages", () => {
    expect(matchesFollowUp("帮我查天气")).toBe(false);
    expect(matchesFollowUp("what time is it")).toBe(false);
    expect(matchesFollowUp("你好")).toBe(false);
  });

  it("does not match empty message", () => {
    expect(matchesFollowUp("")).toBe(false);
  });
});

describe("feedback classification logic", () => {
  const insight = "从建筑设计的承重路径到AI agent的文件系统探路，结构诚实与可读性的张力";

  it("classifies content-discussion as engaged", () => {
    const userMsg = "建筑的承重路径和代码结构确实很像，AI agent的探路也是结构问题";
    const isDiscussing = bigramSimilarity(userMsg, insight) >= 0.08;
    const isFollowUp = matchesFollowUp(userMsg);
    expect(isDiscussing).toBe(true);
    expect(isFollowUp).toBe(false);
    const sentiment = isDiscussing ? "engaged" : "positive";
    expect(sentiment).toBe("engaged");
  });

  it("classifies followup-request as positive", () => {
    const userMsg = "展开解释一下";
    const isDiscussing = bigramSimilarity(userMsg, insight) >= 0.08;
    const isFollowUp = matchesFollowUp(userMsg);
    expect(isDiscussing).toBe(false);
    expect(isFollowUp).toBe(true);
    const sentiment = isDiscussing ? "engaged" : "positive";
    expect(sentiment).toBe("positive");
  });

  it("rejects unrelated message entirely", () => {
    const userMsg = "帮我查一下明天的天气";
    const isDiscussing = bigramSimilarity(userMsg, insight) >= 0.08;
    const isFollowUp = matchesFollowUp(userMsg);
    expect(isDiscussing).toBe(false);
    expect(isFollowUp).toBe(false);
  });
});
