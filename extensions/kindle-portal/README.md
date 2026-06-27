# Kindle Portal

E-ink dashboard for KaijiBot: a live agent monitor and cognitive map rendered as 16-gray PNG, served on the gateway HTTP port and designed for Kindle's experimental browser.

## What It Does

The plugin registers an HTTP route at `/kindle/*` on the gateway port (default 18789). Two main features:

**Agent Monitor** (`/kindle/`)
A live-updating page showing active agent sessions, turn counts, and last-seen timestamps. The page uses ES5 JavaScript with XHR polling and a float-based layout. No flex, no grid, no WebSocket, because the Kindle browser does not support them.

**Cognitive Map** (`/kindle/map`)
A server-rendered PNG showing the user's persona domains and (optionally) knowledge-wiki concepts as a graph. The PNG is 16-grayscale, sized to fit a Kindle Paperwhite viewport (758 px default width). The underlying graph data is also available as JSON.

## Quick Start

1. Install graphviz on the gateway host (recommended for best map quality):

   ```bash
   sudo apt install graphviz
   ```

2. Enable the plugin and set an access token. Edit `~/.kaijibot/kaijibot.json`:

   ```json
   {
     "plugins": {
       "entries": {
         "kindle-portal": {
           "config": {
             "enabled": true,
             "accessToken": "your-secret-here"
           }
         }
       }
     }
   }
   ```

3. Restart the gateway so the new config takes effect:

   ```bash
   pnpm gw:deploy
   ```

4. Open the Kindle's experimental browser and go to:

   ```
   http://<gateway-ip>:18789/kindle/?token=your-secret-here
   ```

   Replace `<gateway-ip>` with your machine's LAN address (e.g., `192.168.1.42`).

5. Add a bookmark on the Kindle for quick access.

## Configuration

All keys live under `plugins.entries.kindle-portal.config` in `~/.kaijibot/kaijibot.json`.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `false` | Master toggle. When false, no HTTP routes are registered. |
| `accessToken` | string | (unset) | Optional shared secret. Non-loopback requests need `?token=<value>`. Loopback is always allowed. |
| `refreshIntervalSeconds` | number | `15` | Monitor page XHR polling interval. Floor of 15 enforced. |
| `mapRefreshSeconds` | number | `300` | Map page meta-refresh interval. PNG rendering is expensive; keep at 60 or above. |
| `scope` | string | `"last-active"` | Which user's persona to visualize. One of `last-active`, `all-users`, `specific-user`. |
| `userId` | string | (unset) | Feishu open_id (ou_xxx). Required when scope is `specific-user`. |
| `showWiki` | boolean | `true` | Overlay knowledge-wiki concept/entity nodes on the cognitive map. |
| `maxDomains` | number | `20` | Max persona domain nodes on the map (range 5-50). Top by strength. |
| `pngWidth` | number | `758` | Rendered PNG width in pixels (range 400-1072). 758 fits the Paperwhite viewport. |

### Example Configuration

```json
{
  "plugins": {
    "entries": {
      "kindle-portal": {
        "config": {
          "enabled": true,
          "accessToken": "my-shared-secret",
          "refreshIntervalSeconds": 20,
          "mapRefreshSeconds": 600,
          "scope": "last-active",
          "showWiki": true,
          "maxDomains": 25,
          "pngWidth": 758
        }
      }
    }
  }
}
```

## Kindle Setup

1. **Open the browser**: On the Kindle home screen, tap the three-dot menu, then "Experimental Browser".
2. **Enter the URL**: Type the full URL including token: `http://<gateway-ip>:18789/kindle/?token=<accessToken>`
3. **Bookmark it**: Tap the menu, then "Add Bookmark" for quick access.
4. **Prevent sleep**: Type `~ds` in the Kindle search bar (from the home screen, not inside the browser). This disables the screen timeout and keeps the dashboard visible.

## Auth

Requests from loopback addresses (`127.0.0.1` or `::1`) are always allowed, no token needed. This is convenient for desktop testing from the same machine.

