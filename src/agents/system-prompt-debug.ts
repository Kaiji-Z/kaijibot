import type { ContextLayer } from "./system-prompt-debug-types.js";

/**
 * Per-section token/char breakdown of an assembled system prompt.
 *
 * Used by the KAIJIBOT_DEBUG_CONTEXT=1 escape hatch to expose which sections
 * are eating the context budget. Pure diagnostic — does not influence the
 * generated prompt.
 */
export interface SectionBreakdown {
  /** Heading text without the leading `## `. `(preamble)` for content before the first heading. */
  name: string;
  /** Which context layer this section belongs to (L1 hardcoded / L2 user / L3 dynamic). */
  layer: ContextLayer | "unknown";
  /** Character count of the section body (heading + body lines). */
  chars: number;
  /** Approximate token count (CJK × 1.5 + ASCII × 0.25). */
  approxTokens: number;
  /** Line index (0-based) where the heading appears. */
  startLine: number;
}

/**
 * Map known section names to their context layer.
 * Sections not in this map are classified as "unknown" (rare — usually a new
 * heading was added without updating this map; should be updated).
 *
 * The mapping is intentionally explicit so a missing entry is loud rather
 * than silently bucketed.
 */
const SECTION_LAYER_MAP: Record<string, ContextLayer> = {
  // L1 — hardcoded in system-prompt.ts
  Capabilities: "L1",
  Tooling: "L1",
  "Tool Call Style": "L1",
  "Execution Bias": "L1",
  Safety: "L1",
  "KaijiBot CLI Quick Reference": "L1",
  "Skills (mandatory)": "L1",
  "Available Skills": "L1", // subsection emitted by skillsPrompt inside Skills block
  "KaijiBot Self-Update": "L1",
  "Model Aliases": "L1",
  Workspace: "L1",
  Sandbox: "L1",
  Documentation: "L1",
  "Authorized Senders": "L1",
  "Current Date & Time": "L1",
  "Workspace Files (injected)": "L1",
  "Reply Tags": "L1",
  Messaging: "L1",
  "Voice (TTS)": "L1",
  Reactions: "L1",
  "Reasoning Format": "L1",
  "Silent Replies": "L1",
  Heartbeats: "L1",
  Runtime: "L1",
  "Context Layer Priority": "L1",

  // L2 — user-authored workspace files
  "Project Context": "L2",
  "Dynamic Project Context": "L2",

  // L3 — auto-extracted cognitive state (delivered via extraSystemPrompt)
  // extraSystemPrompt wrapper headers (the contents below have their own ##)
  "Group Chat Context": "L3",
  "Subagent Context": "L3",
  // Actual L3 sections (injected by context-writer / inbound-meta / etc.)
  "Inbound Context (trusted metadata)": "L3",
  "Lark CLI Profile": "L3",
  "Soul Preset Selection": "L3",
  "User Cognitive Profile": "L3",
  "Interaction Guidance": "L3",
  "Skill Evolution": "L3",
  "Known Corrections": "L3",
  "Current Mode: Task Execution": "L3",
  "Current Mode: Thinking Partner": "L3",
  "Current Mode: Hybrid": "L3",
  "Current Mode: Proactive": "L3",
};

const WORKSPACE_FILE_PATTERN = /\.(md|markdown|txt)$/i;

function resolveSectionLayer(name: string): ContextLayer | "unknown" {
  const explicit = SECTION_LAYER_MAP[name];
  if (explicit) {
    return explicit;
  }
  if (WORKSPACE_FILE_PATTERN.test(name)) {
    return "L2";
  }
  return "unknown";
}

/**
 * Estimate token count for a string.
 *
 * Heuristic tuned for typical KaijiBot content (mixed Chinese + English + JSON):
 * - CJK ideographs and fullwidth forms: ~1.5 tokens each
 * - Other ASCII characters: ~0.25 tokens each (4 chars ≈ 1 token)
 *
 * Not a substitute for the real provider tokenizer — used only for relative
 * budget comparisons in the debug breakdown.
 */
export function approxTokensForText(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // CJK Unified Ideographs + Extension A + CJK Compatibility + Fullwidth Forms
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk * 1.5 + other * 0.25);
}

