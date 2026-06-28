/**
 * Shared CSS for Kindle Portal monitor dashboard.
 *
 * Pure CSS string — no backticks, no template literals, no `var(--...)`,
 * no flex/grid. Built via `+` concatenation so both the source and the
 * rendered output stay ES5-lint clean (lintKindleHtml scans the output).
 *
 * Target: Kindle Paperwhite 7th gen (6" e-ink, 300 PPI), placed below a
 * computer monitor and viewed at ~60-80cm. Body base is 22px so text stays
 * glanceable at that distance; every child size is declared in `em` so the
 * zoom JS (which steps `document.body.style.fontSize`) scales the whole page
 * uniformly across the 16-32px range.
 *
 * E-ink design system:
 * - 5-tone grayscale palette: #000 / #333 / #666 / #ccc / #fff
 * - Bookerly serif stack (Kindle system font), falls back to Palatino/Times
 * - 22px base font; em-based type scale
 * - 2-3px black borders for strong e-ink separation
 * - Float-based layout (old WebKit has no flexbox)
 */

export const SHARED_CSS: string =
  // ── Base ──────────────────────────────────────────────────────────────
  "body { margin: 0; padding: 10px 12px; background: #fff; color: #000;"
  + ' font-family: "Bookerly", "Palatino", "Times", serif;'
  + " font-size: 22px; line-height: 1.4; }"
  + "\n"
  // ── Clearfix (float layout helper) ────────────────────────────────────
  + '.clearfix::after { content: ""; display: block; clear: both; }'
  + "\n"
  // ── Header bar ────────────────────────────────────────────────────────
  + ".header { border-bottom: 3px solid #000; padding: 4px 0 10px;"
  + " margin-bottom: 10px; }"
  + "\n"
  + ".title { font-size: 1.27em; font-weight: bold; margin: 0 0 4px;"
  + " line-height: 1.2; letter-spacing: 0.3px; }"
  + "\n"
  + ".meta { font-size: 0.82em; color: #333; line-height: 1.5; }"
  + "\n"
  // ── Zoom controls (float right in header) ─────────────────────────────
  + ".zoom-bar { float: right; margin-left: 10px; }"
  + "\n"
  + ".zoom-btn { min-width: 40px; min-height: 40px; padding: 5px 10px;"
  + " margin-left: 4px; border: 2px solid #000; background: #fff; color: #000;"
  + ' font-family: "Bookerly", "Palatino", "Times", serif;'
  + " font-size: 1em; font-weight: bold; line-height: 1.2;"
  + " text-align: center; cursor: pointer; }"
  + "\n"
  // ── Inline badge (ACTIVE/IDLE indicator in header meta) ───────────────
  + ".badge { font-weight: bold; white-space: nowrap; }"
  + "\n"
  // ── Metrics row (3 floated boxes) ─────────────────────────────────────
  + ".metrics-row { border: 2px solid #000; margin: 8px 0; }"
  + "\n"
  + ".metric { float: left; width: 33%; text-align: center; padding: 10px 0;"
  + " border-right: 1px solid #ccc; }"
  + "\n"
  + ".metric-num { font-size: 1.36em; font-weight: bold; line-height: 1.1; }"
  + "\n"
  + ".metric-label { font-size: 0.73em; color: #666; }"
  + "\n"
  // ── Section ───────────────────────────────────────────────────────────
  + ".section { border-top: 2px solid #000; padding: 10px 0; margin-top: 6px; }"
  + "\n"
  + ".section-h { font-size: 1.09em; font-weight: bold; margin-bottom: 8px;"
  + " letter-spacing: 0.3px; }"
  + "\n"
  // ── Agent card ────────────────────────────────────────────────────────
  + ".card { border: 2px solid #000; padding: 12px; margin: 8px 0;"
  + " background: #fff; }"
  + "\n"
  + ".card-head { margin-bottom: 6px; }"
  + "\n"
  + ".status-badge { float: right; margin-left: 10px; margin-bottom: 4px; }"
  + "\n"
  + ".status-icon { font-size: 1.09em; font-weight: bold;"
  + " letter-spacing: 0.5px; white-space: nowrap; }"
  + "\n"
  + ".card-name { font-size: 1em; font-weight: bold; line-height: 1.3;"
  + " word-wrap: break-word; overflow-wrap: break-word; }"
  + "\n"
  + ".card-detail { font-size: 0.82em; color: #333; margin-top: 4px;"
  + " line-height: 1.4; }"
  + "\n"
  // ── Status modifiers (applied to .card) ───────────────────────────────
  // Active/working/failed cards get a 5px black accent bar and bold body
  // text so they pop on e-ink. Completed cards dim to #666.
  + ".card.status-thinking, .card.status-tool_calling, .card.status-failed {"
  + " border-left: 5px solid #000; font-weight: bold; }"
  + "\n"
  + ".card.status-completed { color: #666; }"
  + "\n"
  + ".card.status-completed .card-name { color: #666; }"
  + "\n"
  // ── Empty state ───────────────────────────────────────────────────────
  + ".empty { font-size: 1em; color: #333; padding: 24px 0;"
  + " text-align: center; border: 2px dashed #ccc; margin: 8px 0;"
  + " font-style: italic; }"
  + "\n"
  // ── Lane note (always "unavailable" under plugin boundary) ────────────
  + ".lane-note { font-size: 0.78em; color: #666; font-style: italic;"
  + " margin: 8px 0; padding: 4px 10px; border-left: 3px solid #ccc; }"
  + "\n"
  // ── Navigation ────────────────────────────────────────────────────────
  + ".nav { margin: 8px 0; font-size: 0.82em; }"
  + "\n"
  + ".nav a { color: #000; text-decoration: underline; font-weight: bold; }"
  + "\n"
  // ── Footer ────────────────────────────────────────────────────────────
  + ".footer { border-top: 2px solid #000; margin-top: 10px;"
  + " padding-top: 6px; font-size: 0.82em; color: #666; }";
