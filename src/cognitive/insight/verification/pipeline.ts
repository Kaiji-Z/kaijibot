import { complete, type Api, type Model } from "@mariozechner/pi-ai";
import type { ResolvedProviderAuth } from "../../../agents/model-auth.js";
import { prepareSimpleCompletionModel } from "../../../agents/simple-completion-runtime.js";
import type { KaijiBotConfig } from "../../../config/config.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import type { VerificationResult } from "../types.js";

const log = createSubsystemLogger("cognitive/verification");

export type VerificationDeps = {
  complete: typeof complete;
  prepareModel: (
    cfg: KaijiBotConfig,
    modelRef?: string,
  ) => Promise<
    | { model: Model<Api>; auth: ResolvedProviderAuth }
    | { error: string }
  >;
};

export function createDefaultVerificationDeps(): VerificationDeps {
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

function buildVerificationPrompt(
  content: string,
  sources: Array<{ url: string; title: string; snippet?: string }>,
): string {
  const sourceText =
    sources.length > 0
      ? sources
          .map(
            (s, i) =>
              `${i + 1}. [${s.title}](${s.url})${s.snippet ? `: ${s.snippet.slice(0, 200)}` : ""}`,
          )
          .join("\n")
      : "No sources available.";

  return `Verify whether this insight is consistent with the provided sources.

INSIGHT:
${content}

SOURCES:
${sourceText}

Evaluate:
1. Are the factual claims in the insight supported by the sources?
2. Are there any claims that contradict the sources or go beyond what they say?
3. Is the overall message consistent with the source material?

Respond in EXACTLY this format:
VERDICT: consistent | partially_consistent | inconsistent
CONFIDENCE: 0.0 to 1.0
NOTES: one sentence explaining your verdict`;
}

function fallbackVerification(
  sources: Array<{ credibility: number }>,
): VerificationResult {
  const credibleCount = sources.filter((s) => s.credibility >= 0.3).length;
  if (credibleCount >= 2) {
    return {
      status: "verified",
      sources: [],
      confidence: 0.5,
      notes: "Fallback: source count check",
    };
  }
  if (credibleCount >= 1) {
    return {
      status: "partial",
      sources: [],
      confidence: 0.3,
      notes: "Fallback: single source",
    };
  }
  return {
    status: "unverified",
    sources: [],
    confidence: 0,
    notes: "Fallback: no credible sources",
  };
}

export async function verifyInsightLLM(
  content: string,
  sources: Array<{
    url: string;
    title: string;
    snippet?: string;
    credibility: number;
  }>,
  config: KaijiBotConfig,
  deps: VerificationDeps,
): Promise<VerificationResult> {
  if (sources.length === 0) {
    return {
      status: "unverified",
      sources: [],
      confidence: 0,
      notes: "No sources provided",
    };
  }

  try {
    const modelRef = config.cognitive?.persona?.extractionModel;
    const prepared = await deps.prepareModel(config, modelRef);
    if ("error" in prepared) {
      log.warn("verification model preparation failed", {
        error: prepared.error,
      });
      return fallbackVerification(sources);
    }

    const prompt = buildVerificationPrompt(content, sources);
    const messages: Array<{
      role: "user";
      content: string;
      timestamp: number;
    }> = [{ role: "user", content: prompt, timestamp: Date.now() }];

    const result = await deps.complete(
      prepared.model,
      { messages },
      {
        apiKey: prepared.auth.apiKey,
        maxTokens: 200,
        temperature: 0.3,
        signal: AbortSignal.timeout(8_000),
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

    const verdictMatch = text.match(
      /VERDICT:\s*(consistent|partially_consistent|inconsistent)/i,
    );
    const confidenceMatch = text.match(/CONFIDENCE:\s*([\d.]+)/);
    const notesMatch = text.match(/NOTES:\s*(.+)/);

    const verdict =
      verdictMatch?.[1]?.toLowerCase() ?? "partially_consistent";
    const rawConfidence = confidenceMatch?.[1]
      ? parseFloat(confidenceMatch[1])
      : 0.5;
    const confidence = Math.max(0, Math.min(rawConfidence, 1));
    const notes = notesMatch?.[1]?.trim() ?? "LLM verification completed";

    const credibleSources = sources.filter((s) => s.credibility >= 0.3);

    if (verdict === "consistent") {
      return {
        status: "verified",
        sources: credibleSources,
        confidence,
        notes,
      };
    }
    if (verdict === "inconsistent") {
      return {
        status: "unverified",
        sources: credibleSources,
        confidence: Math.min(confidence, 0.3),
        notes,
      };
    }
    return {
      status: "partial",
      sources: credibleSources,
      confidence,
      notes,
    };
  } catch (err) {
    const isTimeout =
      err instanceof DOMException && err.name === "TimeoutError";
    log.warn(`verification ${isTimeout ? "timed out" : "failed"}: ${String(err)}`);
    return fallbackVerification(sources);
  }
}

/**
 * Verify an insight candidate.
 * Structural verification based on source count and credibility thresholds.
 */
export function verifyInsight(params: {
  content: string;
  sources: Array<{ url: string; title: string; credibility: number }>;
  verificationLevel: "basic" | "strict" | "paranoid";
}): VerificationResult {
  const { sources, verificationLevel } = params;

  if (sources.length === 0) {
    return {
      status: "unverified",
      sources: [],
      confidence: 0,
      notes: "No sources provided — cannot verify",
    };
  }

  const credibleSources = sources.filter((s) => s.credibility >= 0.3);
  if (credibleSources.length === 0) {
    return {
      status: "unverified",
      sources,
      confidence: 0.1,
      notes: "All sources have low credibility",
    };
  }

  if (verificationLevel === "basic") {
    return {
      status: credibleSources.length >= 1 ? "partial" : "unverified",
      sources: credibleSources,
      confidence: credibleSources[0].credibility,
      notes:
        credibleSources.length >= 2
          ? "Multiple sources agree"
          : "Single source",
    };
  }

  if (verificationLevel === "strict") {
    if (credibleSources.length >= 2) {
      return {
        status: "verified",
        sources: credibleSources,
        confidence: Math.min(
          1,
          credibleSources.reduce((sum, s) => sum + s.credibility, 0) /
            credibleSources.length,
        ),
        notes: `${credibleSources.length} credible sources`,
      };
    }
    return {
      status: "partial",
      sources: credibleSources,
      confidence: credibleSources[0].credibility * 0.5,
      notes: "Need 2+ sources for verification",
    };
  }

  const highCredSources = sources.filter((s) => s.credibility >= 0.5);
  if (highCredSources.length >= 3) {
    return {
      status: "verified",
      sources: highCredSources,
      confidence: Math.min(
        1,
        highCredSources.reduce((sum, s) => sum + s.credibility, 0) /
          highCredSources.length,
      ),
      notes: `${highCredSources.length} high-credibility sources`,
    };
  }

  return {
    status: "partial",
    sources: highCredSources.length > 0 ? highCredSources : credibleSources,
    confidence: 0.3,
    notes: "Need 3+ high-credibility sources for paranoid verification",
  };
}
