---
summary: "Install KaijiBot declaratively with Nix"
read_when:
  - You want reproducible, rollback-able installs
  - You're already using Nix/NixOS/Home Manager
  - You want everything pinned and managed declaratively
title: "Nix"
---

# Nix Installation

Install KaijiBot declaratively with **[nix-kaijibot](https://github.com/kaijibot/nix-kaijibot)** -- a batteries-included Home Manager module.

<Info>
The [nix-kaijibot](https://github.com/kaijibot/nix-kaijibot) repo is the source of truth for Nix installation. This page is a quick overview.
</Info>

## What You Get

- Gateway + macOS app + tools (whisper, spotify, cameras) -- all pinned
- Launchd service that survives reboots
- Plugin system with declarative config
- Instant rollback: `home-manager switch --rollback`

## Quick Start

<Steps>
  <Step title="Install Determinate Nix">
    If Nix is not already installed, follow the [Determinate Nix installer](https://github.com/DeterminateSystems/nix-installer) instructions.
  </Step>
  <Step title="Create a local flake">
    Use the agent-first template from the nix-kaijibot repo:
    ```bash
    mkdir -p ~/code/kaijibot-local
    # Copy templates/agent-first/flake.nix from the nix-kaijibot repo
    ```
  </Step>
  <Step title="Configure secrets">
    Set up your messaging bot token and model provider API key. Plain files at `~/.secrets/` work fine.
  </Step>
  <Step title="Fill in template placeholders and switch">
    ```bash
    home-manager switch
    ```
  </Step>
  <Step title="Verify">
    Confirm the launchd service is running and your bot responds to messages.
  </Step>
</Steps>

See the [nix-kaijibot README](https://github.com/kaijibot/nix-kaijibot) for full module options and examples.

## Nix Mode Runtime Behavior

When `KAIJIBOT_NIX_MODE=1` is set (automatic with nix-kaijibot), KaijiBot enters a deterministic mode that disables auto-install flows.

You can also set it manually:

```bash
export KAIJIBOT_NIX_MODE=1
```

On macOS, the GUI app does not automatically inherit shell environment variables. Enable Nix mode via defaults instead:

```bash
defaults write ai.kaijibot.mac kaijibot.nixMode -bool true
```

### What changes in Nix mode

- Auto-install and self-mutation flows are disabled
- Missing dependencies surface Nix-specific remediation messages
- UI surfaces a read-only Nix mode banner

### Config and state paths

KaijiBot reads JSON5 config from `KAIJIBOT_CONFIG_PATH` and stores mutable data in `KAIJIBOT_STATE_DIR`. When running under Nix, set these explicitly to Nix-managed locations so runtime state and config stay out of the immutable store.

| Variable               | Default                                 |
| ---------------------- | --------------------------------------- |
| `KAIJIBOT_HOME`        | `HOME` / `USERPROFILE` / `os.homedir()` |
| `KAIJIBOT_STATE_DIR`   | `~/.kaijibot`                           |
| `KAIJIBOT_CONFIG_PATH` | `$KAIJIBOT_STATE_DIR/kaijibot.json`     |

## Related

- [nix-kaijibot](https://github.com/kaijibot/nix-kaijibot) -- full setup guide
- [Wizard](/start/wizard) -- non-Nix CLI setup
- [Docker](/install/docker) -- containerized setup
