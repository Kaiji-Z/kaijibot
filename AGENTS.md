# KaijiBot Simplify — Repository Guidelines

This is a simplified fork of [OpenClaw](https://github.com/openclaw/openclaw), enhanced with a **proactive cognitive AI layer**. Targeting Chinese users with Feishu + Z.AI (智谱 GLM). The upstream AGENTS.md has been adapted; only guidance relevant to this fork is kept.

- Repo: fork of `https://github.com/openclaw/openclaw`, upstream synced from `https://gitee.com/kaiji1126/kaijibot`
- In chat replies, file references must be repo-root relative only (e.g. `src/cli/index.ts:80`); never absolute paths or `~/...`.

## Project Structure

- **`src/`** — core engine: CLI (`src/cli`), commands (`src/commands`), gateway (`src/gateway`), agents (`src/agents`), config (`src/config`), plugin system (`src/plugins`, `src/plugin-sdk`), channels (`src/channels`), media pipeline (`src/media`), **cognitive layer (`src/cognitive`)**
- **`src/cognitive/`** — KaijiBot's proactive AI system (unique to this fork, not in upstream OpenClaw):
  - `persona/` — per-user cognitive model (identity, domains, interests, trust), dual extraction (rule-based + LLM), persistence at `~/.kaijibot/cognitive/persona/`
  - `insight/` — proactive insight generation (cross-domain, pending questions, domain depth), cross-domain mapper, serendipity scorer, verification pipeline
  - `scheduler/` — proactive timing (PRISM cost-sensitive gate, SIRI search-identify-resolve loop, timer/persona-change/info-scan event sources)
  - `feedback/` — feedback collection (explicit + implicit), Thompson Sampling preference learner, trust/rapport calculator (SARA framework)
  - `mode-router.ts` — classifies turns into task/insight/hybrid/proactive modes (Chinese + English pattern matching)
  - `context-writer.ts` — builds cognitive mode prompt sections for system prompt injection
- **`extensions/`** — 21 bundled plugins. The only messaging channel is **feishu**; the primary LLM provider is **zai**. Also includes: openai, ollama, lmstudio, github-copilot, exa, tavily, browser, memory-core, memory-lancedb, memory-wiki, speech-core, talk-voice, media-understanding-core, image-generation-core, diffs, llm-task, device-pair, webhooks, shared
- **`packages/`** — shared packages: plugin-sdk, plugin-package-contract, memory-host-sdk
- **`skills/`** — 21 skills (github, gh-issues, weather, summarize, coding-agent, mcporter, skill-creator, session-logs, healthcheck, notion, obsidian, canvas, nano-pdf, taskflow, taskflow-inbox-triage, clawhub, video-frames, gifgrep, node-connect, blogwatcher, sherpa-onnx-tts)
- **`ui/`** — web control UI
- **`docs/`** — documentation
- Tests: colocated `*.test.ts`; e2e: `*.e2e.test.ts`

## Build, Test, and Development Commands

- Runtime baseline: **Node 22+** (Node 24 recommended). Also supports Bun for TypeScript execution.
- Install deps: `pnpm install`
- If deps are missing (`node_modules` missing, `vitest not found`), run `pnpm install` once, then rerun the command.
- Build: `pnpm build` (tsdown)
- TypeScript check: `pnpm tsgo`
- Lint + typecheck: `pnpm check` (runs tsgo + oxlint + boundary checks)
- Format check: `pnpm format` (oxfmt --check)
- Format fix: `pnpm format:fix` (oxfmt --write)
- Tests: `pnpm test` (vitest); coverage: `pnpm test:coverage`
- Scoped test: `pnpm test <path-or-filter>` (e.g. `pnpm test src/cognitive/persona/store.test.ts`)
- Run CLI in dev: `pnpm kaijibot ...` or `pnpm dev`
- Live tests (real keys): `KAIJIBOT_LIVE_TEST=1 pnpm test:live` (KaijiBot-only) or `LIVE=1 pnpm test:live`
- Pre-commit hooks: `prek install`. The hook runs `pnpm check`. Use `FAST_COMMIT=1` to skip format+check in the hook.
- Prefer Bun for script execution: `bun <file.ts>` / `bunx <tool>`.

## Docker

- `docker-compose.yml` runs the kaijibot-gateway service
- Default ports: 18789 (gateway), 18790 (bridge)
- Build: `docker build .`
- Config via env: `ZAI_API_KEY`, `KAIJIBOT_GATEWAY_TOKEN`, `KAIJIBOT_GATEWAY_PORT`, `KAIJIBOT_GATEWAY_BIND`
- Config dir mounted at `/home/node/.kaijibot`

## Architecture Boundaries

- **Cognitive layer** (`src/cognitive/`) is a self-contained module. It can be disabled via `cognitive.enabled: false` for a pure OpenClaw experience. It does NOT import from extensions.
- **Plugin SDK** (`src/plugin-sdk/*`) is the public contract extensions can import. Extensions must NOT import `src/**` directly.
- **Extensions** (`extensions/*`) are bundled plugins following the same boundary as third-party plugins. See `extensions/AGENTS.md` for boundary rules.
- **Channel boundary**: `src/channels/**` is core implementation. New seams go in Plugin SDK.
- **Provider boundary**: provider plugins own provider-specific behavior. Core owns the generic inference loop.
- **Gateway protocol** (`src/gateway/protocol/*`): protocol changes are contract changes; prefer additive evolution.
- Core must stay extension-agnostic. No hardcoded extension/provider/channel IDs in core.
- Extension code imports from `kaijibot/plugin-sdk/*` plus local barrels (`./api.ts`, `./runtime-api.ts`).
- No relative imports that escape the current extension package root.
- See progressive disclosure in: `extensions/AGENTS.md`, `src/plugin-sdk/AGENTS.md`, `src/channels/AGENTS.md`, `src/plugins/AGENTS.md`, `src/gateway/protocol/AGENTS.md`

## Cognitive System Architecture

The proactive AI layer follows this pipeline:

```
Event Sources (timer / persona_change / info_scan)
  → ProactiveScheduler.processEvent(userId, event)
    → computeGradedGate() [pNeed × pAccept vs cost threshold]
      → search() [scan opportunities: cross-domain, pending Qs, domain depth]
        → identify() [pick best by pAct]
          → resolve() [generate insight candidate via LLM or template]
            → onInsightReady callback → findSessionKeyForUserId → enqueueSystemEvent → requestHeartbeatNow
              → heartbeat-runner → agent turn → deliverOutboundPayloads → user receives message
```

Key integration points:
- `src/gateway/server.impl.ts` (cognitive section) — bootstraps ProactiveScheduler, wires event sources and delivery
- `src/gateway/cognitive-delivery.ts` — resolves userId to session key for delivery routing
- `src/infra/heartbeat-reason.ts` — classifies `"cognitive-insight"` as `"wake"` kind to bypass HEARTBEAT.md gate
- `src/infra/heartbeat-runner.ts` — `hasCognitiveEvents` check for `shouldInspectPendingEvents`
- `src/agents/tools/cognitive-feedback-tool.ts` — agent tool for collecting explicit feedback
- `src/agents/system-prompt.ts` — injects cognitive mode prompt into agent system prompt

## Coding Style

- TypeScript (ESM), strict typing. Avoid `any`.
- Formatting/linting: **Oxlint** and **Oxfmt** (not ESLint/Prettier).
- Never add `@ts-nocheck`. Fix root causes; only suppress when the rule cannot express correct intent, with an explanatory comment.
- `typescript/no-explicit-any` is enforced as error in Oxlint.
- Prefer `zod` or existing schema helpers at external boundaries (config, webhooks, CLI output, persisted JSON, third-party API responses).
- Prefer discriminated unions when parameter shape changes behavior.
- Prefer `Result<T, E>`-style outcomes and closed error-code unions for runtime decisions.
- Avoid `?? 0`, empty-string, empty-object, or magic-string sentinels.
- Dynamic import guardrail: do not mix `await import("x")` and static `import ... from "x"` for the same module. Use dedicated `*.runtime.ts` boundaries for lazy loading.
- Extension SDK self-import: inside an extension, do not import via `kaijibot/plugin-sdk/<extension>`. Use local barrels (`./api.ts`).
- Never share class behavior via prototype mutation. Use explicit inheritance/composition.
- Keep files under ~700 LOC (guideline). Extract helpers instead of "V2" copies.
- Use `createDefaultDeps` pattern for dependency injection.
- Written English: American spelling in code, comments, docs, UI strings.
- Naming: **KaijiBot** for product headings; `kaijibot` for CLI/package/paths/config keys.
- Nomenclature: use "plugin" / "plugins" in docs, UI, changelogs.

## Testing Guidelines

- Framework: Vitest with V8 coverage thresholds (70%).
- Colocated `*.test.ts`; e2e in `*.e2e.test.ts`.
- Run `pnpm test` before pushing when touching logic.
- Write tests to clean up timers, env, globals, mocks, sockets, temp dirs, module state.
- Test performance: avoid `vi.resetModules()` + `await import(...)` in `beforeEach` for heavy modules. Use `beforeAll` + mock resets.
- Prefer per-instance stubs over prototype mutation in tests.
- For scoped debugging: `pnpm test <path-or-filter>` (not raw `pnpm vitest run ...`).
- `KAIJIBOT_VITEST_MAX_WORKERS=1 pnpm test` for memory-constrained runs.
- Do not modify baseline, snapshot, or expected-failure files to silence failing checks without explicit approval.
- Known gap: `vitest.infra.config.ts` and `vitest.gateway.config.ts` exist but some test paths in `src/infra/` and `src/gateway/` are not fully configured; use `pnpm tsgo` for type verification when `pnpm test` cannot resolve a path.

## Commit Guidelines

- Create commits with `scripts/committer "<msg>" <file...>` to keep staging scoped.
- Concise, action-oriented commit messages (e.g. `CLI: add verbose flag to send`).
- Group related changes; avoid bundling unrelated refactors.

## Prompt Cache Stability

- Any code assembling model/tool payloads from maps, sets, registries, plugin lists, or filesystem reads must make ordering deterministic before building the request.
- Do not rewrite older transcript/history bytes on every turn unless intentionally invalidating the cached prefix.
- For cache-sensitive changes, require a regression test proving turn-to-turn prefix stability.

## Config and Environment

- Config lives in `~/.kaijibot/kaijibot.json`. CLI: `kaijibot config set <key> <value>`.
- Default model: `zai/glm-5-turbo`. Set via `kaijibot config set agent.model "zai/glm-5-turbo"`.
- Feishu channel config: `channels.feishu.appId`, `channels.feishu.appSecret`.
- Cognitive config: `cognitive.enabled`, `cognitive.proactive.enabled`, `cognitive.proactive.minIntervalHours`, `cognitive.proactive.activeHours`
- Web search: `EXA_API_KEY` / `TAVILY_API_KEY` env vars or scoped credentials in config
- Env-source precedence: process env → `./.env` → `~/.kaijibot/.env` → `kaijibot.json` env block.
- Credentials stored at `~/.kaijibot/credentials/`.
- Persona data stored at `~/.kaijibot/cognitive/persona/{userId}.json`.
- Never commit real phone numbers, API keys, or live config values.

## Syncing Upstream

```bash
git remote add upstream https://gitee.com/kaiji1126/kaijibot
git fetch upstream
git merge upstream/main
```

Core code (`src/`) is fully compatible; merge conflicts should be rare. The cognitive layer (`src/cognitive/`) is unique to this fork and lives in separate files — it does not conflict with upstream merges.

## Collaboration / Safety Notes

- When working on a GitHub Issue or PR, print the full URL at the end of the task.
- Respond with high-confidence answers only: verify in code; do not guess.
- Any dependency with `pnpm.patchedDependencies` must use an exact version (no `^`/`~`).
- Patching dependencies requires explicit approval; do not do this by default.
- **Multi-agent safety:** do not create/apply/drop `git stash` entries unless explicitly requested. Do not switch branches or modify worktrees unless requested.
- **Multi-agent safety:** when you see unrecognized files, keep going; focus on your changes and commit only those.
- Lint/format churn: if staged+unstaged diffs are formatting-only, auto-resolve without asking.
- Release guardrails: do not change version numbers without operator's explicit consent.
- Never send streaming/partial replies to external messaging surfaces; only final replies.
- Tool schema guardrails: avoid `Type.Union` / `anyOf` / `oneOf` / `allOf` in tool input schemas. Use `stringEnum` / `optionalStringEnum`. Avoid raw `format` property names.
