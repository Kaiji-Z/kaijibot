import { describe, it, expect } from "vitest";
import { verifyInsight } from "./pipeline.js";

describe("verifyInsight", () => {
  it("returns unverified with no sources", () => {
    const result = verifyInsight({
      content: "Some claim",
      sources: [],
      verificationLevel: "basic",
    });
    expect(result.status).toBe("unverified");
    expect(result.confidence).toBe(0);
  });

  it("returns unverified when all sources have low credibility", () => {
    const result = verifyInsight({
      content: "Some claim",
      sources: [{ url: "https://example.com", title: "Example", credibility: 0.1 }],
      verificationLevel: "basic",
    });
    expect(result.status).toBe("unverified");
  });

  it("returns partial with one credible source on basic level", () => {
    const result = verifyInsight({
      content: "Some claim",
      sources: [{ url: "https://example.com", title: "Example", credibility: 0.5 }],
      verificationLevel: "basic",
    });
    expect(result.status).toBe("partial");
  });

  it("returns partial with one credible source on strict level", () => {
    const result = verifyInsight({
      content: "Some claim",
      sources: [{ url: "https://example.com", title: "Example", credibility: 0.7 }],
      verificationLevel: "strict",
    });
    expect(result.status).toBe("partial");
  });

  it("returns verified with 2+ credible sources on strict level", () => {
    const result = verifyInsight({
      content: "Some claim",
      sources: [
        { url: "https://a.com", title: "A", credibility: 0.7 },
        { url: "https://b.com", title: "B", credibility: 0.8 },
      ],
      verificationLevel: "strict",
    });
    expect(result.status).toBe("verified");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("returns partial on paranoid level with fewer than 3 high-cred sources", () => {
    const result = verifyInsight({
      content: "Some claim",
      sources: [
        { url: "https://a.com", title: "A", credibility: 0.6 },
        { url: "https://b.com", title: "B", credibility: 0.7 },
      ],
      verificationLevel: "paranoid",
    });
    expect(result.status).toBe("partial");
  });

  it("returns verified on paranoid level with 3+ high-cred sources", () => {
    const result = verifyInsight({
      content: "Some claim",
      sources: [
        { url: "https://a.com", title: "A", credibility: 0.6 },
        { url: "https://b.com", title: "B", credibility: 0.7 },
        { url: "https://c.com", title: "C", credibility: 0.8 },
      ],
      verificationLevel: "paranoid",
    });
    expect(result.status).toBe("verified");
    expect(result.confidence).toBeGreaterThan(0);
  });
});
