/**
 * Shared CSS for Kindle Portal HTML templates.
 *
 * Pure CSS string — no backticks, no template literals, no `var(--...)`,
 * no flex/grid. Built via `+` concatenation so both the source and the
 * rendered output stay ES5-lint clean (lintKindleHtml scans the output).
 *
 * Target: Kindle Paperwhite viewport (758px wide), 16-grayscale palette.
 * Layout uses floats + text-align only — old WebKit has no flexbox.
 */

export const SHARED_CSS: string =
  "body { margin: 0; padding: 8px; background: #fff; color: #000;"
  + ' font-family: "Bookerly", "Palatino", serif; font-size: 14px;'
  + " line-height: 1.3; }"
  + "\n"
  + '.clearfix::after { content: ""; display: block; clear: both; }'
  + "\n"
  + ".header { border-bottom: 1px solid #000; padding: 4px 0; margin-bottom: 8px; }"
  + "\n"
  + ".title { font-size: 18px; font-weight: bold; }"
  + "\n"
  + ".meta { font-size: 12px; color: #555; }"
  + "\n"
  + ".card { border: 1px solid #999; padding: 8px; margin: 8px 0; background: #fff; }"
  + "\n"
  + ".card-id { font-size: 14px; font-weight: bold; margin-bottom: 4px; }"
  + "\n"
  + ".card-row { font-size: 12px; margin: 2px 0; }"
  + "\n"
  + ".status-thinking { font-weight: bold; }"
  + "\n"
  + ".status-tool_calling { font-weight: bold; }"
  + "\n"
  + ".status-completed { color: #555; }"
  + "\n"
  + ".status-failed { font-weight: bold; }"
  + "\n"
  + ".lane-note { font-size: 12px; color: #555; font-style: italic; margin: 8px 0; }"
  + "\n"
  + ".empty { font-size: 14px; color: #555; padding: 16px 0; text-align: center; }"
  + "\n"
  + ".footer { border-top: 1px solid #999; margin-top: 8px; padding-top: 4px;"
  + " font-size: 11px; color: #555; }"
  + "\n"
  + ".nav { margin: 4px 0; font-size: 12px; }"
  + "\n"
  + ".nav a { color: #000; text-decoration: underline; }";
