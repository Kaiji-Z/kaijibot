---
summary: "CLI reference for `kaijibot browser` (lifecycle, profiles, tabs, actions, state, and debugging)"
read_when:
  - You use `kaijibot browser` and want examples for common tasks
  - You want to control a browser running on another machine via a node host
  - You want to attach to your local signed-in Chrome via Chrome MCP
title: "browser"
---

# `kaijibot browser`

Manage KaijiBot's browser control surface and run browser actions (lifecycle, profiles, tabs, snapshots, screenshots, navigation, input, state emulation, and debugging).

Related:

- Browser tool + API: [Browser tool](/tools/browser)

## Common flags

- `--url <gatewayWsUrl>`: Gateway WebSocket URL (defaults to config).
- `--token <token>`: Gateway token (if required).
- `--timeout <ms>`: request timeout (ms).
- `--expect-final`: wait for a final Gateway response.
- `--browser-profile <name>`: choose a browser profile (default from config).
- `--json`: machine-readable output (where supported).

## Quick start (local)

```bash
kaijibot browser profiles
kaijibot browser --browser-profile kaijibot start
kaijibot browser --browser-profile kaijibot open https://example.com
kaijibot browser --browser-profile kaijibot snapshot
```

## Lifecycle

```bash
kaijibot browser status
kaijibot browser start
kaijibot browser stop
kaijibot browser --browser-profile kaijibot reset-profile
```

Notes:

- For `attachOnly` and remote CDP profiles, `kaijibot browser stop` closes the
  active control session and clears temporary emulation overrides even when
  KaijiBot did not launch the browser process itself.
- For local managed profiles, `kaijibot browser stop` stops the spawned browser
  process.

## If the command is missing

If `kaijibot browser` is an unknown command, check `plugins.allow` in
`~/.kaijibot/kaijibot.json`.

When `plugins.allow` is present, the bundled browser plugin must be listed
explicitly:

```json5
{
  plugins: {
    allow: ["telegram", "browser"],
  },
}
```

`browser.enabled=true` does not restore the CLI subcommand when the plugin
allowlist excludes `browser`.

Related: [Browser tool](/tools/browser#missing-browser-command-or-tool)

## Profiles

Profiles are named browser routing configs. In practice:

- `kaijibot`: launches or attaches to a dedicated KaijiBot-managed Chrome instance (isolated user data dir).
- `user`: controls your existing signed-in Chrome session via Chrome DevTools MCP.
- custom CDP profiles: point at a local or remote CDP endpoint.

```bash
kaijibot browser profiles
kaijibot browser create-profile --name work --color "#FF5A36"
kaijibot browser create-profile --name chrome-live --driver existing-session
kaijibot browser create-profile --name remote --cdp-url https://browser-host.example.com
kaijibot browser delete-profile --name work
```

Use a specific profile:

```bash
kaijibot browser --browser-profile work tabs
```

## Tabs

```bash
kaijibot browser tabs
kaijibot browser tab new
kaijibot browser tab select 2
kaijibot browser tab close 2
kaijibot browser open https://docs.kaijibot.ai
kaijibot browser focus <targetId>
kaijibot browser close <targetId>
```

## Snapshot / screenshot / actions

Snapshot:

```bash
kaijibot browser snapshot
```

Screenshot:

```bash
kaijibot browser screenshot
kaijibot browser screenshot --full-page
kaijibot browser screenshot --ref e12
```

Notes:

- `--full-page` is for page captures only; it cannot be combined with `--ref`
  or `--element`.
- `existing-session` / `user` profiles support page screenshots and `--ref`
  screenshots from snapshot output, but not CSS `--element` screenshots.

Navigate/click/type (ref-based UI automation):

```bash
kaijibot browser navigate https://example.com
kaijibot browser click <ref>
kaijibot browser type <ref> "hello"
kaijibot browser press Enter
kaijibot browser hover <ref>
kaijibot browser scrollintoview <ref>
kaijibot browser drag <startRef> <endRef>
kaijibot browser select <ref> OptionA OptionB
kaijibot browser fill --fields '[{"ref":"1","value":"Ada"}]'
kaijibot browser wait --text "Done"
kaijibot browser evaluate --fn '(el) => el.textContent' --ref <ref>
```

File + dialog helpers:

```bash
kaijibot browser upload /tmp/kaijibot/uploads/file.pdf --ref <ref>
kaijibot browser waitfordownload
kaijibot browser download <ref> report.pdf
kaijibot browser dialog --accept
```

## State and storage

Viewport + emulation:

```bash
kaijibot browser resize 1280 720
kaijibot browser set viewport 1280 720
kaijibot browser set offline on
kaijibot browser set media dark
kaijibot browser set timezone Europe/London
kaijibot browser set locale en-GB
kaijibot browser set geo 51.5074 -0.1278 --accuracy 25
kaijibot browser set device "iPhone 14"
kaijibot browser set headers '{"x-test":"1"}'
kaijibot browser set credentials myuser mypass
```

Cookies + storage:

```bash
kaijibot browser cookies
kaijibot browser cookies set session abc123 --url https://example.com
kaijibot browser cookies clear
kaijibot browser storage local get
kaijibot browser storage local set token abc123
kaijibot browser storage session clear
```

## Debugging

```bash
kaijibot browser console --level error
kaijibot browser pdf
kaijibot browser responsebody "**/api"
kaijibot browser highlight <ref>
kaijibot browser errors --clear
kaijibot browser requests --filter api
kaijibot browser trace start
kaijibot browser trace stop --out trace.zip
```

## Existing Chrome via MCP

Use the built-in `user` profile, or create your own `existing-session` profile:

```bash
kaijibot browser --browser-profile user tabs
kaijibot browser create-profile --name chrome-live --driver existing-session
kaijibot browser create-profile --name brave-live --driver existing-session --user-data-dir "~/Library/Application Support/BraveSoftware/Brave-Browser"
kaijibot browser --browser-profile chrome-live tabs
```

This path is host-only. For Docker, headless servers, Browserless, or other remote setups, use a CDP profile instead.

Current existing-session limits:

- snapshot-driven actions use refs, not CSS selectors
- `click` is left-click only
- `type` does not support `slowly=true`
- `press` does not support `delayMs`
- `hover`, `scrollintoview`, `drag`, `select`, `fill`, and `evaluate` reject
  per-call timeout overrides
- `select` supports one value only
- `wait --load networkidle` is not supported
- file uploads require `--ref` / `--input-ref`, do not support CSS
  `--element`, and currently support one file at a time
- dialog hooks do not support `--timeout`
- screenshots support page captures and `--ref`, but not CSS `--element`
- `responsebody`, download interception, PDF export, and batch actions still
  require a managed browser or raw CDP profile

## Remote browser control (node host proxy)

If the Gateway runs on a different machine than the browser, run a **node host** on the machine that has Chrome/Brave/Edge/Chromium. The Gateway will proxy browser actions to that node (no separate browser control server required).

Use `gateway.nodes.browser.mode` to control auto-routing and `gateway.nodes.browser.node` to pin a specific node if multiple are connected.

Security + remote setup: [Browser tool](/tools/browser), [Remote access](/gateway/remote), [Tailscale](/gateway/tailscale), [Security](/gateway/security)
