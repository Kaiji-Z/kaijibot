import { describe, it, expect } from "vitest";
import { scoreSerendipity } from "./serendipity-scorer.js";

describe("scoreSerendipity", () => {
  it("returns high relevance for strong domain match", () => {
    const result = scoreSerendipity({
      domainRelevance: 0.9,
      userConnectingDomains: 0,
      isRepeat: false,
      topicRecency: 1,
      trustScore: 0.5,
    });
    expect(result.relevance).toBe(0.9);
  });

  it("returns high surprise when few connecting domains", () => {
    const result = scoreSerendipity({
      domainRelevance: 0.5,
      userConnectingDomains: 0,
      isRepeat: false,
      topicRecency: 0.5,
      trustScore: 0.5,
    });
    expect(result.surprise).toBe(1);
  });

  it("returns low surprise when many connecting domains", () => {
    const result = scoreSerendipity({
      domainRelevance: 0.5,
      userConnectingDomains: 5,
      isRepeat: false,
      topicRecency: 0.5,
      trustScore: 0.5,
    });
    expect(result.surprise).toBe(0);
  });

  it("returns 0 novelty for repeats", () => {
    const result = scoreSerendipity({
      domainRelevance: 0.5,
      userConnectingDomains: 0,
      isRepeat: true,
      topicRecency: 0.5,
      trustScore: 0.5,
    });
    expect(result.novelty).toBe(0);
  });

  it("returns composite between 0 and 1", () => {
    const result = scoreSerendipity({
      domainRelevance: 0.7,
      userConnectingDomains: 2,
      isRepeat: false,
      topicRecency: 0.8,
      trustScore: 0.6,
    });
    expect(result.composite).toBeGreaterThan(0);
    expect(result.composite).toBeLessThanOrEqual(1);
  });

  it("weights relevance more at low trust", () => {
    const lowTrust = scoreSerendipity({
      domainRelevance: 0.8,
      userConnectingDomains: 1,
      isRepeat: false,
      topicRecency: 0.5,
      trustScore: 0.1,
    });
    const highTrust = scoreSerendipity({
      domainRelevance: 0.3,
      userConnectingDomains: 1,
      isRepeat: false,
      topicRecency: 0.5,
      trustScore: 0.9,
    });
    // At low trust + high relevance, composite should be higher than
    // high trust + low relevance (relevance weight dominates at low trust)
    expect(lowTrust.composite).toBeGreaterThan(highTrust.composite);
  });
});
