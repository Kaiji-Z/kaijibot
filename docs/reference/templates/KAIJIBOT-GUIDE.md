---
title: "KAIJIBOT-GUIDE.md Template"
summary: "KaijiBot config behavioral rules and env var mapping (auto-injected into every conversation)"
read_when:
  - User asks about configuration
  - Agent needs config guidance
---

# KaijiBot Config Agent Rules

## Config Access Rules

- User asks about config → use `config.schema.lookup` with the dot-path. **Never guess field names or types.**
- Read value → `config.get` action. Change value → `config.patch` action (**ask user first**).
- **Never modify configuration without explicit user consent.**
- The schema returns type, description, default, range, enum values, and sensitivity flags for every path including plugin/channel schemas.

## Key Config Paths (quick reference)

| Want to...       | Path / Action                                          |
| ---------------- | ------------------------------------------------------ |
| Switch model     | `kaijibot models set "zai/glm-5-turbo"`                |
| Cognitive toggle | `cognitive.enabled` / `cognitive.proactive.enabled`    |
| Push frequency   | `cognitive.proactive.minIntervalHours`                 |
| Active hours     | `cognitive.proactive.activeHours.{start,end,timezone}` |
| Memory backend   | `memory.backend` ("builtin" or "qmd")                  |
| Timezone         | `agents.defaults.userTimezone`                         |

> For any path not listed above, use `config.schema.lookup` to inspect types, defaults, and descriptions.

## Environment Variables

| Variable                 | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `ZAI_API_KEY`            | Z.AI (智谱 GLM) API key — default LLM provider  |
| `EXA_API_KEY`            | Exa search (insight web search)                |
| `TAVILY_API_KEY`         | Tavily search (insight web search)             |
| `KAIJIBOT_GATEWAY_PORT`  | Gateway port (default: 18789)                  |
| `KAIJIBOT_GATEWAY_TOKEN` | Gateway auth token                             |
| `KAIJIBOT_STATE_DIR`     | Data directory override (default: ~/.kaijibot) |
| `KAIJIBOT_CONFIG_PATH`   | Config file path override (default: ~/.kaijibot/kaijibot.json) |

## Memory System

- MEMORY.md: 8KB budget, 2 inline sections — `⚡ Core Memory` (assertive knowledge) + `🔥 Active Context` (time-sensitive work) + topic pointers
- Consolidation: daily at 3 AM, scans 7-day transcripts, routes to cognitive stores and inline sections
- `memory.backend`: `"builtin"` (default) or `"qmd"`; `memory.citations`: `"auto"` / `"on"` / `"off"`

## Feishu Setup (one-time)

1. Create enterprise app on open.feishu.cn → get App ID + Secret
2. `kaijibot config set channels.feishu.appId "cli_xxx"` + appSecret
3. Enable WebSocket event subscription; grant messaging/contacts/calendar permissions

## Troubleshooting

| Problem                  | First check                                                              |
| ------------------------ | ------------------------------------------------------------------------ |
| Feishu not receiving     | Verify appId/appSecret + WebSocket events enabled                        |
| Model call failures      | Check `ZAI_API_KEY` env var, `kaijibot models status`                    |
| No proactive insights    | `cognitive.enabled` + `proactive.enabled` must be true; ≥5 rounds needed |
| Disturbed at night       | Set `proactive.activeHours.start` and `.end`                             |
| Push too frequent/sparse | Adjust `proactive.minIntervalHours` (default 0.5)                        |
| Repetitive content       | Set `insight.engine` to `"unified"` (default)                            |
