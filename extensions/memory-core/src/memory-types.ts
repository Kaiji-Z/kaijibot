/**
 * Memory type taxonomy, exclusion rules, and write quality constants.
 *
 * Defines the 4 memory types (user, feedback, project, reference),
 * content exclusion heuristics, and prompt sections for classification,
 * quality enforcement, and verification.
 */

// ---------------------------------------------------------------------------
// Memory Type Enum
// ---------------------------------------------------------------------------

export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

const VALID_MEMORY_TYPES = new Set<string>(MEMORY_TYPES);

/**
 * Parse a raw string into a MemoryType. Returns null for unknown/undefined
 * values (graceful degradation).
 */
export function parseMemoryType(raw: string | undefined): MemoryType | null {
  if (raw === undefined) return null;
  if (VALID_MEMORY_TYPES.has(raw)) return raw as MemoryType;
  return null;
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

export const MEMORY_TYPE_FRONTMATTER_TEMPLATE = "---\ntype: {type}\n---\n";

export function formatMemoryFrontmatter(type: MemoryType): string {
  return MEMORY_TYPE_FRONTMATTER_TEMPLATE.replace("{type}", type);
}

// ---------------------------------------------------------------------------
// Exclusion Patterns
// ---------------------------------------------------------------------------

/** Line-level patterns that indicate code / implementation details. */
const CODE_LINE_PATTERNS = [
  /^\s*(?:function|class|interface|type|enum|const|let|var|import|export|from|require)\s/,
  /^\s*(?:if|for|while|return|throw|async|await)\s/,
  /^\s*\S+\s*=\s*["'{[/]/,
];

/** Substring patterns that indicate git / VCS info. */
const GIT_PATTERNS = ["commit", "branch", "merge", "PR #", "hash", "blame"];

/** Substring patterns for derivable / obvious statements. */
const DERIVABLE_PATTERNS = [
  "the file exists",
  "the function is",
  "you can see",
  "as shown in",
];

/** Substring patterns for ephemeral task state. */
const EPHEMERAL_PATTERNS = [
  "currently running",
  "in progress",
  "todo:",
  "FIXME",
];

/** Substring patterns for dreaming / diagnostic metadata. */
const DREAMING_PATTERNS = [
  "confidence:",
  "evidence:",
  "status: staged",
  "recalls:",
];

/** File path / extension patterns (substring match). */
const FILE_PATH_PATTERNS = ["/src/", "./", "../", ".ts", ".js", ".py", ".json"];

/**
 * Returns true if the content looks like something that should NOT be saved
 * as long-term memory (code, git info, derivable facts, ephemeral state,
 * or dreaming metadata).
 */
export function isExcludedMemoryContent(content: string): boolean {
  const lines = content.split("\n");
  const lower = content.toLowerCase();

  // Check dreaming metadata first (high-confidence exclusion)
  if (DREAMING_PATTERNS.some((p) => lower.includes(p.toLowerCase()))) return true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    // Code line patterns
    if (CODE_LINE_PATTERNS.some((re) => re.test(trimmed))) return true;

    // File path patterns
    if (FILE_PATH_PATTERNS.some((p) => trimmed.includes(p))) return true;

    // Git info
    const lineLower = trimmed.toLowerCase();
    if (GIT_PATTERNS.some((p) => lineLower.includes(p.toLowerCase()))) return true;

    // Derivable info
    if (DERIVABLE_PATTERNS.some((p) => lineLower.includes(p.toLowerCase()))) return true;

    // Ephemeral state
    if (EPHEMERAL_PATTERNS.some((p) => lineLower.includes(p.toLowerCase()))) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Prompt Sections
// ---------------------------------------------------------------------------

export const EXCLUSION_PROMPT_SECTION = `## What NOT to save in memory

- Code patterns, conventions, architecture, file paths, or project structure
- Git history, recent changes, or who-changed-what
- Debugging solutions or fix recipes — the fix is in the code
- Anything already documented in project files
- Ephemeral task details: in-progress work, temporary state, current conversation context
- Information tools can look up in real-time (weather, time, file contents)
- Dreaming/diagnostic metadata (confidence scores, evidence paths, status markers)

These exclusions apply even when explicitly asked to save. If asked to save a list or summary, ask what was *surprising* or *non-obvious* about it.`;

export const WRITE_QUALITY_PROMPT_SECTION = `## Memory Write Quality Rules

1. **Classify**: Tag each memory with type frontmatter: ---\\ntype: user|feedback|project|reference\\n---
2. **Absolute dates**: Convert relative dates ("yesterday", "last week") to absolute dates (2026-04-01)
3. **Record confirmations**: When user validates an approach ("yes exactly", "keep doing that"), record it
4. **Why + How to apply**: For feedback and project types, include WHY it matters and HOW to apply it
5. **Don't duplicate**: If MEMORY.md already says X, don't save X again — update the existing entry`;

export const CLASSIFICATION_PROMPT_SECTION = `## Memory Classification

Tag each memory with one of 4 types using frontmatter:
- **user**: Personal info, preferences, identity, relationships (e.g., timezone, family, privacy rules)
- **feedback**: Corrections AND confirmations from user (e.g., "check docs first", "that approach was right")
- **project**: Decisions, milestones, known issues NOT derivable from code/git (e.g., "migrated to v2 on 2026-03-01")
- **reference**: External pointers (e.g., URLs, version numbers, connected services)

Format: ---\\ntype: <type>\\n---\\n<content>`;

export const VERIFICATION_PROMPT_SECTION = `## Before Recommending from Memory

A memory that names a specific file, function, or flag is a claim that it existed *when the memory was written*. Before recommending:
- If the memory names a file path: check the file exists
- If the memory names a function or flag: grep for it
- If the user is about to act on your recommendation, verify first

"The memory says X exists" is not the same as "X exists now."`;
