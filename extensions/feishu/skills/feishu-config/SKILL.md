---
name: feishu-config
description: |
  Feishu channel configuration reference. Activate when user asks about feishu setup, channel config, message rendering, streaming cards, group policy, tool toggles, or any channels.feishu.* settings.
---

# Feishu Channel Configuration Reference

All config lives under `channels.feishu` in `~/.kaijibot/kaijibot.json`.

Set via CLI: `kaijibot config set channels.feishu.<key> <value>`

## Quick Reference

| Category      | Key                                      | Default            | Description                                                                  |
| ------------- | ---------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| Connection    | `domain`                                 | `"feishu"`         | `"feishu"` / `"lark"` / custom URL                                           |
| Connection    | `connectionMode`                         | `"websocket"`      | `"websocket"` or `"webhook"`                                                 |
| Connection    | `webhookPath`                            | `"/feishu/events"` | HTTP path for webhook events                                                 |
| Connection    | `webhookHost`                            | —                  | External hostname for webhook URL                                            |
| Connection    | `webhookPort`                            | —                  | External port for webhook URL                                                |
| Credentials   | `appId`                                  | —                  | Feishu app ID (or env `FEISHU_APP_ID`)                                       |
| Credentials   | `appSecret`                              | —                  | Feishu app secret (or env `FEISHU_APP_SECRET`)                               |
| Credentials   | `encryptKey`                             | —                  | Event encryption key (or env `FEISHU_ENCRYPT_KEY`)                           |
| Credentials   | `verificationToken`                      | —                  | Webhook verification token (or env `FEISHU_VERIFICATION_TOKEN`)              |
| Rendering     | `renderMode`                             | `"auto"`           | `"auto"` (detect markdown) / `"raw"` (plain text) / `"card"` (always card)   |
| Rendering     | `streaming`                              | —                  | `true`/`false`. Enable streaming card replies (Card Kit incremental display) |
| Rendering     | `markdown.mode`                          | —                  | `"native"` / `"escape"` / `"strip"`                                          |
| Rendering     | `markdown.tableMode`                     | —                  | `"native"` / `"ascii"` / `"simple"`                                          |
| DM            | `dmPolicy`                               | `"open"`           | `"open"` / `"pairing"` / `"allowlist"`                                       |
| DM            | `allowFrom`                              | `["*"]`            | Open_id/user_id/union_id allowlist. `["*"]` = all                            |
| DM            | `dmHistoryLimit`                         | —                  | Max DM messages to load per session                                          |
| DM            | `dms`                                    | —                  | Per-user overrides: `{ "ou_xxx": { enabled, systemPrompt } }`                |
| Group         | `groupPolicy`                            | `"allowlist"`      | `"open"` / `"allowlist"` / `"disabled"`                                      |
| Group         | `groupAllowFrom`                         | —                  | Group chat_id allowlist                                                      |
| Group         | `groupSenderAllowFrom`                   | —                  | Sender open_id allowlist for groups                                          |
| Group         | `requireMention`                         | — (runtime)        | Bot only responds when @mentioned in groups                                  |
| Group         | `groups`                                 | —                  | Per-group overrides (see Group Config below)                                 |
| Group         | `groupSessionScope`                      | —                  | Session routing (see Session Scope below)                                    |
| Group         | `replyInThread`                          | `"disabled"`       | `"enabled"` = bot replies create topic threads                               |
| Session       | `historyLimit`                           | —                  | Max messages to load per session                                             |
| Session       | `textChunkLimit`                         | —                  | Max chars per message chunk                                                  |
| Session       | `chunkMode`                              | —                  | `"length"` / `"newline"`                                                     |
| Streaming     | `blockStreamingCoalesce.enabled`         | —                  | Coalesce rapid streaming updates                                             |
| Streaming     | `blockStreamingCoalesce.minDelayMs`      | —                  | Min coalesce delay                                                           |
| Streaming     | `blockStreamingCoalesce.maxDelayMs`      | —                  | Max coalesce delay                                                           |
| Tools         | `tools.doc`                              | `true`             | Document read/write tools                                                    |
| Tools         | `tools.chat`                             | `true`             | Chat info + member query tools                                               |
| Tools         | `tools.wiki`                             | `true`             | Knowledge base tools (requires doc)                                          |
| Tools         | `tools.drive`                            | `true`             | Cloud storage tools                                                          |
| Tools         | `tools.perm`                             | `false`            | Permission management (sensitive, off by default)                            |
| Tools         | `tools.scopes`                           | `true`             | App scopes diagnostic                                                        |
| Tools         | `tools.vc`                               | `true`             | Video conference tools                                                       |
| Tools         | `tools.task`                             | `true`             | Task management tools                                                        |
| Tools         | `tools.bitable`                          | `true`             | Bitable (Base) tools                                                         |
| Misc          | `typingIndicator`                        | `true`             | Show "typing..." indicator                                                   |
| Misc          | `resolveSenderNames`                     | `true`             | Resolve open_id to display names                                             |
| Misc          | `actions.reactions`                      | —                  | Enable emoji reaction actions                                                |
| Misc          | `reactionNotifications`                  | `"own"`            | `"off"` / `"own"` / `"all"`                                                  |
| Misc          | `mediaMaxMb`                             | —                  | Max media file size (MB)                                                     |
| Misc          | `httpTimeoutMs`                          | —                  | API timeout (max 300000)                                                     |
| Misc          | `configWrites`                           | —                  | Allow config changes via chat                                                |
| Misc          | `capabilities`                           | —                  | Capability flags                                                             |
| Heartbeat     | `heartbeat.visibility`                   | —                  | `"visible"` / `"hidden"`                                                     |
| Heartbeat     | `heartbeat.intervalMs`                   | —                  | Heartbeat interval                                                           |
| Dynamic Agent | `dynamicAgentCreation.enabled`           | —                  | Create agent per unique DM user                                              |
| Dynamic Agent | `dynamicAgentCreation.workspaceTemplate` | —                  | Template path for agent workspace                                            |
| Dynamic Agent | `dynamicAgentCreation.agentDirTemplate`  | —                  | Template path for agent dir                                                  |
| Dynamic Agent | `dynamicAgentCreation.maxAgents`         | —                  | Max dynamic agents                                                           |

