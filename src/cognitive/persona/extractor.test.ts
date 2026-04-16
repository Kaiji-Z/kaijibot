import { describe, it, expect } from "vitest";
import { extractFromMessage, detectBlacklistIntent } from "./extractor.js";

function findDomain(result: ReturnType<typeof extractFromMessage>, name: string) {
  return result.domains.find((d) => d.name === name);
}

describe("extractFromMessage — baseline positive matching", () => {
  it("detects AI domain from user message", () => {
    const result = extractFromMessage("我想学习机器学习", "");
    const ai = findDomain(result, "AI/机器学习");
    expect(ai).toBeDefined();
    expect(ai?.negated).toBeFalsy();
  });

  it("detects multiple keywords and assigns higher depth", () => {
    const result = extractFromMessage("我想学习机器学习和深度学习以及大模型", "");
    const ai = findDomain(result, "AI/机器学习");
    expect(ai).toBeDefined();
    expect(ai?.depth).toBeGreaterThanOrEqual(3);
  });

  it("detects domain from assistant message alone", () => {
    const result = extractFromMessage("好的", "Python是一门很好的编程语言");
    const pl = findDomain(result, "编程语言");
    expect(pl).toBeDefined();
    expect(pl?.negated).toBeFalsy();
  });

  it("combines user and assistant keyword matches", () => {
    const result = extractFromMessage("我想学python", "Python是一门很棒的编程语言");
    const pl = findDomain(result, "编程语言");
    expect(pl).toBeDefined();
    expect(pl?.depth).toBeGreaterThanOrEqual(3);
  });

  it("detects 云/基础设施 domain", () => {
    const result = extractFromMessage("我们在用docker部署", "");
    const cloud = findDomain(result, "云/基础设施");
    expect(cloud).toBeDefined();
    expect(cloud?.negated).toBeFalsy();
  });

  it("detects 产品思维 domain", () => {
    const result = extractFromMessage("我觉得这个产品的用户体验不够好", "");
    const product = findDomain(result, "产品思维");
    expect(product).toBeDefined();
    expect(product?.negated).toBeFalsy();
  });

  it("returns no domains when no keywords match", () => {
    const result = extractFromMessage("今天天气真好", "是的呢");
    expect(result.domains).toHaveLength(0);
  });
});

describe("extractFromMessage — Chinese negation patterns", () => {
  it("不喜欢 negates domain", () => {
    const result = extractFromMessage("我不喜欢数据科学", "");
    const ds = findDomain(result, "数据科学");
    expect(ds).toBeDefined();
    expect(ds?.negated).toBe(true);
  });

  it("不感兴趣 negates domain", () => {
    const result = extractFromMessage("我对网络安全不感兴趣", "");
    const sec = findDomain(result, "网络安全");
    expect(sec).toBeDefined();
    expect(sec?.negated).toBe(true);
  });

  it("没兴趣 negates domain", () => {
    const result = extractFromMessage("我对创业没兴趣", "");
    const biz = findDomain(result, "创业/商业");
    expect(biz).toBeDefined();
    expect(biz?.negated).toBe(true);
  });

  it("不想搞 negates domain", () => {
    const result = extractFromMessage("我不想搞机器学习了", "");
    const ai = findDomain(result, "AI/机器学习");
    expect(ai).toBeDefined();
    expect(ai?.negated).toBe(true);
  });

  it("不需要 negates domain", () => {
    const result = extractFromMessage("我们不需要数据分析了", "");
    const ds = findDomain(result, "数据科学");
    expect(ds).toBeDefined();
    expect(ds?.negated).toBe(true);
  });

  it("不关心 negates domain", () => {
    const result = extractFromMessage("我不关心安全方面的东西", "");
    const sec = findDomain(result, "网络安全");
    expect(sec).toBeDefined();
    expect(sec?.negated).toBe(true);
  });

  it("不关注 negates domain", () => {
    const result = extractFromMessage("我不关注创业相关的事", "");
    const biz = findDomain(result, "创业/商业");
    expect(biz).toBeDefined();
    expect(biz?.negated).toBe(true);
  });

  it("不是...迷 negates domain", () => {
    const result = extractFromMessage("我不是AI迷", "");
    const ai = findDomain(result, "AI/机器学习");
    expect(ai).toBeDefined();
    expect(ai?.negated).toBe(true);
  });

  it("不是...粉 negates domain", () => {
    const result = extractFromMessage("我不是python粉", "");
    const pl = findDomain(result, "编程语言");
    expect(pl).toBeDefined();
    expect(pl?.negated).toBe(true);
  });
});

