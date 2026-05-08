import { complete, type Api, type Model } from "@mariozechner/pi-ai";
import { randomUUID } from "node:crypto";
import type { ResolvedProviderAuth } from "../../agents/model-auth.js";
import { prepareSimpleCompletionModel } from "../../agents/simple-completion-runtime.js";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import type { Fragment, FragmentKind } from "./fragment-types.js";
import { FRAGMENT_TTL_MS } from "./fragment-types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("cognitive/fragment-collector");

const VALID_FRAGMENT_KINDS: ReadonlySet<string> = new Set<FragmentKind>([
  "assumption",
  "unresolved_tension",
  "methodological_habit",
  "knowledge_gap",
  "implicit_priority",
  "contradictory_positions",
]);

// ─── Deps ───

export type FragmentCollectorDeps = {
  complete: typeof complete;
  prepareModel: (
    cfg: KaijiBotConfig,
    modelRef?: string,
  ) => Promise<
    | { model: Model<Api>; auth: ResolvedProviderAuth }
    | { error: string }
  >;
};

export function createDefaultFragmentCollectorDeps(): FragmentCollectorDeps {
  return {
    complete,
    prepareModel: async (cfg, modelRef) => {
      const extractionModel = cfg.cognitive?.persona?.extractionModel;
      const modelRefToUse = modelRef ?? extractionModel ?? "zai/glm-5-turbo";
      const [provider, ...modelParts] = modelRefToUse.split("/");
      const modelId = modelParts.join("/") || "glm-5-turbo";
      return prepareSimpleCompletionModel({ cfg, provider, modelId });
    },
  };
}

// ─── Trivial turn detection ───

export function shouldSkipTurn(userText: string): boolean {
  const trimmed = userText.trim();
  if (trimmed.length < 20) return true;
  if (/^(好的|嗯|哦|收到|了解|谢谢|感谢|明白|知道|可以|行|对|是|不错|没问题)[！!。.？?]*$/.test(trimmed)) return true;
  if (/^[\p{P}\p{S}\s]+$/u.test(trimmed)) return true;
  return false;
}

// ─── Main function ───

/**
 * Extract 0-2 thinking pattern fragments from a single conversation turn.
 *
 * This function **never throws** — all errors are caught and result in an
 * empty array being returned.
 */
export async function collectFragments(
  userText: string,
  assistantText: string,
  persona: PersonaTree,
  config: KaijiBotConfig,
  deps: FragmentCollectorDeps,
): Promise<Fragment[]> {
  try {
    if (shouldSkipTurn(userText)) {
      const trimmed = userText.trim();
      const reason = trimmed.length < 20 ? "too_short" : "trivial";
      log.info("fragment collection: turn skipped", { reason, userLength: userText.length });
      return [];
    }

    const prompt = buildFragmentPrompt(userText, assistantText, persona);

    const modelRef = config.cognitive?.persona?.extractionModel;
    const prepared = await deps.prepareModel(config, modelRef);

    if ("error" in prepared) {
      log.warn("fragment-collector model preparation failed, skipping", { error: prepared.error });
      return [];
    }

    const messages: Array<{ role: "user"; content: string; timestamp: number }> = [
      { role: "user", content: prompt, timestamp: Date.now() },
    ];

    const result = await deps.complete(
      prepared.model,
      { messages },
      {
        apiKey: prepared.auth.apiKey,
        maxTokens: 300,
        temperature: 0.7,
        signal: AbortSignal.timeout(10_000),
      },
    );

    const text = result.content
      .filter(
        (block): block is { type: "text"; text: string } =>
          block.type === "text",
      )
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) {
      log.warn("fragment-collector LLM returned empty response, skipping");
      return [];
    }

    const fragments = parseFragments(text);
    if (fragments.length > 0) {
      log.info("fragments extracted", { count: fragments.length, kinds: fragments.map(f => f.kind), domains: [...new Set(fragments.flatMap(f => f.domains))] });
    }
    return fragments;
   } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    log.warn(`fragment-collector ${isTimeout ? "timed out" : "failed"}: ${String(err)}, skipping`);
    return [];
  }
}

