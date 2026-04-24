/**
 * MemoryIndexManager — reads, writes, and maintains the MEMORY.md index file.
 *
 * The MEMORY.md file serves as the top-level index into topic files stored
 * under memory/topics/. New format sections go ABOVE any legacy promoted
 * content to ensure zero content loss during migration.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { type MemoryType, parseMemoryType } from "./memory-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryIndexSection {
  type: MemoryType;
  title: string;
  topicFile: string;
  summary: string;
}

export interface RecentSession {
  date: string;
  title: string;
  topicPath: string;
}

export interface MemoryIndex {
  sections: MemoryIndexSection[];
  recentSessions: RecentSession[];
  promotedContent: string;
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
const DEFAULT_MAX_BYTES = 25000;

const SECTION_HEADING_RE = /^## \[([^\]]+)\] (.+)$/;
const RECENT_SESSIONS_HEADING = "## Recent Sessions";
const PROMOTED_HEADING = "## Promoted From Short-Term Memory";
const INDEX_TITLE = "# Long-Term Memory Index";

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
// Parsing
// ---------------------------------------------------------------------------

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function isSectionHeading(line: string): boolean {
  return SECTION_HEADING_RE.test(line.trim());
}

function isRecentSessionsHeading(line: string): boolean {
  return line.trim() === RECENT_SESSIONS_HEADING;
}

function isPromotedHeading(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === PROMOTED_HEADING || trimmed.startsWith("## Promoted From Short-Term Memory");
}

function isTopicIndexTitle(line: string): boolean {
  return line.trim() === INDEX_TITLE;
}

function isH2Heading(line: string): boolean {
  return /^## /.test(line.trim());
}

/**
 * Parse a MEMORY.md file into structured index.
 */
export function parseMemoryIndex(content: string): MemoryIndex {
  const lines = splitLines(content);
  const sections: MemoryIndexSection[] = [];
  const recentSessions: RecentSession[] = [];

  let currentSection: MemoryIndexSection | null = null;
  let currentSectionSummaryLines: string[] = [];
  let promotedLines: string[] = [];
  let inPromoted = false;
  let inRecentSessions = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (inPromoted) {
      promotedLines.push(line);
      continue;
    }

    if (isPromotedHeading(trimmed)) {
      // Flush current section
      if (currentSection) {
        currentSection.summary = currentSectionSummaryLines.join("\n").trim();
        sections.push(currentSection);
        currentSection = null;
        currentSectionSummaryLines = [];
      }
      inPromoted = true;
      inRecentSessions = false;
      promotedLines.push(line);
      continue;
    }

    const sectionMatch = trimmed.match(SECTION_HEADING_RE);
    if (sectionMatch) {
      if (currentSection) {
        currentSection.summary = currentSectionSummaryLines.join("\n").trim();
        sections.push(currentSection);
      }

      const type = parseMemoryType(sectionMatch[1]) ?? "reference";
      const title = sectionMatch[2]!;
      currentSection = { type, title, topicFile: "", summary: "" };
      currentSectionSummaryLines = [];
      inRecentSessions = false;
      continue;
    }

    if (isRecentSessionsHeading(trimmed)) {
      if (currentSection) {
        currentSection.summary = currentSectionSummaryLines.join("\n").trim();
        sections.push(currentSection);
        currentSection = null;
        currentSectionSummaryLines = [];
      }
      inRecentSessions = true;
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

    if (currentSection) {
      const arrowMatch = trimmed.match(/^→ (.+)$/);
      if (arrowMatch && !currentSection.topicFile) {
        currentSection.topicFile = arrowMatch[1]!.trim();
        continue;
      }
      currentSectionSummaryLines.push(line);
    }
  }

  if (currentSection) {
    currentSection.summary = currentSectionSummaryLines.join("\n").trim();
    sections.push(currentSection);
  }

  return {
    sections,
    recentSessions,
    promotedContent: promotedLines.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function serializeSection(section: MemoryIndexSection): string {
  const lines = [
    `## [${section.type}] ${section.title}`,
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

  for (const section of index.sections) {
    parts.push(serializeSection(section));
    parts.push("");
  }

  if (index.recentSessions.length > 0) {
    parts.push(RECENT_SESSIONS_HEADING);
    for (const session of index.recentSessions) {
      parts.push(serializeRecentSession(session));
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
    if (SECTION_HEADING_RE.test(trimmed)) {
      return false;
    }
    if (isPromotedHeading(trimmed)) {
      return false;
    }
    if (isRecentSessionsHeading(trimmed)) {
      return false;
    }
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
      return { sections: [], recentSessions: [], promotedContent: "" };
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
      (s) => s.type === section.type && s.topicFile === section.topicFile,
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
      return new TextEncoder().encode(serializeSection(section) + "\n\n").length;
    };

    let totalBytes = index.sections.reduce((sum, s) => sum + sectionBytes(s), 0) + promotedBytes;

    if (totalBytes <= maxBytes) return;

    // Remove oldest section entries first (from the end), never touch promoted
    while (totalBytes > maxBytes && index.sections.length > 0) {
      const removed = index.sections.pop()!;
      totalBytes -= sectionBytes(removed);
    }

    await this.writeIndex(index);
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