For LAN access from a Kindle or other device on the same network, there are two modes:

- **Token required**: set `accessToken` in config. Every non-loopback request must include `?token=<accessToken>` in the query string. Without the token, the server returns 403.
- **Open LAN**: leave `accessToken` unset. Any device that can reach the gateway port can view the dashboard. This is fine on a trusted home network but not recommended on public or shared networks.

The token is checked on every request. There are no session cookies.

## PNG Rendering

The cognitive map is rendered to a 16-grayscale PNG using a three-tier fallback:

1. **graphviz `dot` binary** (best quality). Install with `apt install graphviz` (Debian/Ubuntu) or `brew install graphviz` (macOS). This produces clean, well-labeled layouts.
2. **@viz-js/viz WASM** (fallback). Ships with the plugin as a Node dependency. Quality is good but slightly slower than native graphviz.
3. **Hand-rolled SVG** (last resort). Used only if graphviz is absent and the WASM module fails. Nodes are rendered as basic circles with text labels. Functional but plain.

Install graphviz if you can. The other tiers exist so the plugin works out of the box on minimal systems.

## Cognitive Map Data Sources

The map pulls from two live sources:

**PersonaStore**: reads `~/.kaijibot/cognitive/persona/{agentId}/{userId}.json` to extract domain nodes, interest phases, and domain connection strengths. The `scope` and `userId` config keys control which user's data is shown.

**knowledge-wiki vault**: when `showWiki` is true and a wiki vault exists at `{workspace}/wiki/`, the plugin extracts concept and entity pages and overlays them as a second node cluster on the map. Cross-references between persona domains and wiki concepts appear as edges between the two clusters.

If neither source has data, the map page shows an empty-state message instead of a blank PNG.

## Kindle Compatibility

The dashboard targets Kindle firmware 5.16.3 and earlier, which use an older WebKit engine. Key constraints:

- ES5 JavaScript only (no let/const, no arrow functions, no template literals in the served HTML).
- No flexbox or CSS grid (layout uses floats).
- No WebSocket or Server-Sent Events (data is polled via XHR at the configured interval, minimum 15 seconds).
- PNG rendering uses 16 grayscale for good e-ink contrast.
- System serif fonts only (the Kindle browser ignores most web fonts).

**Firmware 5.16.4+**: Amazon switched to a Chromium-based browser engine. These Kindles can also run the dashboard, and they handle modern JavaScript and CSS fine. The one caveat: if you are running the gateway on the same machine and using `localhost` as the URL, the new Chromium engine may have DNS resolution quirks. Use your LAN IP address instead (e.g., `192.168.1.42` instead of `127.0.0.1`).

## Troubleshooting

**Blank page on Kindle**
- Check that the gateway is running and the plugin is enabled. You should see `kindle-portal` routes registered in the gateway startup log.
- Verify the URL includes `?token=` if `accessToken` is configured.
- Make sure the Kindle is on the same network as the gateway machine.

**Monitor shows no agents**
- The monitor only shows agents that have active sessions. Start a conversation in Feishu to create one.
- If you have sessions but see nothing, check that the agent events are reaching the gateway. The monitor subscribes to gateway agent events.

**Map is blank or shows no nodes**
- The map needs persona data. Chat with KaijiBot a few times so the cognitive system builds a persona profile. Check that `~/.kaijibot/cognitive/persona/` has JSON files for your user.
- If `scope` is `specific-user`, verify that `userId` is set to the correct Feishu open_id.

**E-ink ghosting on the map**
- The map page uses meta-refresh to reload the PNG periodically. E-ink ghosting from the previous render is normal and clears on the next full refresh. Increase `mapRefreshSeconds` to reduce refresh frequency.

**Slow map rendering**
- Install native graphviz (`apt install graphviz`). The WASM fallback is slower, and the hand-rolled SVG tier is slowest.
- Reduce `maxDomains` to lower the graph complexity.

## Development

Run the test suite:

```bash
pnpm test extensions/kindle-portal/
```
