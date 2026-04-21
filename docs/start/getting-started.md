---
summary: "Get KaijiBot installed and run your first chat in minutes."
read_when:
  - First time setup from zero
  - You want the fastest path to a working chat
title: "Getting Started"
---

# Getting Started

Build KaijiBot from source, run onboarding, and start chatting in about 5 minutes. By the end you will have a running Gateway, configured auth, and a working chat session.

## What you need

- **Node.js >= 22** -- Node 24 recommended
- **pnpm** -- `corepack enable` or `npm install -g pnpm`
- **An API key** from a model provider -- 国内用户推荐 Z.AI（智谱 GLM）、DeepSeek、通义千问（Qwen）、Kimi（Moonshot），onboarding 向导会引导你完成配置

<Tip>
Check your Node version with `node --version`.
**Windows users:** both native Windows and WSL2 are supported. WSL2 is more stable and recommended for the full experience. See [Windows](/platforms/windows). Need to install Node? See [Node setup](/install/node).
</Tip>

## Quick setup

<Steps>
  <Step title="Clone and build">
    ```bash
    git clone https://gitee.com/kaiji1126/kaijibot.git
    cd kaijibot
    pnpm install
    pnpm build
    ```

    <Note>
    国内镜像加速：`pnpm install --registry https://registry.npmmirror.com`
    </Note>

  </Step>
  <Step title="Run onboarding">
    ```bash
    pnpm kaijibot onboard
    ```

    The wizard walks you through choosing a model provider, setting an API key, and configuring the Gateway. It takes about 2 minutes.

    <Tip>
    KaijiBot 支持 40+ 个 LLM 提供商。国内用户推荐优先选择：
    - **Z.AI（智谱 GLM）** -- 默认选项，国内访问最快
    - **DeepSeek** -- 性价比极高
    - **通义千问（Qwen）** -- 阿里云，中文能力强
    - **Kimi（Moonshot）** -- 长上下文 200K
    </Tip>

    See [Onboarding (CLI)](/start/wizard) for the full reference.

  </Step>
  <Step title="Start the Gateway">
    ```bash
    pnpm kaijibot gateway --port 18789
    ```

    You should see the Gateway listening on port 18789.

  </Step>
  <Step title="Send your first message">
    Type a message in the Control UI chat and you should get an AI reply.

    Want to chat from Feishu instead? See the [Feishu channel guide](/channels/feishu) -- you just need an App ID and App Secret from [open.feishu.cn](https://open.feishu.cn/).

  </Step>
</Steps>

## Docker alternative

```bash
git clone https://gitee.com/kaiji1126/kaijibot.git
cd kaijibot
docker compose up -d
```

See [Docker](/install/docker) for configuration details.

## What to do next

<Columns>
  <Card title="Connect Feishu" href="/channels/feishu" icon="message-square">
    KaijiBot's primary messaging channel. Create a Feishu app, configure App ID and App Secret, and chat directly in Feishu.
  </Card>
  <Card title="Pairing and safety" href="/channels/pairing" icon="shield">
    Control who can message your agent.
  </Card>
  <Card title="Configure the Gateway" href="/gateway/configuration" icon="settings">
    Models, tools, sandbox, and advanced settings.
  </Card>
  <Card title="Browse tools" href="/tools" icon="wrench">
    Browser, exec, web search, skills, and plugins.
  </Card>
</Columns>

<Accordion title="Advanced: environment variables">
  If you run KaijiBot as a service account or want custom paths:

  - `KAIJIBOT_HOME` -- home directory for internal path resolution
  - `KAIJIBOT_STATE_DIR` -- override the state directory
  - `KAIJIBOT_CONFIG_PATH` -- override the config file path

  Full reference: [Environment variables](/help/environment).
</Accordion>
