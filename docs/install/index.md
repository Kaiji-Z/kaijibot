---
summary: "Install KaijiBot -- source build, Docker, and cloud deployment methods"
read_when:
  - You need an install method other than the Getting Started quickstart
  - You want to deploy to a cloud platform
  - You need to update, migrate, or uninstall
title: "Install"
---

# Install

KaijiBot is distributed as source code. Build from source or use Docker.

## System requirements

- **Node.js >= 22** -- Node 24 recommended
- **pnpm** -- required for building from source (`corepack enable`)
- **macOS, Linux, or Windows** -- both native Windows and WSL2 are supported; WSL2 is more stable. See [Windows](/platforms/windows).

## Source build (recommended)

Clone the repo, install dependencies, and build:

```bash
git clone https://gitee.com/kaiji1126/kaijibot.git
cd kaijibot
pnpm install
pnpm build
```

<Tip>
国内镜像加速：`pnpm install --registry https://registry.npmmirror.com`
</Tip>

Then run onboarding and start the Gateway:

```bash
pnpm kaijibot onboard      # interactive setup wizard
pnpm kaijibot gateway --port 18789
```

Or link the CLI globally and use `kaijibot` directly:

```bash
pnpm link --global
kaijibot onboard
kaijibot gateway --port 18789
```

See [Setup](/start/setup) for full development workflows.

## Docker

For containerized or headless deployments:

```bash
git clone https://gitee.com/kaiji1126/kaijibot.git
cd kaijibot
docker compose up -d
```

The default `docker-compose.yml` runs the gateway service on port 18789. Configure via environment variables:

- `ZAI_API_KEY` -- LLM provider API key
- `KAIJIBOT_GATEWAY_TOKEN` -- gateway authentication token
- `KAIJIBOT_GATEWAY_PORT` -- override the default port (18789)
- `KAIJIBOT_GATEWAY_BIND` -- override the bind address

Config directory is mounted at `/home/node/.kaijibot`. See [Docker](/install/docker) for details.

## Cloud deployment

Deploy KaijiBot on a cloud server or VPS. The source build steps apply to any Linux VM:

```bash
# On your server
git clone https://gitee.com/kaiji1126/kaijibot.git
cd kaijibot
pnpm install --frozen-lockfile
pnpm build
kaijibot onboard
kaijibot gateway --port 18789
```

<CardGroup cols={3}>
  <Card title="VPS" href="/vps">Any Linux VPS</Card>
  <Card title="Docker VM" href="/install/docker-vm-runtime">Shared Docker steps</Card>
  <Card title="Kubernetes" href="/install/kubernetes">K8s</Card>
</CardGroup>

For managed startup after install:

- macOS: LaunchAgent via `kaijibot gateway install`
- Linux/WSL2: systemd user service via the same command
- Native Windows: Scheduled Task

## Verify the install

```bash
kaijibot --version      # confirm the CLI is available
kaijibot doctor         # check for config issues
kaijibot gateway status # verify the Gateway is running
```

## Update, migrate, or uninstall

<CardGroup cols={3}>
  <Card title="Updating" href="/install/updating" icon="refresh-cw">
    Keep KaijiBot up to date.
  </Card>
  <Card title="Migrating" href="/install/migrating" icon="arrow-right">
    Move to a new machine.
  </Card>
  <Card title="Uninstall" href="/install/uninstall" icon="trash-2">
    Remove KaijiBot completely.
  </Card>
</CardGroup>

For source builds, update by pulling the latest changes:

```bash
cd kaijibot
git pull
pnpm install
pnpm build
```

## Troubleshooting: `kaijibot` not found

If you used `pnpm link --global` but `kaijibot` is not found in your terminal:

```bash
node -v           # Node installed?
pnpm root -g      # Where are global packages?
echo "$PATH"      # Is the global bin dir in PATH?
```

If the pnpm global bin directory is not in your `$PATH`, add it to your shell startup file (`~/.zshrc` or `~/.bashrc`):

```bash
export PATH="$(pnpm bin -g):$PATH"
```

Then open a new terminal. See [Node setup](/install/node) for more details.
