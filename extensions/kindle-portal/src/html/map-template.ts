/**
 * Cognitive map HTML template for Kindle Portal.
 *
 * Renders a minimal ES5-compatible page that displays a server-rendered
 * PNG cognitive map image and auto-refreshes via `<meta http-equiv="refresh">`.
 * No JavaScript — pure HTML + CSS + meta-refresh.
 */

import type { KindleConfig } from "../config.js";

export function renderMapHtml(
  cfg: Pick<KindleConfig, "mapRefreshSeconds" | "accessToken">,
): string {
  var sec = String(cfg.mapRefreshSeconds);
  var tq = cfg.accessToken ? "?token=" + cfg.accessToken : "";

  return '<!DOCTYPE html>'
    + '<html lang="en">'
    + '<head>'
    + '<meta charset="utf-8">'
    + '<meta http-equiv="refresh" content="' + sec + '">'
    + '<title>KaijiBot Cognitive Map</title>'
    + '<style>'
    + 'body { margin: 0; padding: 8px; background: #fff; color: #000;'
    + ' font-family: "Bookerly", "Palatino", serif; font-size: 14px; }'
    + 'h1 { font-size: 16px; margin: 0 0 8px 0; padding: 0; }'
    + 'img { width: 100%; height: auto; display: block;'
    + ' margin: 8px 0; border: 1px solid #999; }'
    + '.nav { margin: 8px 0; font-size: 14px; }'
    + '.nav a { color: #000; text-decoration: underline; }'
    + '.note { color: #555; font-size: 12px; margin-top: 8px; }'
    + '</style>'
    + '</head>'
    + '<body>'
    + '<h1>Cognitive Map</h1>'
    + '<div class="nav"><a href="/kindle/' + tq + '">Monitor</a></div>'
    + '<img src="/kindle/api/map.png' + tq + '" alt="Cognitive map">'
    + '<div class="note">Auto-refresh every ' + sec + 's.'
    + ' Read-only view of AI\'s understanding of you.</div>'
    + '</body>'
    + '</html>';
}