// ─── Prompt builder ───

export function buildFragmentPrompt(
  userText: string,
  assistantText: string,
  persona: PersonaTree,
): string {
  const domainNames = Object.entries(persona.domains)
    .sort(([, a], [, b]) => b.lastMentioned - a.lastMentioned)
    .slice(0, 20)
    .map(([name]) => name);
  const truncatedUser = userText.length > 500 ? userText.slice(0, 500) + "…" : userText;
  const truncatedAssistant = assistantText.length > 500 ? assistantText.slice(0, 500) + "…" : assistantText;
  const domainContext = domainNames.length > 0 ? domainNames.join(", ") : "(not yet established)";

  return `Analyze this conversation turn and detect STRUCTURAL thinking patterns — not topics, but how the user thinks.

User's known domains: ${domainContext}

USER SAID:
${truncatedUser}

ASSISTANT REPLIED:
${truncatedAssistant}

Detect up to 2 of these thinking pattern types:
- assumption: unstated assumption the user is making
- unresolved_tension: contradictory positions or ambivalence the user hasn't resolved
- methodological_habit: recurring approach or mental model the user applies
- knowledge_gap: something the user doesn't know they don't know (meta-blindness)
- implicit_priority: a value judgment or priority revealed indirectly
- contradictory_positions: two incompatible views expressed in the same turn

CRITICAL: Do NOT extract topics. Extract what they DON'T know about their own thinking. Focus on structural cognitive patterns, not content.

Each fragment MUST include at least 2 domains (fields of knowledge). Look for connections between domains in the user's thinking. For example, if they discuss a programming concept, consider what broader domain it connects to (software architecture, distributed systems, etc.). Use the user's known domains above when possible.

Respond with ONLY a JSON array (no markdown, no code fences):
[
  {
    "kind": "assumption",
    "evidence": "brief quote or paraphrase from the conversation",
    "domains": ["domain-a", "domain-b"],
    "structuralTag": "one-word tag for the thinking pattern",
    "strength": 0.7
  }
]

Return [] if no clear thinking patterns are detectable. Maximum 2 items.`;
}

// ─── Response parser ───

export function parseFragments(text: string): Fragment[] {
  try {
    const cleaned = text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim();

    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) {
      return [];
    }

    const jsonStr = cleaned.slice(start, end + 1);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      log.warn("parseFragments: JSON parse failed", { raw: jsonStr.slice(0, 200) });
      return [];
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    const now = Date.now();

    return parsed
      .filter((item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
      )
      .filter((item) => {
        const kind = item.kind;
        return typeof kind === "string" && VALID_FRAGMENT_KINDS.has(kind);
      })
      .filter((item) => {
        const evidence = item.evidence;
        const structuralTag = item.structuralTag;
        return typeof evidence === "string" && evidence.length > 0
          && typeof structuralTag === "string" && structuralTag.length > 0;
      })
      .slice(0, 2)
      .map((item) => {
        const strength = typeof item.strength === "number"
          ? Math.max(0, Math.min(1, item.strength))
          : 0.5;

        const domains = Array.isArray(item.domains)
          ? item.domains.filter((d: unknown) => typeof d === "string").map(String)
          : [];

        return {
          id: randomUUID(),
          userId: "",
          createdAt: now,
          expiresAt: now + FRAGMENT_TTL_MS,
          kind: item.kind as FragmentKind,
          evidence: String(item.evidence).slice(0, 200),
          domains,
          structuralTag: String(item.structuralTag),
          strength,
          initialStrength: strength,
        } satisfies Fragment;
      });
  } catch (err) {
    log.warn("parseFragments: unexpected error", { error: String(err) });
    return [];
  }
}
