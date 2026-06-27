/**
 * ES5 / old-WebKit HTML linter for Kindle-targeted output.
 *
 * Scans HTML line-by-line and flags tokens that old Kindle WebKit
 * (firmware ≤5.16.3, ES5-only) cannot handle.
 */

import type { LintIssue } from "../types.js";

/** JS tokens — matched case-sensitively */
const JS_TOKENS: readonly string[] = [
  "fetch(",
  "WebSocket",
  "EventSource",
  "=>",
  "`",
  "const ",
  "let ",
  "async ",
  "await ",
] as const;

/** CSS tokens — matched case-insensitively */
const CSS_TOKENS: readonly string[] = [
  "display: flex",
  "display:grid",
  "display:inline-flex",
  "var(--",
  "position:fixed",
  "position: sticky",
  "@font-face",
] as const;

/** All forbidden tokens (JS + CSS) */
const ALL_TOKENS: readonly string[] = [...JS_TOKENS, ...CSS_TOKENS] as const;

/** Set of CSS tokens for fast lookup */
const CSS_TOKEN_SET = new Set(CSS_TOKENS);

/** Regex to match allowlist markers: <!-- kindle-allow: TOKEN --> */
const ALLOW_MARKER_RE = /<!-- kindle-allow: (.+?) -->/g;

/**
 * Lint an HTML string for ES5/old-WebKit incompatibilities.
 *
 * Returns issues sorted by line number ascending, then by token alphabetical order.
 * Empty array means the HTML passes lint.
 */
export function lintKindleHtml(html: string): LintIssue[] {
  const lines = html.split("\n");
  const issues: LintIssue[] = [];

  // Map<token, remainingSuppressCount>
  const suppress = new Map<string, number>();
  for (const token of ALL_TOKENS) {
    suppress.set(token, 0);
  }

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNum = lineIdx + 1;

    // Check for allowlist markers on this line
    let markerMatch: RegExpExecArray | null;
    // Reset lastIndex since we reuse the regex with `g` flag
    ALLOW_MARKER_RE.lastIndex = 0;
    while ((markerMatch = ALLOW_MARKER_RE.exec(line)) !== null) {
      const raw = markerMatch[1];
      // The captured group may include the trailing space if present in marker
      // e.g. "<!-- kindle-allow: const  -->" captures "const "
      if (suppress.has(raw)) {
        suppress.set(raw, 5);
      }
    }

    // Check each forbidden token against this line
    for (const token of ALL_TOKENS) {
      // If suppressed, skip and decrement (check before decrement = covers this line + next 4)
      const count = suppress.get(token) ?? 0;
      if (count > 0) {
        suppress.set(token, count - 1);
        continue;
      }

      // Match token in line
      const isCss = CSS_TOKEN_SET.has(token);
      const lineToCheck = isCss ? line.toLowerCase() : line;
      const tokenToMatch = isCss ? token.toLowerCase() : token;

      if (lineToCheck.includes(tokenToMatch)) {
        issues.push({
          line: lineNum,
          token,
          message: `${token} is not supported on Kindle old WebKit`,
        });
      }
    }
  }

  // Sort by line ascending, then token alphabetically
  issues.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    return a.token.localeCompare(b.token);
  });

  return issues;
}
