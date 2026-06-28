/**
 * Shared CSS for Kindle Portal HTML templates.
 *
 * Pure CSS string — no backticks, no template literals, no `var(--...)`,
 * no flex/grid. Built via `+` concatenation so both the source and the
 * rendered output stay ES5-lint clean (lintKindleHtml scans the output).
 *
 * Target: Kindle Paperwhite viewport (758px wide), 16-grayscale palette.
 * Layout uses floats + text-align only — old WebKit has no flexbox.
 *
 * E-ink design system:
 * - 5-tone grayscale palette: #000 / #333 / #666 / #ccc / #fff
 * - Bookerly serif stack (Kindle system font), falls back to Palatino/Times
 * - 18px base font; em-based type scale so body.fontSize zoom propagates
 * - 2px borders on cards, 3px rule under header, 1px dividers inside cards
 * - Status accent: 4px left bar on thinking/tool_calling/failed cards;
 *   completed cards dim to #666 (less prominent)
 */

export const SHARED_CSS: string =
  // ── Base ──────────────────────────────────────────────────────────────
  "body { margin: 0; padding: 10px 12px 18px; background: #fff; color: #000;"
  + ' font-family: "Bookerly", "Palatino", "Times", serif;'
  + " font-size: 18px; line-height: 1.4; }"
  + "\n"
  // ── Clearfix (float layout helper) ────────────────────────────────────
  + '.clearfix::after { content: ""; display: block; clear: both; }'
  + "\n"
  // ── Header bar ────────────────────────────────────────────────────────
  + ".header { border-bottom: 3px solid #000; padding: 4px 0 10px;"
  + " margin-bottom: 12px; }"
  + "\n"
  + ".title { font-size: 1.22em; font-weight: bold; margin: 0 0 4px;"
  + " line-height: 1.2; letter-spacing: 0.3px; }"
  + "\n"
  + ".meta { font-size: 0.78em; color: #333; line-height: 1.5; }"
  + "\n"
  // ── Zoom controls (float right in header) ─────────────────────────────
  + ".zoom-bar { float: right; margin-left: 10px; }"
  + "\n"
  + ".zoom-btn { display: inline-block; min-width: 36px; min-height: 36px;"
  + " padding: 5px 10px; margin-left: 4px; border: 2px solid #000;"
  + " background: #fff; color: #000;"
  + ' font-family: "Bookerly", "Palatino", "Times", serif;'
  + " font-size: 1em; font-weight: bold; line-height: 1.2;"
  + " text-align: center; cursor: pointer; }"
  + "\n"
  // ── Inline badge (ACTIVE/IDLE indicator in header meta) ───────────────
  + ".badge { font-weight: bold; white-space: nowrap; }"
  + "\n"
  // ── Navigation ────────────────────────────────────────────────────────
  + ".nav { margin: 10px 0; font-size: 0.89em; }"
  + "\n"
  + ".nav a { color: #000; text-decoration: underline; font-weight: bold; }"
  + "\n"
  // ── Lane note (always "unavailable" under plugin boundary) ────────────
  + ".lane-note { font-size: 0.78em; color: #666; font-style: italic;"
  + " margin: 12px 0; padding: 6px 10px; border-left: 3px solid #ccc; }"
  + "\n"
  // ── Empty state ───────────────────────────────────────────────────────
  + ".empty { font-size: 1em; color: #333; padding: 28px 12px;"
  + " text-align: center; border: 2px dashed #ccc; margin: 12px 0;"
  + " font-style: italic; }"
  + "\n"
  // ── Agent card ────────────────────────────────────────────────────────
  + ".card { border: 2px solid #000; padding: 14px; margin: 10px 0;"
  + " background: #fff; }"
  + "\n"
  + ".card-head { margin-bottom: 8px; }"
  + "\n"
  + ".card-name { font-size: 1.11em; font-weight: bold; line-height: 1.25;"
  + " word-wrap: break-word; overflow-wrap: break-word; }"
  + "\n"
  + ".status-badge { float: right; margin-left: 10px; margin-bottom: 4px;"
  + " padding: 2px 8px; border: 1px solid #000; background: #fff; }"
  + "\n"
  + ".status-icon { font-size: 1.22em; font-weight: bold;"
  + " letter-spacing: 0.5px; white-space: nowrap; }"
  + "\n"
  + ".card-body { border-top: 1px solid #ccc; padding-top: 8px;"
  + " margin-bottom: 4px; }"
  + "\n"
  + ".card-row { font-size: 0.89em; color: #333; margin: 3px 0; }"
  + "\n"
  + ".card-foot { border-top: 1px solid #ccc; padding-top: 6px;"
  + " margin-top: 6px; font-size: 0.78em; color: #666; }"
  + "\n"
  // ── Status modifiers (applied to .card) ───────────────────────────────
  // Active/working/failed cards get a 4px black accent bar and bold body
  // text so they pop on e-ink. Completed cards dim to #666 (less important).
  + ".card.status-thinking, .card.status-tool_calling, .card.status-failed {"
  + " border-left: 4px solid #000; font-weight: bold; }"
  + "\n"
  + ".card.status-completed { color: #666; }"
  + "\n"
  + ".card.status-completed .card-name { color: #666; }"
  + "\n"
  // ── Header state badge variants ───────────────────────────────────────
  // Re-uses status-* class names but scoped to inline .badge context.
  + ".badge .status-thinking { font-weight: bold; }"
  + "\n"
  + ".badge .status-completed { color: #666; font-weight: bold; }"
  + "\n"
  // ── Footer ────────────────────────────────────────────────────────────
  + ".footer { border-top: 2px solid #000; margin-top: 14px;"
  + " padding-top: 8px; font-size: 0.78em; color: #666; }";
