import type { PersonaTree } from "../types.js";
import type { ExtractionResult } from "./types.js";
import { detectSentiment } from "./sentiment-detector.js";

/**
 * Negation patterns that indicate the user is expressing disinterest.
 * Checked in a window around keyword matches (±30 chars covers both
 * Chinese compact clauses and English phrases like "not interested in [topic]").
 */
const NEGATION_PATTERNS: ReadonlyArray<RegExp> = [
  // Chinese single negation
  /不喜欢/,
  /不感兴趣/,
  /没兴趣/,
  /不想搞/,
  /不需要/,
  /不关心/,
  /不关注/,
  /不是.{0,10}迷/,
  /不是.{0,10}粉/,
  // English negation
  /not\s+interested/i,
  /don'?t\s+like/i,
  /do\s+not\s+like/i,
  /don'?t\s+care/i,
  /do\s+not\s+care/i,
  /don'?t\s+want/i,
  /do\s+not\s+want/i,
  /don'?t\s+need/i,
  /do\s+not\s+need/i,
  /not\s+a\s+fan/i,
];

/** Double-negation patterns — if present nearby, the keyword is affirmed. */
const DOUBLE_NEGATION_PATTERNS: ReadonlyArray<RegExp> = [
  /不是.{0,10}不(?:喜欢|感兴趣|想|需要|关心|关注)/,
];

const BLACKLIST_PATTERNS: ReadonlyArray<{ pattern: RegExp }> = [
  { pattern: /永远不要跟我提(.{1,30}?)(?:了|吧|了啊)?$/ },
  { pattern: /别再跟我说(.{1,30}?)(?:了|吧|了啊)?$/ },
  { pattern: /以后别提(.{1,30}?)(?:了|吧|了啊)?$/ },
  { pattern: /我受够了(.{1,30}?)(?:了|吧|了啊)?$/ },
  { pattern: /不想再听到(.{1,30}?)(?:了|吧|了啊)?$/ },
  { pattern: /拉黑(.{1,30}?)(?:了|吧|了啊)?$/ },
  { pattern: /never mention (?:about )?(.{1,40}?) again/i },
  { pattern: /stop talking about (.+?)$/i },
  { pattern: /don'?t ever mention (.+?)$/i },
  { pattern: /i'?m sick of (.+?)$/i },
  { pattern: /blacklist (.+?)$/i },
  { pattern: /ban (.+?)$/i },
];

export function detectBlacklistIntent(userMessage: string): string[] {
  const results: string[] = [];
  for (const { pattern } of BLACKLIST_PATTERNS) {
    const match = userMessage.match(pattern);
    if (match?.[1]) {
      results.push(match[1].trim());
    }
  }
  return results;
}

const CLAUSE_DELIMITERS = /[,，。！？!?\n\r;；]/;

function getClauseContaining(text: string, index: number): string {
  let start = 0;
  for (let i = index; i >= 0; i--) {
    if (CLAUSE_DELIMITERS.test(text[i] ?? "")) {
      start = i + 1;
      break;
    }
  }
  let end = text.length;
  for (let i = index; i < text.length; i++) {
    if (CLAUSE_DELIMITERS.test(text[i] ?? "")) {
      end = i;
      break;
    }
  }
  return text.slice(start, end);
}

function isKeywordNegated(text: string, keyword: string, index: number): boolean {
  const clause = getClauseContaining(text, index);

  for (const pattern of DOUBLE_NEGATION_PATTERNS) {
    if (pattern.test(clause)) return false;
  }

  for (const pattern of NEGATION_PATTERNS) {
    if (pattern.test(clause)) return true;
  }

  return false;
}

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

  const userLower = userMessage.toLowerCase();
  const assistantLower = assistantMessage.toLowerCase();

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
    const userMatches: Array<{ keyword: string; negated: boolean }> = [];
    let assistantMatchCount = 0;

    for (const kw of keywords) {
      let userIndex = userLower.indexOf(kw);
      while (userIndex !== -1) {
        const negated = isKeywordNegated(userLower, kw, userIndex);
        userMatches.push({ keyword: kw, negated });
        userIndex = userLower.indexOf(kw, userIndex + kw.length);
      }

      if (assistantLower.includes(kw)) {
        assistantMatchCount++;
      }
    }

    const uniqueUserMatches = new Map<string, boolean>();
    for (const m of userMatches) {
      if (!uniqueUserMatches.has(m.keyword)) {
        uniqueUserMatches.set(m.keyword, m.negated);
      }
    }

    const userPositiveCount = [...uniqueUserMatches.values()].filter((n) => !n).length;
    const userNegatedCount = [...uniqueUserMatches.values()].filter((n) => n).length;
    const totalPositive = userPositiveCount + assistantMatchCount;

    const allUserNegated = userNegatedCount > 0 && userPositiveCount === 0;
    const hasOnlyNegatedUserKeywords = allUserNegated && assistantMatchCount === 0;

    if (totalPositive >= 1) {
      domains.push({
        name: domain,
        depth: totalPositive >= 3 ? 5 : totalPositive >= 2 ? 3 : 1,
        insights: [],
        questions: [],
      });
    } else if (hasOnlyNegatedUserKeywords) {
      domains.push({
        name: domain,
        depth: 1,
        insights: [],
        questions: [],
        negated: true,
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
  const questionMatches = userMessage.match(/[^。！？,.!?;；\n\r]{2,80}[？?]/g);
  if (questionMatches) {
    for (const q of questionMatches.slice(0, 3)) {
      const cleaned = q
        .replace(/\\n/g, " ")
        .replace(/\\[\\"]/g, "")
        .replace(/[#*_~`>|]/g, "")
        .trim();
      if (cleaned.length >= 4 && cleaned.length <= 100) {
        pendingQuestions.push(cleaned);
      }
    }
  }

  // Extract recent focus from message
  const nouns = extractKeyPhrases(userMessage);
  recentFocus.push(...nouns.slice(0, 5));

  const sentiment = detectSentiment(userMessage);
  const blacklistRequests = detectBlacklistIntent(userMessage);

  const result: ExtractionResult = {
    attributes,
    domains,
    recentFocus,

    blacklistRequests: blacklistRequests.length > 0 ? blacklistRequests : undefined,
    sentiment,
  };
  return result;
}

const NOISE_PATTERNS: ReadonlyArray<RegExp> = [
  /^```.*$/,
  /^`[^`]+`$/,
  /^\s*$/,
  /^\d+$/,
  /^(yes|no|ok|okay|好的|嗯|是|不是|对|不对|哈|啊|呢|吧|么|吗|哦|噢)$/i,
  /^(if|the|a|an|is|are|was|were|be|been|being|do|does|did|will|would|can|could|should|may|might|shall|to|of|in|for|on|with|at|by|from|as|into|about|this|that|these|those|it|its|or|and|but|not|no|so|than|too|very)$/i,
];

function isNoisePhrase(s: string): boolean {
  for (const pat of NOISE_PATTERNS) {
    if (pat.test(s)) return true;
  }
  if (/^[\s\p{P}\p{S}\p{C}]+$/u.test(s)) return true;
  if (/^[\d\s,.\-+/\\#@$%^&*(){}[\]|~`]+$/.test(s)) return true;
  return false;
}

/**
 * Simple key phrase extraction — split on common delimiters and filter.
 */
function extractKeyPhrases(text: string): string[] {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "");
  const phrases = cleaned
    .split(/[，。！？,.!?\n\r;；:：\s—–\-_=+|/\\{}[\]()]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 30 && !isNoisePhrase(s));
  return [...new Set(phrases)].slice(0, 5);
}
