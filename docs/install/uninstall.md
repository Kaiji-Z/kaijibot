---
summary: "Uninstall KaijiBot completely (CLI, service, state, workspace)"
read_when:
  - You want to remove KaijiBot from a machine
  - The gateway service is still running after uninstall
title: "Uninstall"
---

# Uninstall

Two paths:

- **Easy path** if `kaijibot` is still installed.
- **Manual service removal** if the CLI is gone but the service is still running.

## Easy path (CLI still installed)

Recommended: use the built-in uninstaller:

```bash
kaijibot uninstall
```

Non-interactive (automation / npx):

```bash
kaijibot uninstall --all --yes --non-interactive
npx -y kaijibot uninstall --all --yes --non-interactive
```

Manual steps (same result):

1. Stop the gateway service:

```bash
kaijibot gateway stop
```

2. Uninstall the gateway service (launchd/systemd/schtasks):

```bash
kaijibot gateway uninstall
```

3. Delete state + config:

```bash
rm -rf "${KAIJIBOT_STATE_DIR:-$HOME/.kaijibot}"
```

If you set `KAIJIBOT_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4. Delete your workspace (optional, removes agent files):

```bash
rm -rf ~/.kaijibot/workspace
```

5. Remove the CLI install (pick the one you used):

```bash
pnpm remove -g kaijibot
bun remove -g kaijibot
```

6. If you installed the macOS app:

```bash
rm -rf /Applications/KaijiBot.app
```

Notes:

- If you used profiles (`--profile` / `KAIJIBOT_PROFILE`), repeat step 3 for each state dir (defaults are `~/.kaijibot-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual service removal (CLI not installed)

Use this if the gateway service keeps running but `kaijibot` is missing.

### macOS (launchd)

Default label is `ai.kaijibot.gateway` (or `ai.kaijibot.<profile>`; legacy `com.kaijibot.*` may still exist):

```bash
launchctl bootout gui/$UID/ai.kaijibot.gateway
rm -f ~/Library/LaunchAgents/ai.kaijibot.gateway.plist
```

If you used a profile, replace the label and plist name with `ai.kaijibot.<profile>`. Remove any legacy `com.kaijibot.*` plists if present.

### Linux (systemd user unit)

Default unit name is `kaijibot-gateway.service` (or `kaijibot-gateway-<profile>.service`):

```bash
systemctl --user disable --now kaijibot-gateway.service
rm -f ~/.config/systemd/user/kaijibot-gateway.service
systemctl --user daemon-reload
```

### Windows (Scheduled Task)

Default task name is `KaijiBot Gateway` (or `KaijiBot Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "KaijiBot Gateway"
Remove-Item -Force "$env:USERPROFILE\.kaijibot\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.kaijibot-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (pnpm / bun)

If you installed via pnpm or bun, remove with `pnpm remove -g kaijibot` (or `bun remove -g`).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + `kaijibot ...` / `bun run kaijibot ...`):

1. Uninstall the gateway service **before** deleting the repo (use the easy path above or manual service removal).
2. Delete the repo directory.
3. Remove state + workspace as shown above.
