---
summary: "End-to-end guide for running KaijiBot as a personal assistant with Feishu"
read_when:
  - Onboarding a new assistant instance
  - Reviewing safety/permission implications
title: "Personal Assistant Setup"
---

# Building a personal assistant with KaijiBot

KaijiBot is a self-hosted proactive AI assistant that connects to Feishu (飞书) via WebSocket long-connection. This guide covers the "personal assistant" setup: a Feishu bot that learns who you are, generates cross-domain insights, and initiates conversations when it has something relevant to share.

## ⚠️ Safety first

You're putting an agent in a position to:

- run commands on your machine (depending on your tool policy)
- read/write files in your workspace
- send messages back out via Feishu

Start conservative:

- Always set `channels.feishu.appId` and `channels.feishu.appSecret` from your Feishu bot app.
- Heartbeats default to every 30 minutes. Disable until you trust the setup by setting `agents.defaults.heartbeat.every: "0m"`.
- Cognitive proactive insights can be disabled with `cognitive.proactive.enabled: false`.

## Prerequisites

- KaijiBot installed and onboarded — see [Getting Started](/start/getting-started) if you haven't done this yet
- A Feishu bot app (create one at [Feishu Open Platform](https://open.feishu.cn/))
- An API key from any supported LLM provider (Z.AI recommended)

## 5-minute quick start

1. Configure Feishu channel:

```bash
kaijibot config set channels.feishu.appId "your-app-id"
kaijibot config set channels.feishu.appSecret "your-app-secret"
```

2. Set your LLM API key:

```bash
export ZAI_API_KEY="your-api-key"
```

3. Start the Gateway (leave it running):

```bash
kaijibot gateway --port 18789
```

Now open Feishu, find your bot, and send a message. KaijiBot will start building your cognitive persona automatically — after a few conversations it begins proactive outreach with tailored insights.

## Give the agent a workspace (AGENTS)

KaijiBot reads operating instructions and "memory" from its workspace directory.

By default, KaijiBot uses `~/.kaijibot/workspace` as the agent workspace, and will create it (plus starter `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`) automatically on setup/first agent run.

Tip: treat this folder like KaijiBot's "memory" and make it a git repo (ideally private) so your `AGENTS.md` + memory files are backed up. If git is installed, brand-new workspaces are auto-initialized.

```bash
kaijibot setup
```

Full workspace layout + backup guide: [Agent workspace](/concepts/agent-workspace)
Memory workflow: [Memory](/concepts/memory)

## The config that turns it into "an assistant"

KaijiBot defaults to a good assistant setup, but you'll usually want to tune:

- persona/instructions in [`SOUL.md`](/concepts/soul)
- thinking defaults (if desired)
- heartbeats (once you trust it)
- cognitive proactive timing

Example:

```json5
{
  logging: { level: "info" },
  agent: {
    model: "zai/glm-5-turbo",
    workspace: "~/.kaijibot/workspace",
    // Start with 0; enable later.
    heartbeat: { every: "0m" },
  },
  channels: {
    feishu: {
      appId: "cli_xxxx",
      appSecret: "xxxx",
    },
  },
  cognitive: {
    enabled: true,
    proactive: {
      enabled: true,
      minIntervalHours: 4,
      activeHours: { start: "09:00", end: "22:00" },
    },
  },
  session: {
    scope: "per-sender",
    resetTriggers: ["/new", "/reset"],
    reset: {
      mode: "daily",
      atHour: 4,
      idleMinutes: 10080,
    },
  },
}
```

## Sessions and memory

- Session files: `~/.kaijibot/agents/<agentId>/sessions/{{SessionId}}.jsonl`
- `/new` or `/reset` starts a fresh session for that chat (configurable via `resetTriggers`).
- `/compact [instructions]` compacts the session context and reports the remaining context budget.

## Cognitive system

The cognitive layer runs alongside the agent loop. Key configuration:

```json5
{
  cognitive: {
    enabled: true,              // master switch
    proactive: {
      enabled: true,            // enable proactive insights
      minIntervalHours: 4,      // minimum hours between proactive messages
      activeHours: {
        start: "09:00",         // won't message outside these hours
        end: "22:00",
        timezone: "Asia/Shanghai",
      },
    },
  },
}
```

Persona data is stored at `~/.kaijibot/cognitive/persona/{agentId}/{userId}.json`. The system learns from every conversation turn and adapts its behavior over time. See [Cognitive Overview](/concepts/cognitive-overview) for the full architecture.

## Heartbeats (proactive mode)

By default, KaijiBot runs a heartbeat every 30 minutes with the prompt:
`Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.`
Set `agents.defaults.heartbeat.every: "0m"` to disable.

## Media in and out

Inbound attachments (images/audio/docs) can be surfaced to your command via templates:

- `{{MediaPath}}` (local temp file path)
- `{{MediaUrl}}` (pseudo-URL)
- `{{Transcript}}` (if audio transcription is enabled)

Outbound attachments from the agent: include `MEDIA:<path-or-url>` on its own line (no spaces). Example:

```
Here's the screenshot.
MEDIA:https://example.com/screenshot.png
```

KaijiBot extracts these and sends them as media alongside the text.

## Operations checklist

```bash
kaijibot status          # local status (creds, sessions, queued events)
kaijibot status --all    # full diagnosis (read-only, pasteable)
kaijibot status --deep   # asks the gateway for a live health probe
kaijibot health --json   # gateway health snapshot
```

Logs live under `/tmp/kaijibot/` (default: `kaijibot-YYYY-MM-DD.log`).

## Next steps

- Cognitive architecture: [Cognitive Overview](/concepts/cognitive-overview)
- Gateway ops: [Gateway Architecture](/concepts/architecture)
- Cron + wakeups: [Cron jobs](/automation/cron-jobs)
- Security: [Security](/gateway/security)
