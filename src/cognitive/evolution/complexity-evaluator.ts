import type { EvolutionCandidate, ComplexityResult, ComplexityFactor, TrialErrorResult } from "./types.js";

// --- Trial-and-error detection patterns ---

const CHINESE_CORRECTION_PATTERNS = [
  /不对/g, /不是这个/g, /换一个/g, /再试试/g, /错了/g, /不好/g,
  /不行/g, /重新来/g, /重新做/g, /不对吧/g, /不是这样的/g,
  /不要这个/g, /改一下/g, /换种方式/g, /不是我要的/g, /搞错了/g,
];

const ENGLISH_CORRECTION_PATTERNS = [
  /\bwrong\b/gi, /\bnope\b/gi, /\bnot that\b/gi, /\btry again\b/gi,
  /\bincorrect\b/gi, /\bredo\b/gi, /\bnot what i wanted\b/gi, /\bthat's wrong\b/gi,
];

const AGENT_APOLOGY_PATTERNS = [
  /抱歉/g, /对不起/g, /\bsorry\b/gi, /\bapologize\b/gi,
  /\blet me try again\b/gi, /我来重新/g, /换个思路/g, /重新来/g,
];

const TOOL_CALL_REGEX = /(?:tool[_-]?call|invoke|call)[_:\s]*(\w+)/gi;

const MAX_BOOST = 0.25;

export function detectTrialAndError(candidate: EvolutionCandidate): TrialErrorResult {
  const { transcript, hasTrialAndError, userCorrections: explicitCorrections } = candidate;

  // Early exit: no data to analyze
  if (!transcript && !hasTrialAndError && !explicitCorrections) {
    return { detected: false, signals: [], userCorrections: 0, boost: 0 };
  }

  const signals: string[] = [];
  let boost = 0;

  const text = transcript ?? "";

  // Chinese corrections
  for (const pat of CHINESE_CORRECTION_PATTERNS) {
    pat.lastIndex = 0;
    if (pat.test(text)) {
      const matched = text.match(pat.source.startsWith("\\b")
        ? new RegExp(pat.source, pat.flags)
        : new RegExp(pat.source.replace(/\/g$/, ""), pat.flags));
      signals.push(matched?.[0] ?? pat.source);
      boost += 0.06;
    }
  }

  // English corrections
  for (const pat of ENGLISH_CORRECTION_PATTERNS) {
    pat.lastIndex = 0;
    if (pat.test(text)) {
      const re = new RegExp(pat.source, pat.flags);
      const matched = text.match(re);
      signals.push(matched?.[0] ?? pat.source);
      boost += 0.06;
    }
  }

  // Agent apologies
  for (const pat of AGENT_APOLOGY_PATTERNS) {
    pat.lastIndex = 0;
    if (pat.test(text)) {
      const re = new RegExp(pat.source, pat.flags);
      const matched = text.match(re);
      signals.push(matched?.[0] ?? pat.source);
      boost += 0.04;
    }
  }

  // Repeated tool calls (3+ same tool with different params)
  if (text) {
    const toolCounts = new Map<string, number>();
    const toolRe = new RegExp(TOOL_CALL_REGEX.source, TOOL_CALL_REGEX.flags);
    let m: RegExpExecArray | null;
    while ((m = toolRe.exec(text)) !== null) {
      const toolName = m[1];
      toolCounts.set(toolName, (toolCounts.get(toolName) ?? 0) + 1);
    }
    for (const [toolName, count] of toolCounts) {
      if (count >= 3) {
        signals.push(`repeated:${toolName}:${count}`);
        boost += 0.05;
      }
    }
  }

  // Explicit userCorrections from candidate metadata
  const corrections = explicitCorrections ?? 0;
  if (corrections > 0) {
    boost += corrections * 0.05;
    signals.push(`userCorrections:${corrections}`);
  }

  // If hasTrialAndError flag is set but no signals from transcript, still detect
  const detected = signals.length > 0 || (hasTrialAndError === true);

  const clampedBoost = Math.min(boost, MAX_BOOST);

  return {
    detected,
    signals,
    userCorrections: corrections,
    boost: clampedBoost,
  };
}

export function evaluateComplexity(candidate: EvolutionCandidate): ComplexityResult {
  const factors: ComplexityFactor[] = [
    {
      name: "toolCount",
      raw: candidate.toolCalls.length,
      normalized: Math.min(candidate.toolCalls.length / 20, 1),
      weight: 0.3,
    },
    {
      name: "uniqueTools",
      raw: candidate.uniqueToolCount,
      normalized: Math.min(candidate.uniqueToolCount / 8, 1),
      weight: 0.3,
    },
    {
      name: "reasoningTurns",
      raw: candidate.reasoningTurns,
      normalized: Math.min(candidate.reasoningTurns / 10, 1),
      weight: 0.2,
    },
    {
      name: "duration",
      raw: candidate.durationMs,
      normalized: Math.min(candidate.durationMs / 300_000, 1),
      weight: 0.2,
    },
  ];

  const baseScore = Math.min(
    factors.reduce((sum, f) => sum + f.normalized * f.weight, 0),
    1,
  );

  // Trial-and-error boost
  const trialError = detectTrialAndError(candidate);
  if (trialError.detected) {
    factors.push({
      name: "trialErrorBoost",
      raw: trialError.signals.length,
      normalized: trialError.boost,
      weight: 1,
    });
  }

  const score = Math.min(baseScore + trialError.boost, 1);

  return { score, factors };
}