/**
 * Split an assembled system prompt into per-section breakdowns by `^## ` headings.
 *
 * Behavior:
 * - Content before the first `## ` heading is bucketed as `(preamble)`.
 * - Each `## ` heading starts a new section; the section runs until the next
 *   `## ` heading or end of string.
 * - `### ` and deeper headings do NOT start new sections — they stay in the
 *   current `## ` section.
 *
 * This matches KaijiBot's structure where every top-level section uses `##`
 * (see src/agents/system-prompt.ts and src/cognitive/context-writer.ts).
 */
export function analyzeSystemPromptSections(systemPrompt: string): SectionBreakdown[] {
  const sections: SectionBreakdown[] = [];
  const lines = systemPrompt.split("\n");
  let currentName = "(preamble)";
  let currentStart = 0;
  let currentBuffer: string[] = [];

  const flush = (endLineExclusive: number) => {
    if (currentBuffer.length === 0) {
      return;
    }
    const text = currentBuffer.join("\n");
    const cleanName = currentName.replace(/^##\s*/, "").trim();
    const layer = resolveSectionLayer(cleanName);
    sections.push({
      name: cleanName,
      layer,
      chars: text.length,
      approxTokens: approxTokensForText(text),
      startLine: currentStart,
    });
    currentBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Match only top-level `## ` headings (not `### `).
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      flush(i);
      currentName = match[1] ?? "(unknown)";
      currentStart = i;
    }
    currentBuffer.push(line);
  }
  flush(lines.length);

  return sections;
}

/**
 * Aggregated breakdown summary by layer.
 */
export interface LayerSummary {
  layer: ContextLayer | "unknown";
  sections: number;
  chars: number;
  approxTokens: number;
}

export function summarizeByLayer(sections: SectionBreakdown[]): LayerSummary[] {
  const map = new Map<ContextLayer | "unknown", LayerSummary>();
  for (const section of sections) {
    let entry = map.get(section.layer);
    if (!entry) {
      entry = {
        layer: section.layer,
        sections: 0,
        chars: 0,
        approxTokens: 0,
      };
      map.set(section.layer, entry);
    }
    entry.sections++;
    entry.chars += section.chars;
    entry.approxTokens += section.approxTokens;
  }
  return [...map.values()].sort((a, b) => {
    // Stable order: L1 < L2 < L3 < unknown
    const order = (l: ContextLayer | "unknown"): number =>
      l === "L1" ? 0 : l === "L2" ? 1 : l === "L3" ? 2 : 3;
    return order(a.layer) - order(b.layer);
  });
}

/**
 * Emit a human-readable breakdown of the assembled system prompt to stderr.
 *
 * Format:
 * ```
 * === KAIJIBOT CONTEXT BREAKDOWN ===
 * Total: ~N tokens (M chars)
 * By layer: L1=… L2=… L3=… unknown=…
 * --- per-section ---
 * [L1] Identity: 60 chars / ~15 tokens
 * [L1] Safety: 520 chars / ~130 tokens
 * ...
 * === END BREAKDOWN ===
 * ```
 *
 * Activated only when `KAIJIBOT_DEBUG_CONTEXT=1`. No-op otherwise (the caller
 * is responsible for gating).
 */
export function emitContextDebugBreakdown(systemPrompt: string): void {
  const sections = analyzeSystemPromptSections(systemPrompt);
  const layerSummaries = summarizeByLayer(sections);
  const totalTokens = sections.reduce((sum, s) => sum + s.approxTokens, 0);
  const totalChars = sections.reduce((sum, s) => sum + s.chars, 0);

  const lines: string[] = [];
  lines.push("=== KAIJIBOT CONTEXT BREAKDOWN ===");
  lines.push(
    `Total: ~${totalTokens} tokens (${totalChars} chars) across ${sections.length} sections`,
  );
  const layerLine = layerSummaries.map((l) => `${l.layer}=${l.approxTokens}`).join(" ");
  lines.push(`By layer: ${layerLine}`);
  lines.push("--- per-section ---");
  for (const s of sections) {
    lines.push(
      `[${s.layer}] ${s.name}: ${s.chars} chars / ~${s.approxTokens} tokens (line ${s.startLine})`,
    );
  }
  lines.push("=== END BREAKDOWN ===");

  process.stderr.write(lines.join("\n") + "\n");
}
