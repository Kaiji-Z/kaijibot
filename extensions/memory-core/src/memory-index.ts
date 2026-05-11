/**
 * MemoryIndexManager — reads, writes, and maintains the MEMORY.md index file.
 *
 * Hybrid format: the first 4 sections (👤 User, 💬 Key Feedback, 🎯 Active
 * Focus, 🔗 Reference) contain INLINE content directly in MEMORY.md. Remaining sections
 * are topic pointers under `## Title`. Legacy promoted content is always
 * preserved below new-format sections.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryIndexSection {
  subject: string;
  title: string;
  topicFile: string;
  summary: string;
}

export interface RecentSession {
  date: string;
  title: string;
  topicPath: string;
}

export interface InlineContent {
  section: string; // heading like "👤 User", "💬 Key Feedback", "🎯 Active Focus", "🔗 Reference"
  lines: string[]; // actual content lines (high-frequency info)
}

export interface MemoryIndex {
  sections: MemoryIndexSection[];
  recentSessions: RecentSession[];
  promotedContent: string;
  /** Inline sections rendered directly in MEMORY.md (high-frequency content). */
  inlineSections?: InlineContent[];
}

export interface MemoryIndexDeps {
  workspaceDir: string;
  fs: {
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, data: string) => Promise<void>;
    mkdir: (path: string, options: { recursive: boolean }) => Promise<void>;
    rename: (oldPath: string, newPath: string) => Promise<void>;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEMORY_MD = "MEMORY.md";
const TOPIC_FILE_PREFIX = "memory/topics/";
const DEFAULT_MAX_BYTES = 8192;

const SECTION_HEADING_RE = /^## (.+)$/;
const RECENT_SESSIONS_HEADING = "## Recent Sessions";
const PROMOTED_HEADING = "## Promoted From Short-Term Memory";
const INDEX_TITLE = "# Long-Term Memory";

const INLINE_SECTION_HEADINGS = ["👤 User", "💬 Key Feedback", "🎯 Active Focus", "🔗 Reference"] as const;

const INLINE_SECTION_SUBJECTS: Record<string, string> = {
  "👤 User": "user",
  "💬 Key Feedback": "feedback",
  "🎯 Active Focus": "project",
  "🔗 Reference": "reference",
};

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

async function atomicWrite(
  fs: MemoryIndexDeps["fs"],
  targetPath: string,
  data: string,
): Promise<void> {
  const dir = path.dirname(targetPath);
  const tmpName = `${path.basename(targetPath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  const tmpPath = path.join(dir, tmpName);
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, targetPath);
}

// ---------------------------------------------------------------------------
// Inline heading helpers
// ---------------------------------------------------------------------------

function parseInlineHeading(line: string): string | null {
  const trimmed = line.trim();
  for (const h of INLINE_SECTION_HEADINGS) {
    if (trimmed === `## ${h}`) return h;
  }
  return null;
}

