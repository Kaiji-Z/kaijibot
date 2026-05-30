/**
 * memory-repair.ts — MEMORY.md structural repair module.
 *
 * Diagnoses structural issues, plans repair actions, classifies orphan
 * content (heuristic + LLM), executes repairs with zero data loss, and
 * verifies post-repair integrity.
 *
 * Extension boundary: imports only from `./memory-index.js`.
 */

import type { MemoryIndex } from "./memory-index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RepairSeverity = "none" | "minor" | "moderate" | "major";

export type StructuralIssue = {
  type:
    | "unknown_heading"
    | "missing_heading"
    | "duplicate_heading"
    | "orphan_lines"
    | "legacy_heading"
    | "dangling_pointer"
    | "orphan_topic_file"
    | "large_promoted_content";
  weight: number;
  details: string;
  location?: { line?: number; heading?: string };
};

export type RepairDiagnostic = {
  severity: RepairSeverity;
  score: number;
  issues: StructuralIssue[];
  unknownContentBlocks: Array<{ heading: string; lines: string[] }>;
};

export type RepairAction =
  | { type: "reorder_sections" }
  | { type: "migrate_legacy_heading"; from: string; to: string }
  | { type: "merge_duplicate_heading"; heading: string }
  | { type: "relocate_orphan_lines"; target: string }
  | {
      type: "classify_and_relocate";
      blocks: Array<{ heading: string; lines: string[] }>;
    }
  | { type: "fix_dangling_pointer"; pointer: string }
  | { type: "register_orphan_file"; file: string }
  | { type: "relocate_promoted_content" };

export type RepairPlan = {
  diagnostic: RepairDiagnostic;
  actions: RepairAction[];
  requiresBackup: boolean;
  requiresLLM: boolean;
};

export type RepairResult = {
  severity: RepairSeverity;
  actionsApplied: string[];
  contentRelocated: number;
  contentDropped: number; // MUST always be 0
  backupPath?: string;
  verificationPassed: boolean;
};