describe("extractFromMessage — English negation patterns", () => {
  it("not interested negates domain", () => {
    const result = extractFromMessage("I'm not interested in data science", "");
    const ds = findDomain(result, "数据科学");
    expect(ds).toBeDefined();
    expect(ds?.negated).toBe(true);
  });

  it("don't like negates domain", () => {
    const result = extractFromMessage("I don't like security stuff", "");
    const sec = findDomain(result, "网络安全");
    expect(sec).toBeDefined();
    expect(sec?.negated).toBe(true);
  });

  it("don't care negates domain", () => {
    const result = extractFromMessage("I don't care about data analytics", "");
    const ds = findDomain(result, "数据科学");
    expect(ds).toBeDefined();
    expect(ds?.negated).toBe(true);
  });

  it("don't want negates domain", () => {
    const result = extractFromMessage("I don't want to learn Python", "");
    const pl = findDomain(result, "编程语言");
    expect(pl).toBeDefined();
    expect(pl?.negated).toBe(true);
  });

  it("don't need negates domain", () => {
    const result = extractFromMessage("We don't need kubernetes", "");
    const cloud = findDomain(result, "云/基础设施");
    expect(cloud).toBeDefined();
    expect(cloud?.negated).toBe(true);
  });

  it("not a fan negates domain", () => {
    const result = extractFromMessage("I'm not a fan of TypeScript", "");
    const pl = findDomain(result, "编程语言");
    expect(pl).toBeDefined();
    expect(pl?.negated).toBe(true);
  });

  it("do not like negates domain (uncontracted)", () => {
    const result = extractFromMessage("I do not like AI", "");
    const ai = findDomain(result, "AI/机器学习");
    expect(ai).toBeDefined();
    expect(ai?.negated).toBe(true);
  });
});

describe("extractFromMessage — mixed negation scenarios", () => {
  it("one domain negated, another affirmed in same message", () => {
    const result = extractFromMessage(
      "我不喜欢数据科学，但我很喜欢机器学习",
      "",
    );
    const ds = findDomain(result, "数据科学");
    expect(ds?.negated).toBe(true);

    const ai = findDomain(result, "AI/机器学习");
    expect(ai).toBeDefined();
    expect(ai?.negated).toBeFalsy();
    expect((ai?.depth ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it("user negates but assistant affirms — domain is positive", () => {
    const result = extractFromMessage(
      "我不喜欢数据科学",
      "数据科学其实很有趣，它包括数据分析和可视化等技术",
    );
    const ds = findDomain(result, "数据科学");
    expect(ds).toBeDefined();
    expect(ds?.negated).toBeFalsy();
  });

  it("user negates keyword that also appears in assistant positively", () => {
    const result = extractFromMessage(
      "我不关心安全",
      "安全是系统设计中很重要的一环",
    );
    const sec = findDomain(result, "网络安全");
    expect(sec).toBeDefined();
    expect(sec?.negated).toBeFalsy();
  });

  it("negated domain does not appear when unrelated positive keywords exist", () => {
    const result = extractFromMessage("我不喜欢数据，但我爱typescript", "");
    const ds = findDomain(result, "数据科学");
    expect(ds?.negated).toBe(true);

    const pl = findDomain(result, "编程语言");
    expect(pl).toBeDefined();
    expect(pl?.negated).toBeFalsy();
  });
});

describe("extractFromMessage — double negation", () => {
  it("不是不喜欢 is NOT negated (affirmed)", () => {
    const result = extractFromMessage("我不是不喜欢数据科学", "");
    const ds = findDomain(result, "数据科学");
    expect(ds).toBeDefined();
    expect(ds?.negated).toBeFalsy();
  });

  it("不是不感兴趣 is NOT negated (affirmed)", () => {
    const result = extractFromMessage("我不是对机器学习不感兴趣", "");
    const ai = findDomain(result, "AI/机器学习");
    expect(ai).toBeDefined();
    expect(ai?.negated).toBeFalsy();
  });

  it("不是不需要 is NOT negated (affirmed)", () => {
    const result = extractFromMessage("我们不是不需要数据分析", "");
    const ds = findDomain(result, "数据科学");
    expect(ds).toBeDefined();
    expect(ds?.negated).toBeFalsy();
  });
});

describe("extractFromMessage — assistant-only messages never negate", () => {
  it("assistant explaining a topic with negation-like words still counts positive", () => {
    const result = extractFromMessage(
      "什么是微服务？",
      "有些人不喜欢微服务架构，但它有它的优势",
    );
    const arch = findDomain(result, "软件架构");
    expect(arch).toBeDefined();
    expect(arch?.negated).toBeFalsy();
  });

  it("assistant message with negation keywords is always positive", () => {
    const result = extractFromMessage(
      "讲讲安全吧",
      "不是所有人都关心安全，但这很重要。安全涉及加密和隐私",
    );
    const sec = findDomain(result, "网络安全");
    expect(sec).toBeDefined();
    expect(sec?.negated).toBeFalsy();
  });
});

describe("extractFromMessage — attributes and questions still work", () => {
  it("still extracts self-disclosure attributes alongside negation", () => {
    const result = extractFromMessage("我是工程师，我不喜欢数据科学", "");
    expect(result.attributes.length).toBeGreaterThanOrEqual(1);
    const ds = findDomain(result, "数据科学");
    expect(ds?.negated).toBe(true);
  });

  it("still detects pending questions alongside negation", () => {
    const result = extractFromMessage("我不喜欢数据，但机器学习怎么做？", "");
    expect(result.pendingQuestions.length).toBeGreaterThanOrEqual(1);
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

  it("detects \"don't ever mention X\"", () => {
    const result = detectBlacklistIntent("don't ever mention quantum computing");
    expect(result).toContain("quantum computing");
  });

  it("detects \"I'm sick of X\"", () => {
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
