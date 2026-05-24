---
title: "KAIJIBOT-GUIDE.md Template"
summary: "KaijiBot configuration reference (auto-injected into every conversation)"
read_when:
  - User asks about configuration
  - Agent needs config guidance
---

# KaijiBot Configuration Guide

This file is auto-loaded into every conversation. Consult this guide first when a user asks about configuration.

## Quick Configuration

> **Config keys not listed here** → Use `kaijibot config schema` via CLI to view the full schema (types, defaults, ranges, descriptions).
> Inside the Agent, use the `gateway` tool's `config.schema.lookup` action to query a subtree by path. **If you can't find it, check the schema. Don't guess.**

| Action           | Command / Key                                                                           |
| ---------------- | --------------------------------------------------------------------------------------- |
| Switch model     | `kaijibot models set "zai/glm-5-turbo"`                                                 |
| Cognitive toggle | `cognitive.enabled` / `cognitive.proactive.enabled` (boolean)                           |
| Push frequency   | `cognitive.proactive.minIntervalHours` (number, default 0.5 hours)                      |
| Active hours     | `cognitive.proactive.activeHours.start` / `.end` / `.timezone` (unset = no restriction) |
| Web search       | Env vars `EXA_API_KEY` / `TAVILY_API_KEY`                                               |
| Feishu channel   | `channels.feishu.appId` / `channels.feishu.appSecret`                                   |
| API Key          | Env var `ZAI_API_KEY` or `models.providers.zai.apiKey`                                  |
| Timezone         | `agents.defaults.userTimezone` (e.g. "Asia/Shanghai")                                   |
| Memory           | `memory.backend` ("builtin" \| "qmd") / `memory.citations`                              |

## Cognitive System

### Master Toggle

- `cognitive.enabled` — master switch (default: true)
- `cognitive.proactive.enabled` — proactive push (default: true)

### Push Scheduling

- `cognitive.proactive.minIntervalHours` — minimum interval between pushes (default: 0.5, range: 0.5-168)
- `cognitive.proactive.activeHours` — push time window:
  - `start` — start time (e.g. `"09:00"`, unset = no restriction)
  - `end` — end time (e.g. `"22:00"`, unset = no restriction)
  - `timezone` — timezone (default: `"Asia/Shanghai"`)
- `cognitive.proactive.digestMode` — **reserved** (not yet implemented; all pushes are realtime regardless of this setting)

### Persona Extraction

- `cognitive.persona.autoExtract` — auto-extract user persona from conversations (default: true)
- `cognitive.persona.extractionModel` — model used for extraction (unset = use main model)
- `cognitive.persona.identityRefreshHours` — identity memory refresh interval (default: 24, range: 1-720)

### Insight Engine

- `cognitive.insight.engine` — engine mode `"knowledge"` / `"pattern"` / `"unified"` (default: `"unified"`)
  - `knowledge`: LLM generation + web search, with self-refine loop (critique→rewrite) and LLM verification
  - `pattern`: dialog fragment collection → clustering → behavioral insight generation
  - `unified`: single pipeline with 3-mode routing (default, recommended). Modes: pattern (50%), surprise (40%), extend (10%)
  - Legacy aliases: `"v1"` → `"knowledge"`, `"v2"` → `"pattern"`, `"dual"` → `"unified"`
- `cognitive.insight.patternModeRatio` — pattern mode ratio 0-1 in unified engine (default: 0.5)
- `cognitive.insight.verificationLevel` — fact verification strictness `"basic"` / `"strict"` / `"paranoid"` (default: `"basic"`)
- `cognitive.insight.inferenceModel` — model used for inference (unset = use main model)
- `cognitive.insight.outputLanguage` — output language (default: `"zh"`, auto-detected from persona)
- `cognitive.insight.sources.scanIntervalHours` — info scan interval (default: 6, range: 1-168)
- `cognitive.insight.sources.webSearchProvider` — web search provider
- `cognitive.insight.sources.explicitTopics` — list of explicitly tracked topics

### Skill Evolution

- `cognitive.evolution.enabled` — evolution engine toggle (default: true)
- `cognitive.evolution.clawhubEnabled` — ClawHub sharing (default: false)
- `cognitive.evolution.clawhubRegistry` — ClawHub registry URL

### Feedback

- `cognitive.proactive.enabled` — proactive insights toggle (default: true)
- `cognitive.proactive.minIntervalHours` — minimum interval between proactive messages (default: 0.5)
- `cognitive.proactive.activeHours.start` — active hours start (e.g. "08:00")
- `cognitive.proactive.activeHours.end` — active hours end (e.g. "22:00")
- `cognitive.proactive.activeHours.timezone` — timezone (default: system timezone)

## Models and Providers

