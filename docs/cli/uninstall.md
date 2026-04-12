---
summary: "CLI reference for `kaijibot uninstall` (remove gateway service + local data)"
read_when:
  - You want to remove the gateway service and/or local state
  - You want a dry-run first
title: "uninstall"
---

# `kaijibot uninstall`

Uninstall the gateway service + local data (CLI remains).

Options:

- `--service`: remove the gateway service
- `--state`: remove state and config
- `--workspace`: remove workspace directories
- `--app`: remove the macOS app
- `--all`: remove service, state, workspace, and app
- `--yes`: skip confirmation prompts
- `--non-interactive`: disable prompts; requires `--yes`
- `--dry-run`: print actions without removing files

Examples:

```bash
kaijibot backup create
kaijibot uninstall
kaijibot uninstall --service --yes --non-interactive
kaijibot uninstall --state --workspace --yes --non-interactive
kaijibot uninstall --all --yes
kaijibot uninstall --dry-run
```

Notes:

- Run `kaijibot backup create` first if you want a restorable snapshot before removing state or workspaces.
- `--all` is shorthand for removing service, state, workspace, and app together.
- `--non-interactive` requires `--yes`.