## Group Config (per-group overrides)

Under `channels.feishu.groups.<chat_id>`:

```json
{
  "channels": {
    "feishu": {
      "groups": {
        "oc_xxx": {
          "enabled": true,
          "requireMention": false,
          "systemPrompt": "You are a helpful assistant for this group.",
          "allowFrom": ["ou_xxx"],
          "tools": { "allow": ["feishu_doc"], "deny": ["feishu_drive"] },
          "skills": ["weather"],
          "groupSessionScope": "group_sender",
          "replyInThread": "enabled"
        }
      }
    }
  }
}
```

## Session Scope Options

`groupSessionScope` controls how group messages map to sessions:

| Value                  | Behavior                                                |
| ---------------------- | ------------------------------------------------------- |
| `"group"`              | One session per group chat (default)                    |
| `"group_sender"`       | One session per (group + sender)                        |
| `"group_topic"`        | One session per group topic thread, falls back to group |
| `"group_topic_sender"` | One session per (group + topic + sender)                |

`topicSessionMode` (deprecated, use `groupSessionScope` instead): `"disabled"` or `"enabled"`.

## Multi-Account Setup

```json
{
  "channels": {
    "feishu": {
      "defaultAccount": "work",
      "accounts": {
        "work": {
          "appId": "cli_xxx",
          "appSecret": "xxx",
          "domain": "feishu"
        },
        "personal": {
          "appId": "cli_yyy",
          "appSecret": "yyy",
          "domain": "feishu"
        }
      }
    }
  }
}
```