- Main model: `agents.defaults.model` (default: `"zai/glm-5-turbo"`)
- Add a provider: `models.providers.<name>.apiKey` + `.baseUrl`
- Available providers: zai (Zhipu GLM), openai, ollama, lmstudio, anthropic, google, deepseek and 62+ extensions
- Aliases: set alias mappings from short names to full model IDs in `agents.defaults.models`
- Fallback models: `agents.defaults.model` can be set to `{ primary: "zai/glm-5-turbo", fallbacks: ["openai/gpt-4o"] }`
- Context window: 200K tokens by default

## Memory System

- `memory.backend` — storage backend:
  - `"builtin"` (default) — built-in file storage, works out of the box
  - `"qmd"` — external QMD tool, high-performance indexing
- `memory.citations` — `"auto"` | `"on"` | `"off"` — whether to annotate memory sources in replies
- Memory location: `<workspace>/memory/` (daily logs) + `MEMORY.md` (long-term highlights, 4KB budget)
- Dreaming system: disabled by default (`memory.dreaming.enabled: false`); when enabled, defaults to separate storage (does not pollute daily memory files), runs at 3 AM daily

## Plugins and Skills

- List installed skills: `kaijibot skills list`
- Install a skill: `kaijibot skills install <name>`
- Plugin management: `kaijibot plugins list` / `kaijibot plugins enable <name>`
- Skill marketplace: install third-party skills from ClawHub

## MCP Server Management

Use the `mcp_config` tool for programmatic MCP server management:

| Action  | Description                                                   |
| ------- | ------------------------------------------------------------- |
| `list`  | List all configured MCP servers                               |
| `show`  | View details of a single server                               |
| `set`   | Add or update a server (requires name and JSON config string) |
| `unset` | Remove a specified server                                     |

## Feishu Channel

1. Create a custom enterprise app on open.feishu.cn
2. Obtain the App ID and App Secret
3. `kaijibot config set channels.feishu.appId "cli_xxx"`
4. `kaijibot config set channels.feishu.appSecret "xxx"`
5. Enable WebSocket event subscription (no public callback URL needed)
6. Required permissions: messaging, contacts, calendar read/write

## Common Commands

| Command                              | Description                                                     |
| ------------------------------------ | --------------------------------------------------------------- |
| `kaijibot gateway run`               | Start the gateway                                               |
| `kaijibot gateway status`            | Gateway status + health check                                   |
| `kaijibot config get <path>`         | View a config value                                             |
| `kaijibot config set <path> <value>` | Set a config value                                              |
| `kaijibot config schema`             | View full schema (**preferred when a config key is not found**) |
| `kaijibot models list`               | List available models                                           |
| `kaijibot models set <model>`        | Switch model                                                    |
| `kaijibot plugins list`              | List plugins                                                    |
| `kaijibot skills list`               | List skills                                                     |
| `kaijibot status`                    | System status                                                   |

## Environment Variables

| Variable                 | Purpose                               |
| ------------------------ | ------------------------------------- |
| `ZAI_API_KEY`            | Zhipu GLM API key                     |
| `EXA_API_KEY`            | Exa semantic search                   |
| `TAVILY_API_KEY`         | Tavily AI search                      |
| `KAIJIBOT_GATEWAY_PORT`  | Gateway port (default: 18789)         |
| `KAIJIBOT_GATEWAY_TOKEN` | Gateway auth token                    |
| `KAIJIBOT_HOME`          | Data directory (default: ~/.kaijibot) |

## Agent Operating Rules

- User asks "how to configure X" -> check this guide first
- **Not found in this guide -> use the `gateway` tool to call `config.schema.lookup` action to query schema details (type, default, range, description). Do not guess.**
- Read current value -> `gateway` tool `config.get` action
- Modify config -> `gateway` tool `config.patch` action (ask the user for permission first!)
- **Never modify configuration without explicit user consent**

## Common Troubleshooting

| Problem                           | Troubleshooting                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Feishu not receiving messages     | Check that appId/appSecret are correct, confirm WebSocket event subscription is enabled                            |
| Model call failures               | Check that `ZAI_API_KEY` is set, use `kaijibot models status` to view the current model                            |
| Proactive insights not pushing    | Check that `cognitive.enabled` and `cognitive.proactive.enabled` are true; requires at least 5 conversation rounds |
| Disturbed at night                | Set `cognitive.proactive.activeHours.start` and `.end` (e.g. `"09:00"` - `"22:00"`)                                |
| Pushes too frequent or too sparse | Adjust `cognitive.proactive.minIntervalHours` (default 0.5 hours)                                                  |
| Repetitive push content           | Check that `cognitive.insight.engine` is set to `"unified"` (default) — pattern mode adds behavioral diversity              |
| Web search not working            | Check that `EXA_API_KEY` or `TAVILY_API_KEY` is set                                                                |
| Gateway fails to start            | Use `kaijibot gateway status` to check, verify the port is not occupied                                            |
