/**
 * Shared helpers for LLM-as-judge call sites (skill quality gate, skill reviewer).
 *
 * Extracted so both judges share one lenient JSON parser and one draft-body
 * truncation budget — duplicated copies had drifted and swallowed failure
 * context (issue #27: a timeout, a fenced response, and a genuinely bad draft
 * were all indistinguishable "LLM parse error" outcomes).
 */

/**
 * Lenient JSON extraction for LLM responses.
 *
 * Handles the common judge output shapes before giving up:
 * 1. the response is the JSON object itself,
 * 2. the JSON is wrapped in a markdown code fence,
 * 3. the JSON is embedded in surrounding prose (first `{` … last `}`).
 *
 * Truncated output (verdict cut off at maxTokens) and multi-object output
 * still throw — callers surface that as `evaluator_invalid_json` instead of
 * pretending the judged draft was bad.
 */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();

  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      // Whole-body parse failed — try fence/brace extraction below.
    }
  }

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  if (fenced?.[1]?.trim().startsWith("{")) {
    try {
      return JSON.parse(fenced[1].trim()) as unknown;
    } catch {
      // Fall through to brace extraction.
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in LLM response");
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
}

/**
 * Cap on draft body sent to a judge. Long drafts inflate the judge context and
 * push the JSON verdict past maxTokens — a truncated verdict always fails to
 * parse, which used to masquerade as a quality score of 0.
 */
export const JUDGE_BODY_MAX_CHARS = 6000;

/** Truncate an oversized judge input, marking the cut so the judge knows. */
export function truncateForJudge(body: string, maxChars = JUDGE_BODY_MAX_CHARS): string {
  if (body.length <= maxChars) {
    return body;
  }
  const omitted = body.length - maxChars;
  return `${body.slice(0, maxChars)}\n\n[... body truncated, ${omitted} chars omitted ...]`;
}

/**
 * Appended on the second judge attempt when the first response was not valid
 * JSON — nudges fence-wrapping and chatty models back to bare JSON.
 */
export const STRICT_JSON_SUFFIX =
  "\n\nIMPORTANT: Respond with ONLY the JSON object. No prose before or after it, no markdown code fences.";
