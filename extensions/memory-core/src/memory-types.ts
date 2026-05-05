/**
 * Memory exclusion rules and write quality constants.
 *
 * Prompt sections for subject-based classification, quality enforcement,
 * and verification. Routing is by subject-based topic.
 */

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

1. **Classify by subject**: Tag each memory with a topic subject (English kebab-case, e.g. \`feishu\`, \`philosophy\`, \`product\`).
2. **Absolute dates**: Convert relative dates ("yesterday", "last week") to absolute dates (2026-04-01)
3. **Record confirmations**: When user validates an approach ("yes exactly", "keep doing that"), record it
4. **Why + How to apply**: For feedback and project types, include WHY it matters and HOW to apply it
5. **Don't duplicate**: If MEMORY.md already says X, don't save X again — update the existing entry`;

export const CLASSIFICATION_PROMPT_SECTION = `## Memory Classification

For each memory, choose:
1. **topic** (required): A subject name in English kebab-case that best categorizes this memory. Group related memories together. Examples: \`feishu\`, \`philosophy\`, \`product\`, \`football\`, \`memory-system\`, \`ai-tools\`.
2. **type** (required): One of four categories:
   - \`user\` — Personal information about the user: preferences, interests, background, personality traits, communication style, goals
   - \`feedback\` — Explicit or implicit feedback about the assistant: corrections, praise, complaints, preferences about AI behavior
   - \`project\` — Work/project-related information: decisions, requirements, status updates, architecture choices, constraints
   - \`reference\` — Factual reference material: articles, concepts, definitions, how-to knowledge, best practices

The topic determines the file; the type determines the section within MEMORY.md.`;

export const VERIFICATION_PROMPT_SECTION = `## Before Recommending from Memory

A memory that names a specific file, function, or flag is a claim that it existed *when the memory was written*. Before recommending:
- If the memory names a file path: check the file exists
- If the memory names a function or flag: grep for it
- If the user is about to act on your recommendation, verify first

"The memory says X exists" is not the same as "X exists now."`;

export const TOPIC_FILE_FORMAT_SECTION = `## Topic File Format

Each topic file lives under memory/topics/ and is named by subject (e.g. \`feishu.md\`, \`philosophy.md\`):

\`\`\`markdown
---
subject: feishu
created: YYYY-MM-DD
updated: YYYY-MM-DD
entries: N
---

## Entry Title (YYYY-MM-DD)

Entry content in free-form markdown.

## Another Entry (YYYY-MM-DD)

More content.
\`\`\`

Rules:
- Topic files are created on demand when memories are saved — no pre-created defaults
- Frontmatter uses \`subject\` (kebab-case) instead of type
- Each entry is a ## heading with title and date in parentheses
- Entry type: optional \`- **Type**: user|feedback|project|reference\` line
- Entry importance: "high", "normal" (default), or "low"
- Entry source: "session-compact", "memory-save", "dreaming", etc.`;
