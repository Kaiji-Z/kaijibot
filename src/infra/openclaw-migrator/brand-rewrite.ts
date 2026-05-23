import fs from "node:fs/promises";
import { resolveWorkspaceTemplateDir } from "../../agents/workspace-templates.js";

// ─── Shared Constants ────────────────────────────────────────────────────────

/** Regex matching brand references that need rewriting. */
export const BRAND_REFERENCES = /\b(openclaw|OpenClaw|clawdbot|ClawdBot|moltbot|MoltBot)\b/g;

/** Banner prepended to skill files that had brand references rewritten. */
export const MIGRATION_BANNER = "<!-- Migrated from OpenClaw. Review for brand references. -->\n";

/** Brand home-dir prefixes that should be rewritten to ~/.kaijibot/ */
export const BRAND_HOME_PREFIXES = ["~/.openclaw/", "~/.clawdbot/", "~/.moltbot/"];

// ─── Brand Replacement Map ───────────────────────────────────────────────────

interface BrandReplacement {
  pattern: RegExp;
  replacement: string;
}

const BRAND_REPLACEMENTS: BrandReplacement[] = [
  { pattern: /\bOpenClaw\b/g, replacement: "KaijiBot" },
  { pattern: /\bopenclaw\b/g, replacement: "kaijibot" },
  { pattern: /\bClawdBot\b/g, replacement: "KaijiBot" },
  { pattern: /\bclawdbot\b/g, replacement: "kaijibot" },
  { pattern: /\bMoltBot\b/g, replacement: "KaijiBot" },
  { pattern: /\bmoltbot\b/g, replacement: "kaijibot" },
  { pattern: /~\/\.openclaw\//g, replacement: "~/.kaijibot/" },
  { pattern: /~\/\.clawdbot\//g, replacement: "~/.kaijibot/" },
  { pattern: /~\/\.moltbot\//g, replacement: "~/.kaijibot/" },
  { pattern: /avatars\/openclaw\.png/g, replacement: "avatars/kaijibot.png" },
  { pattern: /\bopenclaw\.png\b/g, replacement: "kaijibot.png" },
];

// ─── Types ───────────────────────────────────────────────────────────────────

export type RewriteMode = "section" | "full";

export interface StructuralRewriteRule {
  filename: string;
  mode: RewriteMode;
  templateName: string;
  knownSections?: string[];
}

export interface RewriteResult {
  content: string;
  warnings: string[];
  wasRewritten: boolean;
}

// ─── Structural Rewrite Registry ─────────────────────────────────────────────

const AGENTS_KNOWN_SECTIONS = [
  "Session Startup",
  "Memory",
  "Workspace Files",
  "Cognitive System",
  "Feishu Platform",
  "Proactive Work",
  "Heartbeat vs Cron",
  "When to Reach Out",
  "When to Stay Quiet",
  "Safe to Do Without Asking",
  "Red Lines",
  "Group Chats",
];

export const STRUCTURAL_REWRITE_REGISTRY = new Map<string, StructuralRewriteRule>([
  [
    "AGENTS.md",
    {
      filename: "AGENTS.md",
      mode: "section",
      templateName: "AGENTS.md",
      knownSections: AGENTS_KNOWN_SECTIONS,
    },
  ],
  ["TOOLS.md", { filename: "TOOLS.md", mode: "full", templateName: "TOOLS.md" }],
  ["BOOTSTRAP.md", { filename: "BOOTSTRAP.md", mode: "full", templateName: "BOOTSTRAP.md" }],
]);

// ─── Pure Functions ──────────────────────────────────────────────────────────

/** Apply all brand name replacement map entries to content. Pure, no I/O. */
export function rewriteBrandReferences(content: string): string {
  let result = content;
  for (const { pattern, replacement } of BRAND_REPLACEMENTS) {
    result = result.replaceAll(pattern, replacement);
  }
  return result;
}

/** Strip YAML front matter (between --- delimiters) from template content. */
export function stripFrontMatter(content: string): string {
  if (!content.startsWith("---")) {
    return content;
  }
  const end = content.indexOf("---", 3);
  if (end === -1) {
    return content;
  }
  // Skip the closing --- and any trailing newlines after it
  const after = content.slice(end + 3);
  return after.startsWith("\n") ? after.slice(1) : after;
}

// ─── Section Parsing ─────────────────────────────────────────────────────────

interface MarkdownSection {
  header: string;
  level: number;
  content: string;
}

/**
 * Parse markdown into preamble (before first header) and sections by H2/H3.
 * Exported for reuse by migrate-workspace.ts.
 */
export function extractSectionsByHeaders(content: string): {
  preamble: string;
  sections: MarkdownSection[];
} {
  const lines = content.split("\n");
  const preambleLines: string[] = [];
  const sections: MarkdownSection[] = [];
  let currentSection: MarkdownSection | null = null;
  let capturingLines: string[] = [];

  const HEADER_RE = /^(#{1,6})\s+(.+)$/;

  function flushCurrent(): void {
    if (currentSection !== null) {
      currentSection.content = capturingLines.join("\n").trim();
      sections.push(currentSection);
    }
  }

  for (const line of lines) {
    const match = line.match(HEADER_RE);
    if (match) {
      const level = match[1]!.length;
      const header = match[2]!.trim();
      if (level <= 2) {
        flushCurrent();
        currentSection = { header, level, content: "" };
        capturingLines = [line];
      } else if (currentSection !== null) {
        capturingLines.push(line);
      } else {
        preambleLines.push(line);
      }
    } else if (currentSection !== null) {
      capturingLines.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  flushCurrent();

  return { preamble: preambleLines.join("\n").trimEnd(), sections };
}

/**
 * Extract specific sections by header names (backward-compatible with migrate-workspace.ts usage).
 */
export function extractSectionsByHeaderNames(content: string, headers: string[]): string {
  const { sections } = extractSectionsByHeaders(content);
  const headerSet = new Set(headers);
  const result: string[] = [];

  for (const section of sections) {
    if (headerSet.has(section.header)) {
      result.push(section.content);
    }
  }

  return result.join("\n\n").trim();
}

/**
 * Extract all H1-H6 header titles from content.
 */
export function extractMarkdownHeaders(content: string): string[] {
  const headers: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headers.push(match[2]!.trim());
    }
  }
  return headers;
}

// ─── Template Loading ────────────────────────────────────────────────────────

/** Load a KaijiBot template file, stripping YAML front matter. */
export async function loadKaijiBotTemplate(templateName: string): Promise<string> {
  const templateDir = await resolveWorkspaceTemplateDir();
  const filePath = `${templateDir}/${templateName}`;
  const raw = await fs.readFile(filePath, "utf-8");
  return stripFrontMatter(raw);
}

// ─── Structural Rewriting ────────────────────────────────────────────────────

/** Rewrite a structural file (AGENTS.md, TOOLS.md, BOOTSTRAP.md) using KaijiBot templates. */
export async function rewriteStructuralFile(
  filename: string,
  srcContent: string,
  _options: { dryRun: boolean },
): Promise<RewriteResult> {
  const rule = STRUCTURAL_REWRITE_REGISTRY.get(filename);
  if (!rule) {
    return { content: srcContent, warnings: [], wasRewritten: false };
  }

  const warnings: string[] = [];

  if (rule.mode === "full") {
    const template = await loadKaijiBotTemplate(rule.templateName);
    if (srcContent !== template) {
      warnings.push(
        `${filename}: Replaced with KaijiBot template. User customizations may have been lost.`,
      );
    }
    return { content: template, warnings, wasRewritten: true };
  }

  // Section mode (AGENTS.md)
  const knownSet = new Set(rule.knownSections ?? []);
  const srcParsed = extractSectionsByHeaders(srcContent);
  const templateParsed = extractSectionsByHeaders(await loadKaijiBotTemplate(rule.templateName));

  // Build lookup from template sections by header name
  const templateByHeader = new Map<string, MarkdownSection>();
  for (const section of templateParsed.sections) {
    templateByHeader.set(section.header, section);
  }

  const mergedSections: string[] = [];

  for (const section of srcParsed.sections) {
    if (knownSet.has(section.header) && templateByHeader.has(section.header)) {
      mergedSections.push(templateByHeader.get(section.header)!.content);
    } else {
      mergedSections.push(rewriteBrandReferences(section.content));
    }
  }

  const preamble = rewriteBrandReferences(srcParsed.preamble);
  const parts: string[] = [];
  if (preamble) {
    parts.push(preamble);
  }
  if (mergedSections.length > 0) {
    parts.push(mergedSections.join("\n\n"));
  }

  return { content: parts.join("\n\n"), warnings, wasRewritten: true };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

/** Top-level dispatcher: routes file rewriting by filename and extension. */
export async function rewriteWorkspaceFile(
  filename: string,
  srcContent: string,
  options: { dryRun: boolean },
): Promise<RewriteResult> {
  // Non-.md files: passthrough
  if (!filename.endsWith(".md")) {
    return { content: srcContent, warnings: [], wasRewritten: false };
  }

  // MEMORY.md: brand swap only
  if (filename === "MEMORY.md" || filename === "memory.md") {
    const rewritten = rewriteBrandReferences(srcContent);
    return {
      content: rewritten,
      warnings: [],
      wasRewritten: rewritten !== srcContent,
    };
  }

  // Structural files (AGENTS.md, TOOLS.md, BOOTSTRAP.md)
  if (STRUCTURAL_REWRITE_REGISTRY.has(filename)) {
    return rewriteStructuralFile(filename, srcContent, options);
  }

  // All other .md files: brand swap only
  const rewritten = rewriteBrandReferences(srcContent);
  return {
    content: rewritten,
    warnings: [],
    wasRewritten: rewritten !== srcContent,
  };
}
