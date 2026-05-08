import { randomUUID } from "node:crypto";
import type { CorrectionRecord } from "./types.js";

const CORRECTION_SIGNAL_PATTERNS: RegExp[] = [
  // Chinese correction patterns
  /不对[，。]?/,
  /不是这个/,
  /换一个/,
  /错了/,
  /不对[吧啊]?/,
  /搞错/,
  /重新来/,
  /不要[用这那样]/,
  /应该是/,
  /别[用这那样]/,
  /不能[这样那样]/,
  /不[是对]这样/,
  /应该用/,
  /怎么还是/,
  // English correction patterns
  /\bwrong\b/i,
  /\bnot (that|this|right|correct)\b/i,
  /\btry (again|a different)\b/i,
  /\bincorrect\b/i,
  /\bshould (use|be|do)\b/i,
  /\bdon't use\b/i,
  /\buse .* instead\b/i,
  // Agent apology patterns (signals that agent acknowledged an error)
  /抱歉[，。]?/,
  /对不起[，。]?/,
  /\bsorry\b/i,
  /我错了/,
  /是我的[错失误]/,
  /重新[做试写]/,
];

export function hasCorrectionSignals(transcript: string): boolean {
  if (!transcript || transcript.length === 0) {
    return false;
  }
  for (const pattern of CORRECTION_SIGNAL_PATTERNS) {
    if (pattern.test(transcript)) {
      return true;
    }
  }
  return false;
}

export async function extractCorrectionsFromTranscript(
  transcript: string,
  generateText: (prompt: string) => Promise<string>,
): Promise<CorrectionRecord[]> {
  const cappedTranscript = transcript.length > 8000
    ? transcript.slice(0, 8000)
    : transcript;

  const prompt = buildExtractionPrompt(cappedTranscript);

  try {
    const raw = await generateText(prompt);
    const parsed = parseExtractionResponse(raw);
    const now = Date.now();

    return parsed.map((item) => ({
      id: randomUUID(),
      domain: item.domain ?? "general",
      trigger: item.trigger ?? "general",
      mistake: item.mistake,
      correction: item.correction,
      provenance: "user" as const,
      reinforcedCount: 0,
      createdAt: now,
      lastReinforced: now,
    }));
  } catch {
    return [];
  }
}

function buildExtractionPrompt(transcript: string): string {
  return `分析以下对话记录，提取所有用户对助手行为的纠正。一个纠正发生在以下情况：
1. 用户告诉助手它做错了某事
2. 助手道歉并纠正了自己的行为
3. 用户建议了更好的做法

对每个纠正，提供：
- domain: 相关领域（如 "feishu-doc", "code-review", "general"）
- trigger: 何时应该应用此纠正（如 "创建飞书文档时"）
- mistake: 助手做错了什么（简洁，一句话）
- correction: 正确的做法是什么（简洁，一句话）

仅输出 JSON 数组，不要其他内容：
[{"domain":"...","trigger":"...","mistake":"...","correction":"..."}]

如果没有发现纠正，输出空数组 []。

对话记录：
${transcript}`;
}

function parseExtractionResponse(raw: string): Array<{ domain?: string; trigger?: string; mistake: string; correction: string }> {
  let jsonStr = raw.trim();

  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1]!.trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        parsed = JSON.parse(arrayMatch[0]);
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(
    (item): item is { domain?: string; trigger?: string; mistake: string; correction: string } => {
      if (typeof item !== "object" || item === null) {
        return false;
      }
      const obj = item as Record<string, unknown>;
      return typeof obj.mistake === "string" && typeof obj.correction === "string"
        && (obj.mistake as string).length > 0 && (obj.correction as string).length > 0;
    },
  );
}
