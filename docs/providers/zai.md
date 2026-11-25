---
summary: "Use Z.AI (GLM models) with KaijiBot"
read_when:
  - You want Z.AI / GLM models in KaijiBot
  - You need a simple ZAI_API_KEY setup
title: "Z.AI"
---

# Z.AI

Z.AI is the API platform for **GLM** models. It provides REST APIs for GLM and uses API keys
for authentication. Create your API key in the Z.AI console. KaijiBot uses the `zai` provider
with a Z.AI API key.

## CLI setup

```bash
# Generic API-key setup with endpoint auto-detection
kaijibot onboard --auth-choice zai-api-key

# Coding Plan Global, recommended for Coding Plan users
kaijibot onboard --auth-choice zai-coding-global

# Coding Plan CN (China region), recommended for Coding Plan users
kaijibot onboard --auth-choice zai-coding-cn

# General API
kaijibot onboard --auth-choice zai-global

# General API CN (China region)
kaijibot onboard --auth-choice zai-cn
```

## Config snippet

```json5
{
  env: { ZAI_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "zai/glm-5.1" } } },
}
```

`zai-api-key` lets KaijiBot detect the matching Z.AI endpoint from the key and
apply the correct base URL automatically. Use the explicit regional choices when
you want to force a specific Coding Plan or general API surface.

## Bundled GLM catalog

KaijiBot currently seeds the bundled `zai` provider with:

- `glm-5.1`
- `glm-5`
- `glm-5-turbo`
- `glm-5v-turbo`
- `glm-4.7`
- `glm-4.7-flash`
- `glm-4.7-flashx`
- `glm-4.6`
- `glm-4.6v`
- `glm-4.5`
- `glm-4.5-air`
- `glm-4.5-flash`
- `glm-4.5v`

## Notes

- GLM models are available as `zai/<model>` (example: `zai/glm-5`).
- Default bundled model ref: `zai/glm-5.1`
- Unknown `glm-5*` ids still forward-resolve on the bundled provider path by
  synthesizing provider-owned metadata from the `glm-4.7` template when the id
  matches the current GLM-5 family shape.
- `tool_stream` is enabled by default for Z.AI tool-call streaming. Set
  `agents.defaults.models["zai/<model>"].params.tool_stream` to `false` to disable it.
- GLM-5.3 models (`glm-5.3`, `glm-5.3-flash`, `glm-5.3-flashx`) always think. The thinking
  level chooses how hard: `off`, `minimal` and `low` send Z.AI's lowest `reasoning_effort`,
  `medium` sends its `high` effort, and `xhigh` sends `max`. Their default level is `high`,
  which sends no effort, so the model runs at Z.AI's default effort until you pick a level
  (`/think:<level>`, `agents.defaults.thinkingDefault`, or
  `agents.defaults.models["zai/<model>"].params.thinking`). Background single-turn calls run
  at the lowest effort on these models.
- See [/providers/glm](/providers/glm) for the model family overview.
- Z.AI uses Bearer auth with your API key.
