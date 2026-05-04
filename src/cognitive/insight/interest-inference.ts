import { complete, type Api, type Model } from "@mariozechner/pi-ai";

import type { ResolvedProviderAuth } from "../../agents/model-auth.js";
import { prepareSimpleCompletionModel } from "../../agents/simple-completion-runtime.js";
import type { KaijiBotConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { PersonaTree } from "../types.js";
import type { InferenceResult, InsightEngineInput, SearchStrategy } from "./types.js";

const log = createSubsystemLogger("cognitive/interest-inference");

// ---------------------------------------------------------------------------
// Deps — mirrors LlmInsightDeps pattern for testability
// ---------------------------------------------------------------------------

export type InterestInferenceDeps = {
  complete: typeof complete;
  prepareModel: (
    cfg: KaijiBotConfig,
    modelRef?: string,
  ) => Promise<
    | { model: Model<Api>; auth: ResolvedProviderAuth }
    | { error: string }
  >;
};

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

function resolveInferenceModel(config: KaijiBotConfig): string {
  return (
    config.cognitive?.insight?.inferenceModel
    ?? config.cognitive?.persona?.extractionModel
    ?? "zai/glm-5-turbo"
  );
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseSearchStrategyResponse(raw: string): InferenceResult {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "")
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { ok: false, error: `Invalid JSON in inference response: ${cleaned.slice(0, 120)}` };
  }

  if (
    typeof parsed.inferredInterest !== "string"
    || typeof parsed.searchQuery !== "string"
    || typeof parsed.bridgeReasoning !== "string"
    || !Array.isArray(parsed.avoidTopics)
    || typeof parsed.estimatedSurprise !== "number"
  ) {
    return { ok: false, error: "Missing required fields in inference response" };
  }

  const estimatedSurprise = clamp01(parsed.estimatedSurprise);

  const strategy: SearchStrategy = {
    inferredInterest: parsed.inferredInterest,
    searchQuery: parsed.searchQuery,
    bridgeReasoning: parsed.bridgeReasoning,
    avoidTopics: parsed.avoidTopics.map(String),
    estimatedSurprise,
  };

  return { ok: true, strategy };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

export function buildInterestInferencePrompt(
  persona: PersonaTree,
  input: InsightEngineInput,
  mode: "surprise" | "extend" = "surprise",
): string {
  // Section 1: Known knowledge
  const domainEntries = Object.entries(persona.domains)
    .sort(([, a], [, b]) => b.depth - a.depth);

  const knownKnowledge = domainEntries.length > 0
    ? domainEntries
        .slice(0, 20)
        .map(([name, d]) => {
          const insights = d.keyInsights.slice(0, 3).join("; ");
          return `- ${name} (depth: ${d.depth})${insights ? ` — ${insights}` : ""}`;
        })
        .join("\n")
    : "(no domains established yet)";

  // Section 2: Explicit interests
  const expertDomains = persona.identity.expertDomains ?? [];
  const interestDomains = persona.identity.interestDomains ?? [];
  const curiosityDomains = persona.identity.curiosityDomains ?? [];
  const explicitInterests = [
    ...expertDomains.map((d) => `[expert] ${d}`),
    ...interestDomains.map((d) => `[interest] ${d}`),
    ...curiosityDomains.map((d) => `[curiosity] ${d}`),
  ];
  const explicitBlock = explicitInterests.length > 0
    ? explicitInterests.join("\n")
    : "(not yet established)";

  // Section 3: Knowledge gaps — curiosity domains without depth
  const curiositySet = new Set(curiosityDomains);
  const knownDomainSet = new Set(Object.keys(persona.domains));
  const gaps = [...curiositySet].filter((d) => !knownDomainSet.has(d) || (persona.domains[d]?.depth ?? 0) < 2);
  const gapsBlock = gaps.length > 0
    ? gaps.map((d) => `- ${d}`).join("\n")
    : "(no clear gaps identified)";

  // Section 4: Domain connections
  const edges = persona.domainGraph?.edges ?? [];
  const topEdges = [...edges]
    .sort((a, b) => b.observations - a.observations)
    .slice(0, 5);
  const connectionsBlock = topEdges.length > 0
    ? topEdges.map((e) => `- ${e.source} ↔ ${e.target} (${e.observations} co-occurrences)`).join("\n")
    : "(no domain connections yet)";

  // Section 5: Recent focus
  const recentFocus = persona.recentFocus.slice(0, 5);
  const recentFocusBlock = recentFocus.length > 0
    ? recentFocus.map((f) => `- ${f}`).join("\n")
    : "(none)";

  // Top discussed domains for avoidTopics
  const topDiscussed = domainEntries
    .sort(([, a], [, b]) => b.recurrence - a.recurrence)
    .slice(0, 3)
    .map(([name]) => name);

  const isExtend = mode === "extend";

  const hasTargetDomains = input.targetDomains.length > 0;
  const targetDomainsBlock = hasTargetDomains
    ? `\n## TARGET DOMAIN FOR THIS INSIGHT\nThe insight pipeline has selected the following domain(s) as the focus area for this insight:\n${input.targetDomains.map((d) => `- ${d}`).join("\n")}\n\nThe searchQuery MUST be specifically about or related to these target domain(s).\n`
    : "";

  const taskInstruction = isExtend
    ? hasTargetDomains
      ? `Generate a focused search query to deepen understanding of "${input.targetDomains[0]}". Find a surprising angle, recent development, or lesser-known aspect within this specific domain.`
      : `Analyze this user's knowledge structure. Identify their MOST ACTIVE domain and generate a focused search query to deepen understanding of it. The query should target practical applications or recent developments in that domain.`
    : hasTargetDomains
      ? `The pipeline has selected "${input.targetDomains.join('" or "')}" as the focus area. Find a SURPRISINGLY ADJACENT angle — the searchQuery MUST include at least one recognizable keyword from "${input.targetDomains.join('" or "')}" to stay grounded in the user's knowledge. The surprise should come from the ANGLE, not from drifting to an unrelated topic. Something the user would find surprising and valuable, but hasn't explicitly explored.`
      : `Analyze this user's knowledge structure. Identify a LATENT interest — something they would find surprising and valuable, but that they haven't explicitly explored. The latent interest should bridge from what they know to something adjacent but unexpected.`;

  const modeConstraints = isExtend
    ? `- The searchQuery must be 2-6 English keywords targeting practical applications or recent developments in the user's most active domain
- The estimatedSurprise should be moderate (0.3–0.6) since this is for extending known domains
- Prefer queries that surface actionable content: tools, case studies, benchmarks, or how-to guides
- Include the current year in the searchQuery to prioritize recent content`
    : `- The searchQuery must be 2-6 English keywords suitable for a web search API
- The estimatedSurprise must be between 0.6 and 1.0 (this is for surprise-mode insights only)
- The searchQuery MUST contain at least one keyword from the target domains to prevent drift
- Do NOT suggest topics the user is already an expert in
- Prefer cross-domain bridges that connect two areas the user knows about in an unexpected way
- Include the current year in the searchQuery to surface cutting-edge developments`;

  return `You are an expert at identifying latent interests and knowledge gaps from a user's knowledge profile.

## USER'S KNOWN KNOWLEDGE
${knownKnowledge}

## EXPLICIT INTERESTS
${explicitBlock}

## KNOWLEDGE GAPS
${gapsBlock}

## DOMAIN CONNECTIONS
${connectionsBlock}

## RECENT FOCUS
${recentFocusBlock}
${targetDomainsBlock}
## TASK
${taskInstruction}

Constraints:
${modeConstraints}
- avoidTopics should contain the user's most-discussed domains to avoid re-treading: ${topDiscussed.join(", ")}
- Prefer topics with recent developments (2024-2026). The searchQuery should target current trends, new tools, recent research, or emerging techniques — not general knowledge or introductory content.

Respond with ONLY a JSON object (no markdown, no code fences):
{
  "inferredInterest": "A concise description of the latent interest",
  "searchQuery": "2-6 English keywords for web search",
  "bridgeReasoning": "Why this connects to the user's latent interests and what they already know",
  "avoidTopics": ["domain1", "domain2", "domain3"],
  "estimatedSurprise": 0.8
}`;
}

// ---------------------------------------------------------------------------
// Main inference function
// ---------------------------------------------------------------------------

export async function inferSearchStrategy(
  persona: PersonaTree,
  input: InsightEngineInput,
  config: KaijiBotConfig,
  deps: InterestInferenceDeps,
  mode: "surprise" | "extend" = "surprise",
): Promise<InferenceResult> {
  const modelRef = resolveInferenceModel(config);

  try {
    const prepared = await deps.prepareModel(config, modelRef);
    if ("error" in prepared) {
      log.warn("model preparation failed", { error: prepared.error });
      return { ok: false, error: `Model preparation failed: ${prepared.error}` };
    }

    const prompt = buildInterestInferencePrompt(persona, input, mode);
    const messages: Array<{ role: "user"; content: string; timestamp: number }> = [
      { role: "user", content: prompt, timestamp: Date.now() },
    ];

    const result = await deps.complete(
      prepared.model,
      { messages },
      {
        apiKey: prepared.auth.apiKey,
        maxTokens: 2000,
        temperature: 0.9,
        signal: AbortSignal.timeout(30_000),
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
      log.warn("LLM returned empty inference response");
      return { ok: false, error: "LLM returned empty response" };
    }

    const parsed = parseSearchStrategyResponse(text);
    if (parsed.ok) {
      log.info("inferred search strategy", {
        inferredInterest: parsed.strategy.inferredInterest,
        searchQuery: parsed.strategy.searchQuery,
        estimatedSurprise: parsed.strategy.estimatedSurprise,
      });
    } else {
      log.warn("failed to parse inference response", { error: parsed.error, raw: text.slice(0, 200) });
    }
    return parsed;
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    log.warn(`interest inference ${isTimeout ? "timed out" : "failed"}`, { error: String(err) });
    return { ok: false, error: `Interest inference failed: ${String(err)}` };
  }
}
