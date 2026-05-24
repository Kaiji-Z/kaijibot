import { describe, it, expect } from "vitest";
import { extractFromMessage, detectBlacklistIntent } from "./extractor.js";

describe("extractFromMessage — domain detection", () => {
  it("returns no domains — domain detection is LLM-driven, not rule-based", () => {
    const result = extractFromMessage("我想学习机器学习和深度学习", "Python是一门很好的编程语言");
    expect(result.domains).toHaveLength(0);
  });

  it("returns no domains even when keywords are present", () => {
    const result = extractFromMessage("我们在用docker部署微服务架构", "");
    expect(result.domains).toHaveLength(0);
  });
});

describe("extractFromMessage — attributes and recentFocus", () => {
  it("extracts self-disclosure attributes", () => {
    const result = extractFromMessage("我是工程师，我在做AI相关的工作", "");
    expect(result.attributes.length).toBeGreaterThanOrEqual(1);
    const selfDesc = result.attributes.find((a) => a.field === "identity.coreTraits.自我描述");
    expect(selfDesc).toBeDefined();
    expect(selfDesc?.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("extracts occupation attribute", () => {
    const result = extractFromMessage("我的工作是数据科学家", "");
    const occ = result.attributes.find((a) => a.field === "identity.coreTraits.职业");
    expect(occ).toBeDefined();
  });

  it("extracts project/org attribute", () => {
    const result = extractFromMessage("我们的项目正在做AI架构升级", "");
    const proj = result.attributes.find((a) => a.field === "identity.coreTraits.项目/组织");
    expect(proj).toBeDefined();
  });

  it("populates recentFocus from key phrases", () => {
    const result = extractFromMessage("最近在研究Kubernetes和分布式追踪", "");
    expect(result.recentFocus.length).toBeGreaterThan(0);
  });

  it("returns sentiment for strong emotional signals", () => {
    const result = extractFromMessage("这个东西太烦了，怎么又出问题了", "");
    expect(result.sentiment).toBeDefined();
    expect(result.sentiment?.label).toBe("frustrated");
  });

  it("returns no sentiment for neutral messages", () => {
    const result = extractFromMessage("今天天气不错", "");
    expect(result.sentiment).toBeUndefined();
  });
});

describe("detectBlacklistIntent — Chinese patterns", () => {
  it("detects 永远不要跟我提X", () => {
    const result = detectBlacklistIntent("永远不要跟我提数据科学了");
    expect(result).toContain("数据科学");
  });

  it("detects 别再跟我说X", () => {
    const result = detectBlacklistIntent("别再跟我说机器学习了");
    expect(result).toContain("机器学习");
  });

  it("detects 以后别提X", () => {
    const result = detectBlacklistIntent("以后别提区块链吧");
    expect(result).toContain("区块链");
  });

  it("detects 我受够了X", () => {
    const result = detectBlacklistIntent("我受够了微服务了");
    expect(result).toContain("微服务");
  });

  it("detects 不想再听到X", () => {
    const result = detectBlacklistIntent("不想再听到Kubernetes了");
    expect(result).toContain("Kubernetes");
  });

  it("detects 拉黑X", () => {
    const result = detectBlacklistIntent("拉黑量子计算了");
    expect(result).toContain("量子计算");
  });

  it("returns empty for normal messages", () => {
    const result = detectBlacklistIntent("我想学习机器学习");
    expect(result).toEqual([]);
  });

  it("returns empty for empty string", () => {
    const result = detectBlacklistIntent("");
    expect(result).toEqual([]);
  });
});

describe("detectBlacklistIntent — English patterns", () => {
  it("detects 'never mention X again'", () => {
    const result = detectBlacklistIntent("never mention data science again");
    expect(result).toContain("data science");
  });

  it("detects 'never mention about X again'", () => {
    const result = detectBlacklistIntent("never mention about blockchain again");
    expect(result).toContain("blockchain");
  });

  it("detects 'stop talking about X'", () => {
    const result = detectBlacklistIntent("stop talking about kubernetes");
    expect(result).toContain("kubernetes");
  });

  it('detects "don\'t ever mention X"', () => {
    const result = detectBlacklistIntent("don't ever mention quantum computing");
    expect(result).toContain("quantum computing");
  });

  it('detects "I\'m sick of X"', () => {
    const result = detectBlacklistIntent("I'm sick of microservices");
    expect(result).toContain("microservices");
  });

  it("detects 'blacklist X'", () => {
    const result = detectBlacklistIntent("blacklist crypto");
    expect(result).toContain("crypto");
  });

  it("detects 'ban X'", () => {
    const result = detectBlacklistIntent("ban NFT topics");
    expect(result).toContain("NFT topics");
  });

  it("is case-insensitive for English patterns", () => {
    const result = detectBlacklistIntent("NEVER MENTION AI AGAIN");
    expect(result.some((r) => r.toLowerCase().includes("ai"))).toBe(true);
  });
});

describe("extractFromMessage — blacklistRequests integration", () => {
  it("populates blacklistRequests from Chinese blacklist pattern", () => {
    const result = extractFromMessage("永远不要跟我提数据科学了", "");
    expect(result.blacklistRequests).toBeDefined();
    expect(result.blacklistRequests!.length).toBeGreaterThan(0);
    expect(result.blacklistRequests).toContain("数据科学");
  });

  it("populates blacklistRequests from English blacklist pattern", () => {
    const result = extractFromMessage("never mention blockchain again", "");
    expect(result.blacklistRequests).toBeDefined();
    expect(result.blacklistRequests).toContain("blockchain");
  });

  it("returns undefined blacklistRequests for normal messages", () => {
    const result = extractFromMessage("我想学习机器学习", "");
    expect(result.blacklistRequests).toBeUndefined();
  });

  it("returns multiple blacklist requests from a single message", () => {
    const result = extractFromMessage("永远不要跟我提数据科学了，也别再跟我说区块链了", "");
    expect(result.blacklistRequests).toBeDefined();
    expect(result.blacklistRequests!.length).toBeGreaterThanOrEqual(2);
  });
});
