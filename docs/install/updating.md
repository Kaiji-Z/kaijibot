---
summary: "Updating KaijiBot safely (global install or source), plus rollback strategy"
read_when:
  - Updating KaijiBot
  - Something breaks after an update
title: "Updating"
---

# Updating

Keep KaijiBot up to date.

## Recommended: `kaijibot update`

The fastest way to update. It detects your install type (npm or git), fetches the latest version, runs `kaijibot doctor`, and restarts the gateway.

```bash
kaijibot update
```

To switch channels or target a specific version:

```bash
kaijibot update --channel beta
kaijibot update --tag main
kaijibot update --dry-run   # preview without applying
```

`--channel beta` prefers beta, but the runtime falls back to stable/latest when
the beta tag is missing or older than the latest stable release. Use `--tag beta`
if you want the raw npm beta dist-tag for a one-off package update.

See [Development channels](/install/development-channels) for channel semantics.

## Alternative: re-run from source

```bash
cd kaijibot
git pull
pnpm install
pnpm build
```

## Alternative: manual pnpm or bun

```bash
pnpm add -g kaijibot@latest
```

```bash
bun add -g kaijibot@latest
```

## Auto-updater

The auto-updater is off by default. Enable it in `~/.kaijibot/kaijibot.json`:

```json5
{
  update: {
    channel: "stable",
    auto: {
      enabled: true,
      stableDelayHours: 6,
      stableJitterHours: 12,
      betaCheckIntervalHours: 1,
    },
  },
}
```

| Channel  | Behavior                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| `stable` | Waits `stableDelayHours`, then applies with deterministic jitter across `stableJitterHours` (spread rollout). |
| `beta`   | Checks every `betaCheckIntervalHours` (default: hourly) and applies immediately.                              |
| `dev`    | No automatic apply. Use `kaijibot update` manually.                                                           |

The gateway also logs an update hint on startup (disable with `update.checkOnStart: false`).

## After updating

<Steps>

### Run doctor

```bash
kaijibot doctor
```

Migrates config, audits DM policies, and checks gateway health. Details: [Doctor](/gateway/doctor)

### Restart the gateway

```bash
kaijibot gateway restart
```

### Verify

```bash
kaijibot health
```

</Steps>

## Rollback

### Pin a version (source build)

```bash
cd kaijibot
git checkout <tag>
pnpm install
pnpm build
kaijibot doctor
kaijibot gateway restart
```

Tip: `git tag -l` shows available versions.

### Pin a commit (source)

```bash
git fetch origin
git checkout "$(git rev-list -n 1 --before=\"2026-01-01\" origin/main)"
pnpm install && pnpm build
kaijibot gateway restart
```

To return to latest: `git checkout main && git pull`.

## If you are stuck

- Run `kaijibot doctor` again and read the output carefully.
- For `kaijibot update --channel dev` on source checkouts, the updater auto-bootstraps `pnpm` when needed. If you see a pnpm/corepack bootstrap error, install `pnpm` manually (or re-enable `corepack`) and rerun the update.
- Check: [Troubleshooting](/gateway/troubleshooting)
- Ask in Discord: [https://discord.gg/clawd](https://discord.gg/clawd)

## Related

- [Install Overview](/install) — all installation methods
- [Doctor](/gateway/doctor) — health checks after updates
- [Migrating](/install/migrating) — major version migration guides
