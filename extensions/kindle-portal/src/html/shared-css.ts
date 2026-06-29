/**
 * Shared CSS for the Kindle Portal monitor dashboard.
 *
 * Pure CSS string — no backticks, no template literals, no `var(--...)`,
 * no flex/grid. Built via `+` concatenation so both the source and the
 * rendered output stay ES5-lint clean (lintKindleHtml scans the output).
 *
 * Target: Kindle Paperwhite 7th gen (6" e-ink, 300 PPI), placed below a
 * computer monitor and viewed at ~60-80cm. Body base is 30px so text stays
 * glanceable at that distance; every child size is declared in `em` so the
 * zoom JS (which steps `document.body.style.fontSize`) scales the whole page
 * uniformly across the 20-42px range.
 *
 * E-ink design system:
 * - 5-tone grayscale palette: #000 / #333 / #666 / #ccc / #fff
 * - Bookerly serif stack (Kindle system font), falls back to Palatino/Times
 * - 30px base font; em-based type scale
 * - 2-3px black borders for strong e-ink separation
 * - Float-based layout (old WebKit has no flexbox)
 */

export const SHARED_CSS: string =
  // ── Base ──────────────────────────────────────────────────────────────
  "body { margin: 0; padding: 10px 12px; background: #fff; color: #000;"
  + ' font-family: "Bookerly", "Palatino", "Times", serif;'
  + " font-size: 30px; line-height: 1.4; }"
  + "\n"
  // ── Clearfix (float layout helper) ────────────────────────────────────
  + '.clearfix::after { content: ""; display: block; clear: both; }'
  + "\n"
  // ── Tab bar (Monitor / Map navigation) ────────────────────────────────
  + ".tabs { border-bottom: 3px solid #000; margin-bottom: 12px; padding: 0; }"
  + "\n"
  + ".tab { display: inline-block; padding: 8px 20px; margin-right: 4px;"
  + " font-size: 0.73em; font-weight: bold; text-decoration: none;"
  + " color: #666; border: 2px solid #ccc; border-bottom: none; }"
  + "\n"
  + ".tab-active { color: #000; border: 2px solid #000; border-bottom: 3px solid #fff;"
  + " position: relative; top: 1px; background: #fff; }"
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
  + ".status-icon { font-size: 1.09em; font-weight: bold;"
  + " letter-spacing: 0.5px; white-space: nowrap; }"
  + "\n"
  // ── Metrics row (2 floated boxes: tokens + cost) ──────────────────────
  + ".metrics-row { border: 2px solid #000; margin: 8px 0; }"
  + "\n"
  + ".metric { float: left; width: 50%; text-align: center; padding: 10px 0;"
  + " border-right: 1px solid #ccc; box-sizing: border-box; }"
  + "\n"
  + ".metric-quarter { width: 50%; }"
  + "\n"
  + ".metric-quarter .metric-num { font-size: 1.2em; }"
  + "\n"
  + ".metric-num { font-size: 1.36em; font-weight: bold; line-height: 1.1; }"
  + "\n"
  + ".metric-label { font-size: 0.73em; color: #666; }"
  + "\n"
  // ── Provider quota section (progress bar) ─────────────────────────────
  + ".quota-section { border: 2px solid #000; padding: 14px; margin: 8px 0;"
  + " background: #fff; }"
  + "\n"
  + ".quota-label { font-size: 0.82em; font-weight: bold; margin-bottom: 4px; }"
  + "\n"
  + ".quota-window { margin: 6px 0; }"
  + "\n"
  + ".quota-window-label { font-size: 0.73em; color: #333; margin-bottom: 2px; }"
  + "\n"
  + ".quota-bar { border: 2px solid #000; height: 30px; background: #fff;"
  + " overflow: hidden; }"
  + "\n"
  + ".quota-fill { background: #000; height: 100%; }"
  + "\n"
  // ── Section ───────────────────────────────────────────────────────────
  + ".section { border-top: 2px solid #000; padding: 10px 0; margin-top: 6px; }"
  + "\n"
  // ── Agent card (registered agents list — idle vs active) ──────────────
  + ".agent-card { border: 2px solid #000; padding: 14px; margin: 8px 0;"
  + " background: #fff; }"
  + "\n"
  + ".agent-card.idle { border-color: #ccc; color: #666; }"
  + "\n"
  + ".agent-card.active { border-left: 6px solid #000; }"
  + "\n"
  + ".agent-id { font-size: 1em; font-weight: bold; }"
  + "\n"
  + ".agent-status { float: right; font-size: 0.73em; font-weight: bold; }"
  + "\n"
  + ".agent-model { font-size: 0.6em; color: #666; margin-top: 4px; }"
  + "\n"
  // ── Empty state ───────────────────────────────────────────────────────
  + ".empty { font-size: 1em; color: #333; padding: 24px 0;"
  + " text-align: center; border: 2px dashed #ccc; margin: 8px 0;"
  + " font-style: italic; }"
  + "\n"
  // ── Navigation ────────────────────────────────────────────────────────
  + ".nav { margin: 8px 0; font-size: 0.82em; }"
  + "\n"
  + ".nav a { color: #000; text-decoration: underline; font-weight: bold; }"
  + "\n"
  // ── Footer ────────────────────────────────────────────────────────────
  + ".footer { border-top: 2px solid #000; margin-top: 10px;"
  + " padding-top: 6px; font-size: 0.82em; color: #666; }";
