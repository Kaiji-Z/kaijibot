import type { PersonaTree } from "../types.js";
import type { ExtractionResult } from "./types.js";

/**
 * Extract persona attributes from a conversation turn using rule-based analysis.
 *
 * This is the Phase 2 version — purely rule-based, no LLM call.
 * Phase 4 will add LLM-based deep extraction.
 *
 * This function MUST be cheap and fast (<50ms).
 */
export function extractFromMessage(
  userMessage: string,
  assistantMessage: string,
  _existingPersona?: PersonaTree,
): ExtractionResult {
  const attributes: ExtractionResult["attributes"] = [];
  const domains: ExtractionResult["domains"] = [];
  const recentFocus: string[] = [];
  const pendingQuestions: string[] = [];

  const combined = `${userMessage} ${assistantMessage}`.toLowerCase();

  // Detect domain mentions
  const domainKeywords: Record<string, string[]> = {
    "AI/机器学习": [
      "ai",
      "人工智能",
      "ml",
      "机器学习",
      "深度学习",
      "llm",
      "大模型",
      "transformer",
      "neural",
      "gpt",
      "glm",
    ],
    软件架构: [
      "架构",
      "微服务",
      "monolith",
      "系统设计",
      "分布式",
      "architecture",
      "design pattern",
    ],
    编程语言: [
      "typescript",
      "python",
      "rust",
      "go",
      "java",
      "c++",
      "编程",
      "代码",
      "编程语言",
    ],
    产品思维: ["产品", "用户", "体验", "需求", "pm", "product", "ux", "设计"],
    "创业/商业": [
      "创业",
      "商业",
      "市场",
      "融资",
      "startup",
      "business",
      "战略",
      "竞争",
    ],
    数据科学: ["数据", "分析", "统计", "可视化", "data", "analytics", "dashboard"],
    网络安全: ["安全", "加密", "漏洞", "攻击", "security", "hack", "privacy", "隐私"],
    "云/基础设施": [
      "云",
      "docker",
      "k8s",
      "kubernetes",
      "部署",
      "devops",
      "infrastructure",
      "server",
    ],
  };

  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    const matchCount = keywords.filter((kw) => combined.includes(kw)).length;
    if (matchCount >= 1) {
      domains.push({
        name: domain,
        depth: matchCount >= 3 ? 5 : matchCount >= 2 ? 3 : 1,
        insights: [],
        questions: [],
      });
    }
  }

  // Detect explicit self-disclosure patterns
  const disclosurePatterns: Array<{
    pattern: RegExp;
    trait: string;
    source: "explicit" | "inferred";
  }> = [
    {
      pattern: /我(?:是|做|在|负责|擅长|专注于?)\s*(.{2,20})/,
      trait: "自我描述",
      source: "explicit",
    },
    {
      pattern: /我(?:的工作|职业|岗位|职位)\s*(?:是|做)?\s*(.{2,20})/,
      trait: "职业",
      source: "explicit",
    },
    {
      pattern: /(?:我的|我们的?)\s*(?:项目|团队|公司)\s*(.{2,30})/,
      trait: "项目/组织",
      source: "explicit",
    },
  ];

  for (const { pattern, trait, source } of disclosurePatterns) {
    const match = userMessage.match(pattern);
    if (match?.[1]) {
      attributes.push({
        field: `identity.coreTraits.${trait}`,
        value: match[1].trim(),
        confidence: source === "explicit" ? 0.8 : 0.5,
        source,
        evidence: match[0],
      });
    }
  }

  // Detect questions as pending questions
  const questionMatches = userMessage.match(/[？?].*$/gm);
  if (questionMatches) {
    for (const q of questionMatches.slice(0, 3)) {
      pendingQuestions.push(q.trim());
    }
  }

  // Extract recent focus from message
  const nouns = extractKeyPhrases(userMessage);
  recentFocus.push(...nouns.slice(0, 5));

  return { attributes, domains, recentFocus, pendingQuestions };
}

/**
 * Simple key phrase extraction — split on common delimiters and filter.
 */
function extractKeyPhrases(text: string): string[] {
  // Very simple: split on punctuation and take phrases 2-10 chars
  const phrases = text
    .split(/[，。！？,.!?\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 20);
  return [...new Set(phrases)].slice(0, 5);
}
