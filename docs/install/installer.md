---
summary: "Install KaijiBot: one-click installer, npm, Docker, or build from source"
read_when:
  - You want to install KaijiBot
  - You want to run KaijiBot via Docker
  - You want to set up a development environment
title: "Installation Guide"
---

# Installation

KaijiBot supports multiple installation methods. Pick the one that suits your environment.
（KaijiBot 支持多种安装方式，按需选择。）

| Method | Command | Best for |
| ------ | ------- | -------- |
| **One-click install** (recommended / 推荐) | `curl -fsSL ... \| bash` | Most users, fastest path |
| **npm install** | `npm install -g kaijibot` | Users with Node.js already installed |
| **Docker** | `docker compose up -d` | Containerized / headless deployments |
| **Build from source** | `git clone` + `pnpm build` | Contributors and custom builds |

## Prerequisites

| Requirement | Minimum           | Recommended |
| ----------- | ----------------- | ----------- |
| Node.js     | 22 LTS (`22.14+`) | 24          |
| pnpm        | 9+                | latest      |
| Git         | 2.x               | latest      |

<Note>
KaijiBot targets Chinese users and uses the Gitee mirror as the default
upstream. A GitHub remote is also available for international contributors.
(默认使用 Gitee 镜像，GitHub 仓库同样可用。)
</Note>

---

## One-click install (一键安装，推荐)

**macOS / Linux:**

```bash
curl -fsSL https://gitee.com/kaiji1126/kaijibot/raw/main/scripts/install.sh | bash
```

The script auto-detects your system, installs Node.js if needed, configures the
environment, and launches the `kaijibot onboard` wizard. Uses the Gitee mirror
for fast downloads in China.（自动检测系统、安装 Node.js、配置环境，并启动
onboard 向导。）

**Windows (PowerShell):**

```powershell
iwr -useb https://gitee.com/kaiji1126/kaijibot/raw/main/scripts/install.ps1 | iex
```

---

## npm install (npm 全局安装)

If you already have Node.js 22+ installed:

```bash
npm install -g kaijibot
kaijibot onboard   # interactive setup wizard
```

Then start the gateway:

```bash
kaijibot gateway --port 18789
```

---

## Source build (从源码构建)

### 1. Clone the repository

```bash
git clone https://gitee.com/kaiji1126/kaijibot.git
cd kaijibot
```

### 2. Install dependencies

```bash
pnpm install
```

For users in China, use the npmmirror registry for faster downloads
(国内镜像加速):

```bash
pnpm install --registry https://registry.npmmirror.com
```

### 3. Build

```bash
pnpm build
```

### 4. Configure (配置)

Run the interactive setup wizard (交互式配置向导):

```bash
pnpm kaijibot onboard
```

Or set required values manually:

```bash
# LLM provider (at least one)
export ZAI_API_KEY="your-key"

# Feishu channel
pnpm kaijibot config set channels.feishu.appId "your-app-id"
pnpm kaijibot config set channels.feishu.appSecret "your-app-secret"
```

Config is stored at `~/.kaijibot/kaijibot.json`.

### 5. Start the gateway

```bash
pnpm kaijibot gateway --port 18789
```

Add `--verbose` for debug output. The gateway listens on port 18789 by default
and connects to Feishu via WebSocket.

### 6. Verify

Send a message to your bot in Feishu. If it responds, installation is complete.

---

## Docker (Docker / 容器部署)

### Quick start

```bash
git clone https://gitee.com/kaiji1126/kaijibot.git
cd kaijibot
docker compose up -d
```

### Default ports

| Port  | Purpose                    |
| ----- | -------------------------- |
| 18789 | Gateway (HTTP + WebSocket) |
| 18790 | Bridge                     |

### Configuration via environment

Set these in `docker-compose.yml` or a `.env` file:

```bash
ZAI_API_KEY=your-key
KAIJIBOT_GATEWAY_TOKEN=your-token
KAIJIBOT_GATEWAY_PORT=18789
KAIJIBOT_GATEWAY_BIND=0.0.0.0
```

Config and credentials are mounted at `/home/node/.kaijibot` inside the
container.

---

## Development setup (开发环境)

Same source-build steps as above. Useful commands for contributors:

| Command             | Purpose                            |
| ------------------- | ---------------------------------- |
| `pnpm build`        | Compile TypeScript                 |
| `pnpm tsgo`         | Type check only                    |
| `pnpm check`        | Lint + typecheck + boundary checks |
| `pnpm test`         | Run tests (Vitest)                 |
| `pnpm test <path>`  | Scoped test run                    |
| `pnpm format:fix`   | Auto-format (oxfmt)                |
| `pnpm kaijibot ...` | Run CLI in dev                     |

Pre-commit hooks: `prek install`. Skip with `FAST_COMMIT=1`.

---

## Syncing upstream

To pull updates from the Gitee upstream (同步上游):

```bash
git remote add upstream https://gitee.com/kaiji1126/kaijibot
git fetch upstream
git merge upstream/main
```

Core code (`src/`) is fully compatible with upstream. The cognitive layer
(`src/cognitive/`) is unique to this fork and lives in separate files, so merge
conflicts should be rare.

---

## Troubleshooting

<AccordionGroup>
  <Accordion title="Node.js version too old">
    KaijiBot requires Node.js >= 22. Check your version:

    ```bash
    node -v
    ```

    Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to manage Node versions.

  </Accordion>

  <Accordion title="pnpm not found">
    Install pnpm globally:

    ```bash
    npm install -g pnpm
    # or
    corepack enable && corepack prepare pnpm@latest --activate
    ```

  </Accordion>

  <Accordion title="Build fails with TypeScript errors">
    Run type checking separately to see errors:

    ```bash
    pnpm tsgo
    ```

    Ensure all dependencies installed correctly:

    ```bash
    rm -rf node_modules
    pnpm install
    ```

  </Accordion>

  <Accordion title="Feishu bot not responding">
    - Verify `channels.feishu.appId` and `channels.feishu.appSecret` are set
    - Check that the gateway is running: `curl http://localhost:18789/health`
    - Ensure the Feishu app event subscription URL points to your gateway
  </Accordion>

  <Accordion title="Docker container exits immediately">
    Check logs:

    ```bash
    docker compose logs kaijibot-gateway
    ```

    Common cause: missing `ZAI_API_KEY` or Feishu credentials.

  </Accordion>
</AccordionGroup>