Per-account config inherits all shared options from top-level. Account-level values override top-level defaults.

## Rendering Modes

| `renderMode` | Behavior                                                                       |
| ------------ | ------------------------------------------------------------------------------ |
| `"auto"`     | Detect markdown in response — use card if markdown found, plain text otherwise |
| `"raw"`      | Always send as plain text (no card formatting)                                 |
| `"card"`     | Always use Feishu interactive card                                             |

When `streaming: true` is set alongside card rendering, the bot uses Card Kit streaming API for incremental text display with a "Thinking..." placeholder. This provides a smoother UX for long responses.

## Webhook Mode Requirements

When `connectionMode: "webhook"`:

- `verificationToken` is **required**
- `encryptKey` is **required**
- `webhookHost` must be set to your public domain
- `webhookPort` defaults to the gateway port if not set

## Common Config Examples

### Disable streaming cards

```bash
kaijibot config set channels.feishu.streaming false
```

### Always use plain text replies

```bash
kaijibot config set channels.feishu.renderMode raw
```

### Open group access (all groups, no mention required)

```bash
kaijibot config set channels.feishu.groupPolicy open
kaijibot config set channels.feishu.requireMention false
```

### Disable sensitive tools

```bash
kaijibot config set channels.feishu.tools.perm false
```

### Per-group custom system prompt

```bash
kaijibot config set channels.feishu.groups.oc_xxx.systemPrompt "You are a code review assistant."
```

### Change markdown table rendering

```bash
kaijibot config set channels.feishu.markdown.tableMode ascii
```

## Environment Variables

Credentials can be set via environment instead of config:

| Env Var                     | Config Key                          |
| --------------------------- | ----------------------------------- |
| `FEISHU_APP_ID`             | `channels.feishu.appId`             |
| `FEISHU_APP_SECRET`         | `channels.feishu.appSecret`         |
| `FEISHU_VERIFICATION_TOKEN` | `channels.feishu.verificationToken` |
| `FEISHU_ENCRYPT_KEY`        | `channels.feishu.encryptKey`        |

Precedence: process env > `./.env` > `~/.kaijibot/.env` > `kaijibot.json` env block > config values.

## Differences from Official openclaw-lark Plugin

KaijiBot's feishu extension is based on the upstream openclaw-lark plugin with selective reliability improvements. Most config is identical, but note these differences:

| Official (openclaw-lark)                          | KaijiBot                           | Notes                                                                                                                                 |
| ------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `openclaw config set`                             | `kaijibot config set`              | CLI command prefix differs                                                                                                            |
| `threadSession: true/false`                       | `groupSessionScope: "group_topic"` | KaijiBot uses granular 4-value enum instead of boolean. `"enabled"` in deprecated `topicSessionMode` ≈ official `threadSession: true` |
| `footer.elapsed`, `footer.status`                 | Not available                      | Footer metrics not in KaijiBot config schema                                                                                          |
| `/feishu start`, `/feishu doctor`, `/feishu auth` | Not available                      | Official plugin slash commands not present                                                                                            |

### Streaming Card Reliability (KaijiBot-specific)

KaijiBot has additional reliability improvements over upstream:

- **CardPhase state machine**: 7-phase lifecycle (creating → updating → stable → aborting → aborted → flushing → error) with validated transitions. Prevents race conditions in concurrent card updates.
- **FlushController**: Mutex-guarded flush with reflush support and configurable throttle. Ensures the final card content is always delivered even during aborts.
- **Card table limit degradation**: When a card exceeds Feishu's table limit, excess tables are automatically sanitized (columns reduced to key-value pairs) instead of failing with Error 230099.
- **UnavailableGuard**: Caches message unavailability errors (code 230099/230005) with TTL, preventing repeated API calls to failed message targets.

These are transparent infrastructure improvements — no additional config needed. They activate automatically based on `streaming: true` and `renderMode: "card"/"auto"`.
