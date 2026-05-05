/**
 * Topic file types, parsing, and serialization for the memory system.
 *
 * Topic files are Markdown files with YAML frontmatter and ## heading entries.
 * Each topic file is named by subject (e.g. `feishu.md`, `philosophy.md`) and
 * lives under memory/topics/{subject}.md.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TopicFile {
  frontmatter: {
    subject: string;
    created: string; // YYYY-MM-DD
    updated: string; // YYYY-MM-DD
    entries: number;
  };
  entries: TopicEntry[];
  raw: string; // original markdown for round-trip
}

export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface TopicEntry {
  title: string;
  date: string; // YYYY-MM-DD
  content: string;
  importance?: "high" | "normal" | "low";
  source?: string; // e.g., "session-compact", "memory-save", "dreaming"
  type?: MemoryType; // memory classification
}

// ---------------------------------------------------------------------------
// Date helper
// ---------------------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const ENTRY_HEADING_RE = /^## (.+) \((\d{4}-\d{2}-\d{2})\)$/;

/**
 * Parse a topic entry heading line into title and date.
 * Heading format: `## Entry Title (YYYY-MM-DD)`
 */
export function parseTopicEntryHeading(line: string): { title: string; date: string } | null {
  const match = line.match(ENTRY_HEADING_RE);
  if (!match) return null;
  return { title: match[1]!, date: match[2]! };
}

/**
 * Parse a single entry section (everything after a `## Title (date)` heading
 * until the next `## ` heading or end-of-file).
 */
export function parseTopicEntry(entryMarkdown: string): TopicEntry {
  const lines = entryMarkdown.split(/\r?\n/);
  const heading = lines[0]?.trim() ?? "";
  const parsed = parseTopicEntryHeading(heading);

  let title = "Untitled";
  let date = todayIso();

  if (parsed) {
    title = parsed.title;
    date = parsed.date;
  }

  const contentLines = lines.slice(1);
  if (contentLines.length > 0 && contentLines[0]?.trim() === "") {
    contentLines.shift();
  }

  // Extract type from content if present
  let type: MemoryType | undefined;
  const typeLineIdx = contentLines.findIndex((l) =>
    l.trim().match(/^- \*\*Type\*\*: (user|feedback|project|reference)$/),
  );
  if (typeLineIdx >= 0) {
    const typeMatch = contentLines[typeLineIdx]!
      .trim()
      .match(/^- \*\*Type\*\*: (user|feedback|project|reference)$/);
    if (typeMatch) {
      type = typeMatch[1] as MemoryType;
      contentLines.splice(typeLineIdx, 1);
    }
  }

  const content = contentLines.join("\n").trimEnd();

  return { title, date, content, type };
}

/**
 * Parse raw YAML frontmatter text into a record. Minimal parser — no
 * external dependencies, handles simple `key: value` pairs.
 */
function parseYamlFrontmatter(yamlText: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of yamlText.split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    result[key] = value;
  }
  return result;
}

/**
 * Parse a complete topic file (frontmatter + entries) from raw markdown.
 * Backward-compatible: gracefully handles old `type` frontmatter.
 */
export function parseTopicFile(markdown: string): TopicFile {
  const fmMatch = markdown.match(FRONTMATTER_RE);
  const raw = markdown;

  let subject = "";
  let created = todayIso();
  let updated = todayIso();
  let entriesCount = 0;

  if (fmMatch) {
    const fm = parseYamlFrontmatter(fmMatch[1]!);
    subject = fm.subject ?? "";
    created = fm.created ?? todayIso();
    updated = fm.updated ?? todayIso();
    entriesCount = Number(fm.entries) || 0;
  }

  // Strip frontmatter to get body
  const body = fmMatch ? markdown.slice(fmMatch[0].length) : markdown;

  // Split into entry sections by ## headings
  const entries: TopicEntry[] = [];
  const sectionStarts: number[] = [];
  const bodyLines = body.split(/\r?\n/);

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i]?.trim() ?? "";
    if (ENTRY_HEADING_RE.test(line)) {
      sectionStarts.push(i);
    }
  }

  for (let s = 0; s < sectionStarts.length; s++) {
    const start = sectionStarts[s]!;
    const end = s + 1 < sectionStarts.length ? sectionStarts[s + 1]! : bodyLines.length;
    const sectionText = bodyLines.slice(start, end).join("\n");
    entries.push(parseTopicEntry(sectionText));
  }

  // If frontmatter says 0 entries but we found some, update count
  if (entriesCount === 0 && entries.length > 0) {
    entriesCount = entries.length;
  }

  return {
    frontmatter: { subject, created, updated, entries: entriesCount },
    entries,
    raw,
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Format a single entry heading line.
 */
export function formatEntryHeading(entry: TopicEntry): string {
  return `## ${entry.title} (${entry.date})`;
}

/**
 * Serialize a single TopicEntry to markdown text.
 */
export function serializeTopicEntry(entry: TopicEntry): string {
  const parts: string[] = [formatEntryHeading(entry)];
  if (entry.content || entry.type) {
    parts.push("");
  }
  if (entry.type) {
    parts.push(`- **Type**: ${entry.type}`);
  }
  if (entry.content) {
    parts.push(entry.content);
  }
  return parts.join("\n");
}

/**
 * Serialize a full TopicFile back to markdown.
 */
export function serializeTopicFile(topic: TopicFile): string {
  const fm = topic.frontmatter;
  const fmBlock = [
    "---",
    `subject: ${fm.subject}`,
    `created: ${fm.created}`,
    `updated: ${fm.updated}`,
    `entries: ${topic.entries.length}`,
    "---",
    "",
  ].join("\n");

  const entriesText = topic.entries.map((e) => serializeTopicEntry(e)).join("\n\n");

  const result = entriesText ? `${fmBlock}${entriesText}\n` : `${fmBlock}\n`;
  return result;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an empty TopicFile with no entries.
 */
export function createEmptyTopicFile(subject: string, name: string): TopicFile {
  const today = todayIso();
  const raw = [
    "---",
    `subject: ${subject}`,
    `created: ${today}`,
    `updated: ${today}`,
    "entries: 0",
    "---",
    "",
  ].join("\n");

  return {
    frontmatter: { subject, created: today, updated: today, entries: 0 },
    entries: [],
    raw,
  };
}