function isInlineHeading(line: string): boolean {
  return parseInlineHeading(line) !== null;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function isRecentSessionsHeading(line: string): boolean {
  return line.trim() === RECENT_SESSIONS_HEADING;
}

function isPromotedHeading(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === PROMOTED_HEADING || trimmed.startsWith("## Promoted From Short-Term Memory");
}

function isReferencesHeading(line: string): boolean {
  return line.trim() === "## References";
}

function isTopicPointersHeading(line: string): boolean {
  return line.trim() === "## Topic Pointers";
}

function isH2Heading(line: string): boolean {
  return /^## /.test(line.trim());
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a MEMORY.md file into structured index.
 * Supports both new hybrid format (inline sections + topic pointers)
 * and legacy `## [type] Title` format.
 */
export function parseMemoryIndex(content: string): MemoryIndex {
  const lines = splitLines(content);
  const sections: MemoryIndexSection[] = [];
  const recentSessions: RecentSession[] = [];
  const inlineSections: InlineContent[] = [];

  let currentSection: MemoryIndexSection | null = null;
  let currentSectionSummaryLines: string[] = [];
  let currentInlineSection: string | null = null;
  let currentInlineLines: string[] = [];
  let promotedLines: string[] = [];
  let inPromoted = false;
  let inRecentSessions = false;
  let inReferences = false;
  let inTopicPointers = false;

  function flushSection(): void {
    if (currentSection) {
      currentSection.summary = currentSectionSummaryLines.join("\n").trim();
      sections.push(currentSection);
      currentSection = null;
      currentSectionSummaryLines = [];
    }
    if (currentInlineSection !== null) {
      // Trim trailing blank lines
      while (currentInlineLines.length > 0 && currentInlineLines[currentInlineLines.length - 1]!.trim() === "") {
        currentInlineLines.pop();
      }
      inlineSections.push({ section: currentInlineSection, lines: currentInlineLines });
      currentInlineSection = null;
      currentInlineLines = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (inPromoted) {
      promotedLines.push(line);
      continue;
    }

    if (isPromotedHeading(trimmed)) {
      flushSection();
      inPromoted = true;
      inRecentSessions = false;
      inReferences = false;
      promotedLines.push(line);
      continue;
    }

    // Check for inline section heading (## 👤 User, etc.)
    const inlineHeading = parseInlineHeading(trimmed);
    if (inlineHeading) {
      flushSection();
      currentInlineSection = inlineHeading;
      currentInlineLines = [];
      inRecentSessions = false;
      inReferences = false;
      continue;
    }

    // Check for References heading (## References)
    if (isReferencesHeading(trimmed)) {
      flushSection();
      inReferences = true;
      inRecentSessions = false;
      inTopicPointers = false;
      continue;
    }

    // Check for Topic Pointers heading (## Topic Pointers)
    if (isTopicPointersHeading(trimmed)) {
      flushSection();
      inTopicPointers = true;
      inRecentSessions = false;
      inReferences = false;
      continue;
    }

    // Check for topic section heading (## Title with → pointer)
    const sectionMatch = trimmed.match(SECTION_HEADING_RE);
    if (sectionMatch && !isInlineHeading(trimmed) && !isRecentSessionsHeading(trimmed) && !isPromotedHeading(trimmed) && !isReferencesHeading(trimmed)) {
      // Look ahead for → pointer to distinguish from inline headings
      const nextLine = lines[i + 1]?.trim() ?? "";
      if (nextLine.startsWith("→ ")) {
        flushSection();
        const title = sectionMatch[1]!;
        currentSection = { subject: "", title, topicFile: "", summary: "" };
        currentSectionSummaryLines = [];
        inRecentSessions = false;
        inReferences = false;
        continue;
      }
    }

    if (isRecentSessionsHeading(trimmed)) {
      flushSection();
      inRecentSessions = true;
      inReferences = false;
      continue;
    }

    if (inRecentSessions) {
      const sessionMatch = trimmed.match(/^- (\d{4}-\d{2}-\d{2}) (.+?) (?:→|->) (.+)$/);
      if (sessionMatch) {
        recentSessions.push({
          date: sessionMatch[1]!,
          title: sessionMatch[2]!.trim(),
          topicPath: sessionMatch[3]!.trim(),
        });
      }
      continue;
    }

    // In References section — parse arrow lines as lightweight sections
    if (inReferences) {
      const arrowMatch = trimmed.match(/^→ (.+)$/);
      if (arrowMatch) {
        const topicFile = arrowMatch[1]!.trim();
        const basename = path.basename(topicFile, ".md");
        const subject = basename;
        sections.push({ subject, title: basename, topicFile, summary: "" });
      }
      continue;
    }

    // In Topic Pointers section — parse flat arrow lines
    if (inTopicPointers) {
      const arrowMatch = trimmed.match(/^- (.+?) → (.+)$/);
      if (arrowMatch) {
        sections.push({
          subject: arrowMatch[1]!.trim(),
          title: arrowMatch[1]!.trim(),
          topicFile: arrowMatch[2]!.trim(),
          summary: "",
        });
      }
      continue;
    }

    // In inline section — collect content lines
    if (currentInlineSection !== null) {
      currentInlineLines.push(line);
      continue;
    }

    // In old-style section
    if (currentSection) {
      const arrowMatch = trimmed.match(/^→ (.+)$/);
      if (arrowMatch && !currentSection.topicFile) {
        currentSection.topicFile = arrowMatch[1]!.trim();
        continue;
      }
      currentSectionSummaryLines.push(line);
    }
  }

  flushSection();

  return {
    sections,
    recentSessions,
    promotedContent: promotedLines.join("\n"),
    inlineSections,
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function serializeInlineSection(inline: InlineContent): string {
  return [`## ${inline.section}`, ...inline.lines].join("\n");
}

function serializeSection(section: MemoryIndexSection): string {
  const lines = [
    `## ${section.title}`,
    `→ ${section.topicFile}`,
  ];
  if (section.summary) {
    lines.push(section.summary);
  }
  return lines.join("\n");
}

function serializeRecentSession(session: RecentSession): string {
  return `- ${session.date} ${session.title} → ${session.topicPath}`;
}

function serializeIndex(index: MemoryIndex): string {
  const parts: string[] = [INDEX_TITLE, ""];

  // Inline sections first (high-frequency content)
  const inlineSections = index.inlineSections ?? [];
  for (const inline of inlineSections) {
    parts.push(serializeInlineSection(inline));
    parts.push("");
  }

  // Topic Pointers — flat list
  if (index.sections.length > 0) {
    parts.push("## Topic Pointers");
    for (const section of index.sections) {
      parts.push(`- ${section.title} → ${section.topicFile}`);
    }
    parts.push("");
  }

  if (index.promotedContent) {
    parts.push(index.promotedContent);
    if (!index.promotedContent.endsWith("\n")) {
      parts.push("");
    }
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Legacy detection
// ---------------------------------------------------------------------------

function isLegacyFormat(content: string): boolean {
  const lines = splitLines(content);
  for (const line of lines) {
    const trimmed = line.trim();
    if (SECTION_HEADING_RE.test(trimmed)) return false;
    if (isInlineHeading(trimmed)) return false;
    if (isPromotedHeading(trimmed)) return false;
    if (isRecentSessionsHeading(trimmed)) return false;
    if (isReferencesHeading(trimmed)) return false;
  }
  // If it has content but no recognized new-format markers, it's legacy
  return content.trim().length > 0;
}

// ---------------------------------------------------------------------------
// MemoryIndexManager
// ---------------------------------------------------------------------------

export class MemoryIndexManager {
  private readonly deps: MemoryIndexDeps;

  constructor(deps: MemoryIndexDeps) {
    this.deps = deps;
  }

  private get workspaceDir(): string {
    return this.deps.workspaceDir;
  }

  private get fs(): MemoryIndexDeps["fs"] {
    return this.deps.fs;
  }

  private resolveMemoryPath(): string {
    return path.join(this.workspaceDir, MEMORY_MD);
  }

  async readIndex(): Promise<MemoryIndex> {
    let content: string;
    try {
      content = await this.fs.readFile(this.resolveMemoryPath());
    } catch {
      return { sections: [], recentSessions: [], promotedContent: "", inlineSections: [] };
    }
    return parseMemoryIndex(content);
  }

  async writeIndex(index: MemoryIndex): Promise<void> {
    const serialized = serializeIndex(index);
    await atomicWrite(this.fs, this.resolveMemoryPath(), serialized);
  }

  async updateSection(section: MemoryIndexSection): Promise<void> {
    const index = await this.readIndex();
    const existingIdx = index.sections.findIndex(
      (s) => s.topicFile === section.topicFile,
    );
    if (existingIdx >= 0) {
      index.sections[existingIdx] = section;
    } else {
      index.sections.push(section);
    }
    await this.writeIndex(index);
  }

  async addRecentSession(session: RecentSession): Promise<void> {
    const index = await this.readIndex();
    index.recentSessions.unshift(session);
    await this.writeIndex(index);
  }

  async rebalanceIndex(maxBytes: number = DEFAULT_MAX_BYTES): Promise<void> {
    const index = await this.readIndex();
    const promotedBytes = new TextEncoder().encode(index.promotedContent).length;

    const sectionBytes = (section: MemoryIndexSection): number => {
      return new TextEncoder().encode(`- ${section.title} → ${section.topicFile}\n`).length;
    };

    const inlineBytes = (inline: InlineContent): number => {
      return new TextEncoder().encode(serializeInlineSection(inline) + "\n\n").length;
    };

    const inlineSections = index.inlineSections ?? [];

    let totalBytes =
      index.sections.reduce((sum, s) => sum + sectionBytes(s), 0) +
      inlineSections.reduce((sum, s) => sum + inlineBytes(s), 0) +
      promotedBytes;

    if (totalBytes <= maxBytes) return;

    // Step 1: Trim inline section content (remove lines from last section first)
    while (totalBytes > maxBytes) {
      let trimmed = false;
      for (let i = inlineSections.length - 1; i >= 0; i--) {
        const inline = inlineSections[i]!;
        if (inline.lines.length > 0) {
          const removedLine = inline.lines.pop()!;
          totalBytes -= new TextEncoder().encode(removedLine + "\n").length;
          trimmed = true;
          break;
        }
      }
      if (!trimmed) break;
    }

    if (totalBytes <= maxBytes) {
      index.inlineSections = inlineSections;
      await this.writeIndex(index);
      return;
    }

    // Step 2: Relocate entire inline sections to topic files
    while (totalBytes > maxBytes && inlineSections.length > 0) {
      const relocated = inlineSections.pop()!;
      totalBytes -= inlineBytes(relocated);
      const subject = INLINE_SECTION_SUBJECTS[relocated.section] ?? "misc";
      await this.relocateInlineToTopic(relocated, subject);
    }

    index.inlineSections = inlineSections;

    // Step 3: Remove oldest section entries from the end, never touch promoted
    while (totalBytes > maxBytes && index.sections.length > 0) {
      const removed = index.sections.pop()!;
      totalBytes -= sectionBytes(removed);
    }

    await this.writeIndex(index);
  }

  /**
   * Relocate evicted inline content to the appropriate topic file.
   * Appends the inline section's lines to the default topic file for the
   * given memory type.
   */
  async relocateInlineToTopic(section: InlineContent, subject: string): Promise<void> {
    const topicFile = `${subject}.md`;
    const today = new Date().toISOString().slice(0, 10);

    let existingContent = "";
    try {
      existingContent = await this.fs.readFile(
        path.join(this.workspaceDir, TOPIC_FILE_PREFIX, topicFile),
      );
    } catch {
      // file does not exist yet
    }

    const frontmatter = !existingContent
      ? [
          "---",
          `subject: ${subject}`,
          `created: ${today}`,
          `updated: ${today}`,
          "entries: 0",
          "---",
          "",
        ].join("\n")
      : "";

    const appendContent = [
      `## ${section.section} (relocated from MEMORY.md)`,
      ...section.lines,
    ].join("\n");

    const fullContent = existingContent + frontmatter + appendContent + "\n";

    await this.fs.mkdir(path.join(this.workspaceDir, TOPIC_FILE_PREFIX), { recursive: true });
    await this.fs.writeFile(
      path.join(this.workspaceDir, TOPIC_FILE_PREFIX, topicFile),
      fullContent,
    );
  }

  async migrateLegacy(content: string): Promise<string> {
    if (!isLegacyFormat(content)) {
      return content;
    }

    const parts: string[] = [
      INDEX_TITLE,
      "",
    ];

    // Preserve all existing content under promoted heading
    parts.push(`${PROMOTED_HEADING} (legacy)`);
    parts.push(content.trim());
    parts.push("");

    return parts.join("\n");
  }
}