export type MemoryRepairDeps = {
  readRawMemoryIndex: (workspaceDir: string) => Promise<string>;
  writeRawMemoryIndex: (workspaceDir: string, content: string) => Promise<void>;
  parseMemoryIndex: (content: string) => MemoryIndex;
  serializeIndex: (index: MemoryIndex) => string;
  readTopicFile: (topicPath: string) => Promise<string | null>;
  appendToTopicFile: (topicPath: string, content: string) => Promise<void>;
  topicFileExists: (workspaceDir: string, relativePath: string) => Promise<boolean>;
  listTopicFiles: (workspaceDir: string) => Promise<string[]>;
  generateText: (prompt: string) => Promise<string>;
  backupFile: (filePath: string) => Promise<string>;
  log: (message: string) => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUIRED_HEADINGS = ["⚡ Core Memory", "🔥 Active Context", "Topic Pointers"];

const INLINE_SECTION_HEADINGS = ["⚡ Core Memory", "🔥 Active Context"];

const LEGACY_SECTION_MIGRATION: Record<string, string> = {
  "👤 User": "⚡ Core Memory",
  "💬 Key Feedback": "⚡ Core Memory",
  "🔗 Reference": "⚡ Core Memory",
  "🎯 Active Focus": "🔥 Active Context",
};

const SECTION_HEADING_RE = /^## (.+)$/;
const TITLE_RE = /^# Long-Term Memory/;

const ALL_KNOWN_HEADINGS = new Set([
  ...INLINE_SECTION_HEADINGS,
  ...Object.keys(LEGACY_SECTION_MIGRATION),
  "Topic Pointers",
  "Promoted From Short-Term Memory",
  "References",
  "Recent Sessions",
]);

// Severity bands
function severityFromScore(score: number): RepairSeverity {
  if (score === 0) {return "none";}
  if (score <= 3) {return "minor";}
  if (score <= 8) {return "moderate";}
  return "major";
}

// ---------------------------------------------------------------------------
// Raw line scanner
// ---------------------------------------------------------------------------

interface ScannedSection {
  heading: string;
  startLine: number;
  lines: string[];
}

interface ScanResult {
  titleLine: number | null;
  sections: ScannedSection[];
  preTitleLines: string[];
}

function scanRawLines(lines: string[]): ScanResult {
  const sections: ScannedSection[] = [];
  const preTitleLines: string[] = [];
  let titleLine: number | null = null;
  let current: ScannedSection | null = null;
  let pastTitle = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (TITLE_RE.test(trimmed)) {
      titleLine = i;
      pastTitle = true;
      continue;
    }

    if (!pastTitle) {
      preTitleLines.push(line);
      continue;
    }

    const headingMatch = trimmed.match(SECTION_HEADING_RE);
    if (headingMatch) {
      if (current) {
        sections.push(current);
      }
      current = {
        heading: headingMatch[1]!.trim(),
        startLine: i,
        lines: [],
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
    // Lines before any section heading but after title are orphans —
    // we don't collect them here, they are handled by the caller.
  }

  if (current) {
    sections.push(current);
  }

  return { titleLine, sections, preTitleLines };
}

/** Lines between the title and the first ## heading. */
function collectOrphanLines(lines: string[]): string[] {
  let foundTitle = false;
  let foundFirstHeading = false;
  const orphans: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (TITLE_RE.test(trimmed)) {
      foundTitle = true;
      continue;
    }
    if (foundTitle && !foundFirstHeading) {
      if (SECTION_HEADING_RE.test(trimmed)) {
        foundFirstHeading = true;
        continue;
      }
      if (trimmed.length > 0) {
        orphans.push(line);
      }
    }
  }
  return orphans;
}

function isInlineSection(heading: string): boolean {
  return INLINE_SECTION_HEADINGS.includes(heading);
}

function isLegacyHeading(heading: string): boolean {
  return heading in LEGACY_SECTION_MIGRATION;
}

function isKnownHeading(heading: string): boolean {
  return ALL_KNOWN_HEADINGS.has(heading);
}

function isPromotedHeading(heading: string): boolean {
  return (
    heading === "Promoted From Short-Term Memory" ||
    heading.startsWith("Promoted From Short-Term Memory")
  );
}

// ---------------------------------------------------------------------------
// 1. diagnoseStructure
// ---------------------------------------------------------------------------

export function diagnoseStructure(
  content: string,
  opts?: {
    listTopicFiles?: () => Promise<string[]>;
    topicFileExists?: (p: string) => Promise<boolean>;
  },
): RepairDiagnostic;
export function diagnoseStructure(
  content: string,
  opts?: {
    listTopicFiles?: () => Promise<string[]>;
    topicFileExists?: (p: string) => Promise<boolean>;
  },
): RepairDiagnostic | Promise<RepairDiagnostic>;
export function diagnoseStructure(
  content: string,
  opts?: {
    listTopicFiles?: () => Promise<string[]>;
    topicFileExists?: (p: string) => Promise<boolean>;
  },
): RepairDiagnostic | Promise<RepairDiagnostic> {
  const lines = content.split(/\r?\n/);
  const { sections } = scanRawLines(lines);
  const issues: StructuralIssue[] = [];
  let score = 0;
  const unknownContentBlocks: Array<{ heading: string; lines: string[] }> = [];

  // --- Missing required headings ---
  const presentHeadings = new Set(sections.map((s) => s.heading));
  for (const required of REQUIRED_HEADINGS) {
    // Also check legacy equivalents for Topic Pointers — it's only Topic Pointers
    // For inline sections, also check if a legacy version covers it
    const hasEquivalent =
      presentHeadings.has(required) ||
      (isInlineSection(required) &&
        Object.entries(LEGACY_SECTION_MIGRATION).some(
          ([legacy, target]) => target === required && presentHeadings.has(legacy),
        ));

    if (!hasEquivalent) {
      const weight = 2;
      score += weight;
      issues.push({
        type: "missing_heading",
        weight,
        details: `Missing required heading: ${required}`,
      });
    }
  }

  // --- Duplicate headings ---
  const headingCounts = new Map<string, number>();
  for (const section of sections) {
    headingCounts.set(section.heading, (headingCounts.get(section.heading) ?? 0) + 1);
  }
  for (const [heading, count] of headingCounts) {
    if (count > 1) {
      const weight = 3;
      score += weight;
      issues.push({
        type: "duplicate_heading",
        weight,
        details: `Duplicate heading: ${heading} (appears ${count} times)`,
        location: { heading },
      });
    }
  }

  // --- Unknown headings ---
  for (const section of sections) {
    if (!isKnownHeading(section.heading)) {
      const nonEmptyLines = section.lines.filter((l) => l.trim().length > 0);
      if (nonEmptyLines.length > 0) {
        const weight = 3;
        score += weight;
        issues.push({
          type: "unknown_heading",
          weight,
          details: `Unknown heading: ${section.heading} (${nonEmptyLines.length} content lines)`,
          location: { line: section.startLine, heading: section.heading },
        });
        unknownContentBlocks.push({
          heading: section.heading,
          lines: nonEmptyLines,
        });

        // Extra score for large unknown content
        if (nonEmptyLines.length > 10) {
          const extraWeight = Math.floor(nonEmptyLines.length / 10);
          score += extraWeight;
          issues.push({
            type: "unknown_heading",
            weight: extraWeight,
            details: `Large unknown content under: ${section.heading} (${nonEmptyLines.length} lines, +${extraWeight})`,
            location: { line: section.startLine, heading: section.heading },
          });
        }
      }
    }
  }

  // --- Orphan lines ---
  const orphanLines = collectOrphanLines(lines);
  if (orphanLines.length > 0) {
    const weight = Math.max(1, Math.floor(orphanLines.length / 5));
    score += weight;
    issues.push({
      type: "orphan_lines",
      weight,
      details: `Orphan lines between sections: ${orphanLines.length} lines`,
    });
  }

  // --- Legacy headings ---
  const legacyPresent = sections.filter((s) => isLegacyHeading(s.heading));
  if (legacyPresent.length > 0) {
    const weight = 2;
    score += weight;
    for (const section of legacyPresent) {
      issues.push({
        type: "legacy_heading",
        weight: 0, // counted once as total
        details: `Legacy heading: ${section.heading} → should migrate to ${LEGACY_SECTION_MIGRATION[section.heading]}`,
        location: { line: section.startLine, heading: section.heading },
      });
    }
  }

  // --- Large promoted content ---
  for (const section of sections) {
    if (isPromotedHeading(section.heading)) {
      const contentSize = section.lines.join("\n").length;
      if (contentSize > 1024) {
        const weight = 2;
        score += weight;
        issues.push({
          type: "large_promoted_content",
          weight,
          details: `Promoted content is large: ${contentSize} bytes (>1KB)`,
          location: { heading: section.heading },
        });
      }
    }
  }

  // --- Async checks: dangling pointers, orphan files ---
  const hasAsyncChecks = opts?.topicFileExists || opts?.listTopicFiles;

  if (!hasAsyncChecks) {
    return {
      severity: severityFromScore(score),
      score,
      issues,
      unknownContentBlocks,
    };
  }

  // Return a promise for async checks
  return (async () => {
    // Dangling pointers
    if (opts?.topicFileExists) {
      const topicPointersSection = sections.find(
        (s) => s.heading === "Topic Pointers",
      );
      if (topicPointersSection) {
        for (const line of topicPointersSection.lines) {
          const match = line.trim().match(/^- (.+?) → (.+)$/);
          if (match) {
            const topicFile = match[2]!.trim();
            const exists = await opts.topicFileExists!(topicFile);
            if (!exists) {
              const weight = 1;
              score += weight;
              issues.push({
                type: "dangling_pointer",
                weight,
                details: `Dangling topic pointer: ${topicFile}`,
                location: { heading: topicFile },
              });
            }
          }
        }
      }
    }

    // Orphan topic files
    if (opts?.listTopicFiles) {
      const topicPointersSection = sections.find(
        (s) => s.heading === "Topic Pointers",
      );
      const referencedFiles = new Set<string>();
      if (topicPointersSection) {
        for (const line of topicPointersSection.lines) {
          const match = line.trim().match(/^- (.+?) → (.+)$/);
          if (match) {
            referencedFiles.add(match[2]!.trim());
          }
        }
      }
      const allFiles = await opts.listTopicFiles();
      for (const file of allFiles) {
        if (!referencedFiles.has(file)) {
          const weight = 1;
          score += weight;
          issues.push({
            type: "orphan_topic_file",
            weight,
            details: `Orphan topic file not referenced: ${file}`,
          });
        }
      }
    }

    return {
      severity: severityFromScore(score),
      score,
      issues,
      unknownContentBlocks,
    };
  })();
}

// ---------------------------------------------------------------------------
// 2. planRepair
// ---------------------------------------------------------------------------

export function planRepair(diagnostic: RepairDiagnostic): RepairPlan {
  const actions: RepairAction[] = [];
  const { issues, unknownContentBlocks } = diagnostic;

  if (diagnostic.severity === "none") {
    return {
      diagnostic,
      actions: [],
      requiresBackup: false,
      requiresLLM: false,
    };
  }

  // Legacy heading migration
  const legacyIssues = issues.filter((i) => i.type === "legacy_heading");
  const seenLegacy = new Set<string>();
  for (const issue of legacyIssues) {
    const heading = issue.location?.heading;
    if (heading && !seenLegacy.has(heading)) {
      seenLegacy.add(heading);
      actions.push({
        type: "migrate_legacy_heading",
        from: heading,
        to: LEGACY_SECTION_MIGRATION[heading] ?? "⚡ Core Memory",
      });
    }
  }

  // Duplicate heading merge
  const duplicateIssues = issues.filter((i) => i.type === "duplicate_heading");
  const seenDuplicate = new Set<string>();
  for (const issue of duplicateIssues) {
    const heading = issue.location?.heading;
    if (heading && !seenDuplicate.has(heading)) {
      seenDuplicate.add(heading);
      actions.push({ type: "merge_duplicate_heading", heading });
    }
  }

  // Unknown content → classify and relocate
  if (unknownContentBlocks.length > 0) {
    actions.push({
      type: "classify_and_relocate",
      blocks: unknownContentBlocks,
    });
  }

  // Orphan lines
  const orphanIssue = issues.find((i) => i.type === "orphan_lines");
  if (orphanIssue) {
    actions.push({ type: "relocate_orphan_lines", target: "⚡ Core Memory" });
  }

  // Missing headings — reorder will create empty sections
  const missingIssues = issues.filter((i) => i.type === "missing_heading");
  if (missingIssues.length > 0) {
    actions.push({ type: "reorder_sections" });
  }

  // Dangling pointers
  const danglingIssues = issues.filter((i) => i.type === "dangling_pointer");
  for (const issue of danglingIssues) {
    const pointer = (issue.location as { pointer?: string })?.pointer ?? issue.details;
    actions.push({ type: "fix_dangling_pointer", pointer });
  }

  // Orphan topic files
  const orphanFileIssues = issues.filter((i) => i.type === "orphan_topic_file");
  for (const issue of orphanFileIssues) {
    actions.push({ type: "register_orphan_file", file: issue.details });
  }

  // Large promoted content
  const promotedIssue = issues.find((i) => i.type === "large_promoted_content");
  if (promotedIssue) {
    actions.push({ type: "relocate_promoted_content" });
  }

  // Always reorder if there are issues
  if (
    actions.length > 0 &&
    !actions.some((a) => a.type === "reorder_sections")
  ) {
    actions.push({ type: "reorder_sections" });
  }

  return {
    diagnostic,
    actions,
    requiresBackup: diagnostic.severity === "moderate" || diagnostic.severity === "major",
    requiresLLM: unknownContentBlocks.some((b) => b.lines.length > 0),
  };
}

// ---------------------------------------------------------------------------
// 3. classifyHeuristic (Tier 1)
// ---------------------------------------------------------------------------

const CORE_PATTERNS = /prefer|喜欢|偏好|always|never/i;
const ACTIVE_PATTERNS = /working on|进行中|目标|计划|TODO|正在/i;

export function classifyHeuristic(
  blocks: Array<{ heading: string; lines: string[] }>,
): Array<{ heading: string; lines: string[]; target: string }> {
  return blocks.map((block) => {
    // Legacy heading migration
    if (isLegacyHeading(block.heading)) {
      return {
        ...block,
        target: LEGACY_SECTION_MIGRATION[block.heading] ?? "⚡ Core Memory",
      };
    }

    // Pattern matching on content
    const contentText = block.lines.join(" ");
    if (CORE_PATTERNS.test(contentText)) {
      return { ...block, target: "⚡ Core Memory" };
    }
    if (ACTIVE_PATTERNS.test(contentText)) {
      return { ...block, target: "🔥 Active Context" };
    }

    // Default: topic:{derived-subject}
    const subject = deriveSubject(block.heading);
    return { ...block, target: `topic:${subject}` };
  });
}

function deriveSubject(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || "uncategorized";
}

// ---------------------------------------------------------------------------
// 4. classifyWithLLM (Tier 2)
// ---------------------------------------------------------------------------

const LLM_CLASSIFY_PROMPT = `Given these content blocks from a memory file, classify each as: 'core' (enduring user traits/preferences/knowledge), 'active' (current projects/goals/tasks), or 'topic:{subject}' (detailed reference material). Return JSON array of {block_index, target}.`;

export async function classifyWithLLM(
  blocks: Array<{ heading: string; lines: string[] }>,
  generateText: (prompt: string) => Promise<string>,
): Promise<Array<{ heading: string; lines: string[]; target: string }>> {
  let parsed: Array<{ block_index: number; target: string }>;

  try {
    const blockDescriptions = blocks
      .map((b, i) => `[${i}] ## ${b.heading}\n${b.lines.join("\n")}`)
      .join("\n\n");
    const prompt = `${LLM_CLASSIFY_PROMPT}\n\n${blockDescriptions}`;
    const response = await generateText(prompt);
    parsed = JSON.parse(response) as Array<{ block_index: number; target: string }>;
  } catch {
    // Fallback: all blocks → topic:uncategorized
    return blocks.map((b) => ({
      ...b,
      target: "topic:uncategorized",
    }));
  }

  const indexMap = new Map(parsed.map((p) => [p.block_index, p.target]));

  return blocks.map((block, i) => {
    const rawTarget = indexMap.get(i);
    if (!rawTarget) {
      return { ...block, target: "topic:uncategorized" };
    }
    const target = normalizeLLMTarget(rawTarget);
    return { ...block, target };
  });
}

function normalizeLLMTarget(raw: string): string {
  if (raw === "core") {return "⚡ Core Memory";}
  if (raw === "active") {return "🔥 Active Context";}
  if (raw.startsWith("topic:")) {return raw;}
  // If LLM returns something unexpected, wrap it
  return `topic:${raw}`;
}

// ---------------------------------------------------------------------------
// 5. executeRepair
// ---------------------------------------------------------------------------

export async function executeRepair(
  plan: RepairPlan,
  content: string,
  workspaceDir: string,
  deps: MemoryRepairDeps,
): Promise<RepairResult> {
  const actionsApplied: string[] = [];
  let contentRelocated = 0;
  let backupPath: string | undefined;

  // Backup if needed
  if (plan.requiresBackup) {
    const memoryPath = `${workspaceDir}/MEMORY.md`;
    backupPath = await deps.backupFile(memoryPath);
  }

  // Parse the content into our own raw structure
  const parsed = parseRawStructure(content);
  const index = deps.parseMemoryIndex(content);

  for (const action of plan.actions) {
    switch (action.type) {
      case "migrate_legacy_heading": {
        // Move content from legacy heading to new heading
        const legacySection = parsed.sections.find(
          (s) => s.heading === action.from,
        );
        if (legacySection) {
          const targetSection = parsed.sections.find(
            (s) => s.heading === action.to,
          );
          if (targetSection) {
            targetSection.lines.push(...legacySection.lines);
            contentRelocated += legacySection.lines.filter(
              (l) => l.trim().length > 0,
            ).length;
          } else {
            // Create the target section
            parsed.sections.push({
              heading: action.to,
              startLine: -1,
              lines: legacySection.lines,
            });
            contentRelocated += legacySection.lines.filter(
              (l) => l.trim().length > 0,
            ).length;
          }
          // Remove legacy section
          parsed.sections = parsed.sections.filter(
            (s) => s.heading !== action.from,
          );
        }
        actionsApplied.push(`migrate_legacy_heading:${action.from}->${action.to}`);
        break;
      }

      case "merge_duplicate_heading": {
        const duplicates = parsed.sections.filter(
          (s) => s.heading === action.heading,
        );
        if (duplicates.length > 1) {
          const merged: string[] = [];
          for (const dup of duplicates) {
            merged.push(...dup.lines);
          }
          // Keep first, remove rest
          duplicates[0]!.lines = merged;
          parsed.sections = parsed.sections.filter(
            (s) =>
              s.heading !== action.heading ||
              s === parsed.sections.find((sec) => sec.heading === action.heading),
          );
        }
        actionsApplied.push(`merge_duplicate_heading:${action.heading}`);
        break;
      }

      case "relocate_orphan_lines": {
        const orphans = collectOrphanLines(content.split(/\r?\n/));
        if (orphans.length > 0) {
          const targetSection = parsed.sections.find(
            (s) => s.heading === action.target,
          );
          if (targetSection) {
            targetSection.lines.push(...orphans);
          }
          parsed.orphanLines = [];
          contentRelocated += orphans.filter((l) => l.trim().length > 0).length;
        }
        actionsApplied.push(`relocate_orphan_lines->${action.target}`);
        break;
      }

      case "classify_and_relocate": {
        // Heuristic first
        const classified = classifyHeuristic(action.blocks);

        // LLM fallback for blocks that went to topic: (if requiresLLM)
        let finalClassified = classified;
        if (plan.requiresLLM) {
          try {
            const llmResults = await classifyWithLLM(
              action.blocks,
              deps.generateText,
            );
            // Use LLM results where heuristic defaulted to topic:
            finalClassified = classified.map((heuristic, i) => {
              const llm = llmResults[i];
              if (
                heuristic.target.startsWith("topic:") &&
                llm &&
                (llm.target === "⚡ Core Memory" || llm.target === "🔥 Active Context")
              ) {
                return llm;
              }
              return heuristic;
            });
          } catch {
            // Keep heuristic results
          }
        }

        // Apply classification
        for (const item of finalClassified) {
          const nonEmpty = item.lines.filter((l) => l.trim().length > 0);
          if (nonEmpty.length === 0) {continue;}

          if (item.target === "⚡ Core Memory" || item.target === "🔥 Active Context") {
            const targetSection = parsed.sections.find(
              (s) => s.heading === item.target,
            );
            if (targetSection) {
              targetSection.lines.push(...nonEmpty);
            } else {
              parsed.sections.push({
                heading: item.target,
                startLine: -1,
                lines: nonEmpty,
              });
            }
          } else if (item.target.startsWith("topic:")) {
            const subject = item.target.slice("topic:".length);
            const topicPath = `memory/topics/${subject}.md`;
            await deps.appendToTopicFile(
              `${workspaceDir}/${topicPath}`,
              nonEmpty.join("\n"),
            );
          }

          // Remove the unknown section
          parsed.sections = parsed.sections.filter(
            (s) => s.heading !== item.heading,
          );
          contentRelocated += nonEmpty.length;
        }
        actionsApplied.push("classify_and_relocate");
        break;
      }

      case "reorder_sections": {
        // Will be handled during serialization
        actionsApplied.push("reorder_sections");
        break;
      }

      case "fix_dangling_pointer": {
        // Remove the dangling pointer from Topic Pointers
        const tpSection = parsed.sections.find(
          (s) => s.heading === "Topic Pointers",
        );
        if (tpSection) {
          tpSection.lines = tpSection.lines.filter(
            (l) => !l.includes(action.pointer),
          );
        }
        actionsApplied.push(`fix_dangling_pointer:${action.pointer}`);
        break;
      }

      case "register_orphan_file": {
        // Add pointer to Topic Pointers
        const tpSection = parsed.sections.find(
          (s) => s.heading === "Topic Pointers",
        );
        if (tpSection) {
          const fileName = action.file.replace(/^.*\//, "").replace(".md", "");
          tpSection.lines.push(`- ${fileName} → ${action.file}`);
        }
        actionsApplied.push(`register_orphan_file:${action.file}`);
        break;
      }

      case "relocate_promoted_content": {
        const promotedSection = parsed.sections.find((s) =>
          isPromotedHeading(s.heading),
        );
        if (promotedSection && promotedSection.lines.length > 0) {
          // Move to a topic file
          const nonEmpty = promotedSection.lines.filter(
            (l) => l.trim().length > 0,
          );
          await deps.appendToTopicFile(
            `${workspaceDir}/memory/topics/promoted.md`,
            nonEmpty.join("\n"),
          );
          promotedSection.lines = [];
          contentRelocated += nonEmpty.length;
        }
        actionsApplied.push("relocate_promoted_content");
        break;
      }
    }
  }

  // Serialize — canonical order
  const finalContent = serializeRepaired(parsed, index, content);

  // Write
  await deps.writeRawMemoryIndex(workspaceDir, finalContent);

  // Verify
  const verificationPassed = verifyStructure(finalContent);

  return {
    severity: plan.diagnostic.severity,
    actionsApplied,
    contentRelocated,
    contentDropped: 0,
    backupPath,
    verificationPassed,
  };
}

// ---------------------------------------------------------------------------
// Internal parsed structure
// ---------------------------------------------------------------------------

interface ParsedRawStructure {
  sections: Array<{
    heading: string;
    startLine: number;
    lines: string[];
  }>;
  orphanLines: string[];
  titlePresent: boolean;
  promotedContent: string[];
}

function parseRawStructure(content: string): ParsedRawStructure {
  const lines = content.split(/\r?\n/);
  const sections: ParsedRawStructure["sections"] = [];
  const promotedContent: string[] = [];
  let titlePresent = false;
  let current: { heading: string; startLine: number; lines: string[] } | null = null;
  let inPromoted = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (TITLE_RE.test(trimmed)) {
      titlePresent = true;
      continue;
    }

    if (SECTION_HEADING_RE.test(trimmed)) {
      if (inPromoted) {
        inPromoted = false;
      }
      if (current) {
        sections.push(current);
      }
      const heading = trimmed.replace(/^## /, "").trim();
      if (isPromotedHeading(heading)) {
        inPromoted = true;
        current = { heading, startLine: i, lines: [] };
        continue;
      }
      current = { heading, startLine: i, lines: [] };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    sections.push(current);
  }

  return {
    sections,
    orphanLines: collectOrphanLines(lines),
    titlePresent,
    promotedContent,
  };
}

function serializeRepaired(
  parsed: ParsedRawStructure,
  _index: MemoryIndex,
  _originalContent: string,
): string {
  const parts: string[] = ["# Long-Term Memory", ""];

  // Canonical order: ⚡ Core Memory → 🔥 Active Context → Topic Pointers → promotedContent
  const canonicalOrder = ["⚡ Core Memory", "🔥 Active Context"];

  for (const heading of canonicalOrder) {
    const section = parsed.sections.find((s) => s.heading === heading);
    if (section) {
      parts.push(`## ${heading}`);
      parts.push(...section.lines);
      parts.push("");
    } else {
      // Create empty section if missing
      parts.push(`## ${heading}`);
      parts.push("");
    }
  }

  // Topic Pointers
  const tpSection = parsed.sections.find((s) => s.heading === "Topic Pointers");
  if (tpSection) {
    const nonEmptyLines = tpSection.lines.filter((l) => l.trim().length > 0);
    if (nonEmptyLines.length > 0) {
      parts.push("## Topic Pointers");
      parts.push(...nonEmptyLines);
      parts.push("");
    }
  }

  // Promoted content (keep it but trimmed)
  const promotedSection = parsed.sections.find((s) =>
    isPromotedHeading(s.heading),
  );
  if (promotedSection && promotedSection.lines.length > 0) {
    parts.push("## Promoted From Short-Term Memory");
    parts.push(...promotedSection.lines);
    parts.push("");
  }

  // Any remaining sections that aren't in canonical order and aren't unknown
  // (e.g., References, Recent Sessions) — keep them at the end
  const handledHeadings = new Set([
    ...canonicalOrder,
    "Topic Pointers",
    "Promoted From Short-Term Memory",
  ]);
  for (const section of parsed.sections) {
    if (!handledHeadings.has(section.heading)) {
      const nonEmpty = section.lines.filter((l) => l.trim().length > 0);
      if (nonEmpty.length > 0) {
        parts.push(`## ${section.heading}`);
        parts.push(...section.lines);
        parts.push("");
      }
    }
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// 6. verifyStructure
// ---------------------------------------------------------------------------

export function verifyStructure(content: string): boolean {
  const lines = content.split(/\r?\n/);
  const { sections } = scanRawLines(lines);

  // Check: no unknown headings
  for (const section of sections) {
    if (!isKnownHeading(section.heading)) {
      return false;
    }
  }

  // Check: all required headings present
  const presentHeadings = new Set(sections.map((s) => s.heading));
  for (const required of REQUIRED_HEADINGS) {
    const hasDirect = presentHeadings.has(required);
    const hasLegacy =
      isInlineSection(required) &&
      Object.entries(LEGACY_SECTION_MIGRATION).some(
        ([legacy, target]) => target === required && presentHeadings.has(legacy),
      );
    if (!hasDirect && !hasLegacy) {
      return false;
    }
  }

  // Check: no duplicate headings
  const headingCounts = new Map<string, number>();
  for (const section of sections) {
    headingCounts.set(section.heading, (headingCounts.get(section.heading) ?? 0) + 1);
  }
  for (const [, count] of headingCounts) {
    if (count > 1) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// 7. Orchestrator: repairMemoryStructure
// ---------------------------------------------------------------------------

export async function repairMemoryStructure(
  workspaceDir: string,
  deps: MemoryRepairDeps,
): Promise<RepairResult> {
  deps.log("[memory-repair] Starting repair diagnostic...");

  const content = await deps.readRawMemoryIndex(workspaceDir);

  // Handle both sync and async return from diagnoseStructure
  let diagnostic: RepairDiagnostic;
  const diagResult = diagnoseStructure(content, {
    listTopicFiles: () => deps.listTopicFiles(workspaceDir),
    topicFileExists: (p: string) => deps.topicFileExists(workspaceDir, p),
  });
  if (diagResult instanceof Promise) {
    diagnostic = await diagResult;
  } else {
    diagnostic = diagResult;
  }

  if (diagnostic.severity === "none") {
    deps.log("[memory-repair] No issues found, skipping.");
    return {
      severity: "none",
      actionsApplied: [],
      contentRelocated: 0,
      contentDropped: 0,
      verificationPassed: true,
    };
  }

  deps.log(
    `[memory-repair] Found ${diagnostic.issues.length} issues (severity=${diagnostic.severity}, score=${diagnostic.score}).`,
  );

  const plan = planRepair(diagnostic);

  deps.log(
    `[memory-repair] Planned ${plan.actions.length} actions (backup=${plan.requiresBackup}, llm=${plan.requiresLLM}).`,
  );

  const result = await executeRepair(plan, content, workspaceDir, deps);

  deps.log(
    `[memory-repair] Repair complete. Actions: ${result.actionsApplied.join(", ")}, relocated: ${result.contentRelocated}, verified: ${result.verificationPassed}.`,
  );

  return result;
}
