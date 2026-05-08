# KaijiBot — Repository Guidelines

KaijiBot is an independent project — a proactive cognitive AI assistant targeting Chinese users with Feishu + Z.AI (智谱 GLM). Originally forked from [OpenClaw](https://github.com/openclaw/openclaw), now developed independently with its own cognitive layer, architecture, and direction.

- Repo: independent project, originally forked from [OpenClaw](https://github.com/openclaw/openclaw)
  - Main (GitHub): `https://github.com/Kaiji-Z/kaijibot`
  - Backup (Gitee): `https://gitee.com/kaiji1126/kaijibot`
  - Upstream (GitHub): `https://github.com/openclaw/openclaw`
  - Upstream mirror (Gitee): `https://gitee.com/kaiji1126/openclaw` (manual mirror, squash history)
- In chat replies, file references must be repo-root relative only (e.g. `src/cli/index.ts:80`); never absolute paths or `~/...`.

## Project Structure

- **`src/`** — core engine: CLI (`src/cli`), commands (`src/commands`), gateway (`src/gateway`), agents (`src/agents`), config (`src/config`), plugin system (`src/plugins`, `src/plugin-sdk`), channels (`src/channels`), media pipeline (`src/media`), **cognitive layer (`src/cognitive`)**
- **`src/cognitive/`** — KaijiBot's proactive AI system (unique to this fork, not in upstream OpenClaw):
  - `persona/` — per-user cognitive model (identity, domains, interests, trust). LLM-driven extraction with structured `TypedInsight` (6 categories: domain_knowledge, behavioral_pattern, stated_preference, tool_config, contextual_fact, goal_or_aspiration). Dynamic domain discovery via LLM (no hardcoded keywords). Interest lifecycle tracking (emergent/stable/declining/dormant/revived). Category-aware decay (`HALF_LIFE_BY_CATEGORY`). Persistence at `~/.kaijibot/cognitive/persona/`
  - `insight/` — proactive insight generation (cross-domain connections, domain depth, exploration). Unified pipeline with contrastive dedup, LLM self-refine loop (critique→rewrite), LLM-as-judge verification, semantic freshness check. Knowledge mode consumes TypedInsights (filtered by category) + cognitive fragments. Pattern mode uses dialog fragment clusters. Web search results serve as supporting evidence (not primary content). `FragmentStore` for behavioral pattern mining
  - `evolution/` — agent-driven self-evolution: hard-trigger detects complex tasks (≥3 tool calls), enqueues system event for agent to evaluate; LLM skill draft generator (with embedded skill-creator spec), skill writer (`~/.kaijibot/skills/`), lifecycle manager (dedup via Levenshtein+Jaccard, 30-day expiry), preference adapter (Thompson Sampling), safety gate, audit log, ClawHub publisher/catalog
  - `scheduler/` — proactive timing (PRISM cost-sensitive gate, SIRI search-identify-resolve loop, timer/persona-change/info-scan/evolution-scan event sources)
  - `feedback/` — feedback collection (explicit + implicit), Thompson Sampling preference learner, trust/rapport calculator (SARA framework)
  - `correction/` — error-correction self-evolution: dual-path detection (agent self-report via `record_correction` tool + post-session LLM extraction on `/new`/`/reset`), `CorrectionStore` with Jaccard-based dedup and reinforcement (TTL=90d, MAX=50, threshold=0.6), system prompt injection via `context-writer.ts` (top 15 corrections sorted by reinforcement count). Persistence at `~/.kaijibot/cognitive/corrections/{userId}.json`
  - `mode-router.ts` — classifies turns into task/insight/hybrid/proactive modes (Chinese + English pattern matching)
  - `context-writer.ts` — builds cognitive mode prompt sections for system prompt injection
- **`src/infra/openclaw-migrator/`** — OpenClaw → KaijiBot migration: auto-detect OpenClaw installation, import agents/workspace/skills/config with dry-run support, onboard wizard integration
- **`src/commands/migrate.ts`** — `kaijibot migrate` CLI command
- **`extensions/`** — 62 bundled plugins. The only messaging channel is **feishu**; the primary LLM provider is **zai**. Also includes: openai, ollama, lmstudio, github-copilot, exa, tavily, browser, memory-core, memory-lancedb, memory-wiki, speech-core, talk-voice, media-understanding-core, image-generation-core, diffs, llm-task, device-pair, webhooks, shared
- **`packages/`** — shared packages: plugin-sdk, plugin-package-contract, memory-host-sdk
- **`skills/`** — 22 skills (github, gh-issues, weather, summarize, coding-agent, mcporter, skill-creator, session-logs, healthcheck, notion, obsidian, canvas, nano-pdf, taskflow, taskflow-inbox-triage, clawhub, video-frames, gifgrep, node-connect, blogwatcher, sherpa-onnx-tts, memory-organize)
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
- Format check: `pnpm format:check` (oxfmt --check)
- Format fix: `pnpm format` (oxfmt --write)
- Tests: `pnpm test` (vitest); coverage: `pnpm test:coverage`
- Scoped test: `pnpm test <path-or-filter>` (e.g. `pnpm test src/cognitive/persona/store.test.ts`)
- Run CLI in dev: `pnpm kaijibot ...` or `pnpm dev`
- **Deploy gateway (build + restart)**: `pnpm gw:deploy` — builds latest code, stops old gateway, starts new gateway in tmux session `gw`. Use this after any code change that needs to take effect in the running gateway.
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

### Proactive Insight Pipeline

```
Event Sources (timer / persona_change / info_scan)
  → ProactiveScheduler.processEvent(userId, event)
    → computeGradedGate() [pNeed × pAccept vs cost threshold]
      → search() [scan opportunities: cross-domain, domain depth, exploration]
        → scanExploration: 3-mode routing via timestamp % 100:
            roll < patternModeRatio → pattern mode (fragment clusters → behavioral insight)
            roll < patternModeRatio + surpriseWeight → surprise mode (knowledge, web search)
            else → extend mode (knowledge, user domains)
        → identify() [pick best by pAct, with domain cooldown + type cooldown]
          → resolve():
              pattern mode: load fragments+clusters → buildPatternInsightPrompt → generateInsightCandidatesLLM(mode="pattern") → partial status, no verification
              knowledge mode (surprise/extend):
                1. checkSemanticNoveltyWithLLM — reject semantically repetitive candidates early
                2. generateInsightCandidatesLLM — LLM generates from TypedInsights (getFilteredInsights, excludes tool_config/contextual_fact) + fragments + web search results
                3. pickPromptVariant — Thompson Sampling selects prompt variant from feedbackProfile.topicBandits
                4. CONTRASTIVE_INSTRUCTION — past insights injected, LLM must generate contrastively different content
                5. critiqueInsightWithLLM → refineInsightWithLLM — self-refine loop (critique→rewrite, up to 3 quality retries, early exit at score ≥ 0.85)
                6. verifyInsightWithLLM — LLM-as-judge verification (sources present = verified)
                7. checkSemanticNoveltyWithLLM — post-generation freshness gate
            → safety-net trigram dedup → onInsightReady callback → resolveCognitiveDeliveryTarget → deliverOutboundPayloads → user receives message
```

**Unified Pipeline (knowledge + pattern modes):**

- **Knowledge mode** (`generateInsightCandidatesLLM`): LLM generates insight candidates from TypedInsights + cognitive fragments + web search results. `getFilteredInsights()` selects up to N insights per domain, excluding `tool_config` and `contextual_fact` categories. Uses `DIVERSE_FEW_SHOT_SETS` (4 sets × 2 examples) with `DIVERSITY_INSTRUCTION` to avoid formulaic output. `pickPromptVariant` selects prompt variant via Thompson Sampling from `feedbackProfile.topicBandits`. `CONTRASTIVE_INSTRUCTION` ensures each insight differs from past insights. Surprise mode uses `inferSearchStrategy` for web search queries (web results serve as supporting evidence, not primary content). After generation: `critiqueInsightWithLLM` → `refineInsightWithLLM` self-refine loop, quality retries up to 3 attempts with early exit at score ≥ 0.85. Post-generation: `checkSemanticNoveltyWithLLM` freshness gate.
- **Pattern mode** (`buildPatternInsightPrompt`): Fragment clusters loaded from `FragmentStore` → top fragments by strength → `PATTERN_PROMPT_FRAMES` (4 behavioral observation frames, randomly selected) → LLM generates behavioral insight about the user's thinking patterns. Also uses `pickPromptVariant` for Thompson Sampling prompt selection and `CONTRASTIVE_INSTRUCTION` for dedup. No web search, no verification. Verification status is always `"partial"`.
- **Mode routing**: `scanExploration()` uses deterministic 3-band routing via `event.timestamp % 100`. Default: 50% pattern, 40% surprise, 10% extend. Configurable via `cognitive.insight.patternModeRatio`.

**Scheduler Diversification:**

- `identify()` applies domain cooldown: `Math.pow(0.5, overlapCount)` for domains overlapping with recent insights.
- Fatigued domains (≥2 appearances in last 5) are filtered out entirely before selection.
- Starvation boost: domains absent from last 8 insights get 1.5× bonus.
- `scanCrossDomain` uses 1-hop and 2-hop connections from the domain graph. Falls back to `semanticDistance()` to find the most distant user-domain pair when both produce zero results.
- `scanDomainDepth` filters out recently targeted domains, falls back to all depth-3+ domains when none remain.

**Persona TypedInsight System:**

- `InsightCategory`: 6 categories — `domain_knowledge`, `behavioral_pattern`, `stated_preference`, `tool_config`, `contextual_fact`, `goal_or_aspiration`
- `TypedInsight`: each insight carries `category`, `confidence`, `source` (explicit/inferred/observed), `evidenceCount`, `halfLifeDays` (category-aware), `firstObserved`, `lastReinforced`
- `HALF_LIFE_BY_CATEGORY`: category-specific decay — behavioral_pattern (60d), domain_knowledge (90d), stated_preference (120d), goal_or_aspiration (120d), contextual_fact (45d), tool_config (180d)
- `InterestPhase` lifecycle: emergent → stable → declining → dormant → revived, tracked via `computeInterestPhase()`
- `mergeTypedInsights`: deduplication by semantic similarity + category merge with evidence accumulation
- `getFilteredInsights`: filters out `tool_config` and `contextual_fact` from insight consumption (not useful for insight generation)
- `displayName`: synced from `coreTraits["称呼"]` to `identity.displayName` by curator
- Dynamic domain discovery: `llm-extractor.ts` uses LLM to discover new domains from conversations — no hardcoded keyword tables

### Self-Evolution Pipeline

Agent-driven architecture: code only detects 3+ tool calls (noise filter), Agent decides everything else.

```
Agent turn completes (≥3 tool calls)
  → hard-trigger.ts: evaluateHardTrigger()
    → resolveUserIdFromSession()
    → consumeToolErrorProfile(sessionKey) — error info as reference context (NOT a gate)
    → buildEvolutionSignal(toolCalls, duration, errorInfo)
    → enqueueSystemEvent("[Evolution Signal]...", { sessionKey })
    → requestHeartbeatNow({ reason: "cognitive-evolution", sessionKey })
      → heartbeat-runner triggers agent turn
        → Agent sees signal with tool sequence + optional error info
        → Agent decides based on full conversation context:
            Worth it → calls evaluate_skill_evolution → generateSkillDraftLLM → tells user or silently creates
            Not worth it → ignores signal
            Wants to silently create → creates skill, mentions later at a natural moment
```

**No code-level gating**: No complexity score threshold, no cooldown, no daily cap, no rate limit. The only code-level filter is ≥3 tool calls (noise reduction, not quality judgment). The Agent receives `recentSuggestions` (last 48h records with domain, skillName, hoursAgo, userResponse) as context and makes its own decision about frequency and worthiness.

**Hard-trigger detection** (`src/cognitive/evolution/hard-trigger.ts`):
- Called from `src/agents/pi-embedded-runner/run.ts` after tool execution
- Skips non-user/non-manual triggers
- Requires ≥3 tool calls (noise filter only)
- Resolves userId from sessionKey or senderId
- Collects tool error profile as optional signal context (not used for any decision)
- Does NOT call `EvolutionEngine.evaluate()` — no code-level complexity gating

**Agent tools**:
- `evaluate_skill_evolution` — always generates a skill draft when called; returns suggestionText + bodyMarkdown + recentSuggestions + complexityScore (as reference info, not a gate)
- `patch_skill` — text replace or LLM-guided patch on existing skills (NOTE: not yet registered in `kaijibot-tools.ts`)

**Skill lifecycle**:
- Before creation: `engine.checkBeforeGenerate()` → `lifecycle.checkDuplicate()` → suggest updating if similar exists
- After creation: frontmatter tracks `createdAt`/`lastUsedAt`/`usageCount`
- `touchSkill()` per use → `removeStale(30)` cleans skills unused 30+ days with 0 usage

### Correction Self-Evolution Pipeline

Dual-path correction detection with system prompt injection:

```
Path A: Agent self-report          Path B: Post-session extraction
  Agent calls record_correction      /new or /reset triggered
  (provenance: "self")               → hasCorrectionSignals() regex pre-screen
         ↓                           → extractCorrectionsFromTranscript() LLM call
         ↓                           (provenance: "user")
         ↓                                    ↓
         CorrectionStore.addOrReinforce(userId, record)
           → findSimilar() Jaccard ≥ 0.6 + same domain → reinforce existing
           → else → add new record (max 50 per user, TTL 90 days)
                ↓
         Next conversation: get-reply-run loads listActive(userId)
                ↓
         context-writer → formatCorrectionsPrompt (top 15, sorted by reinforcedCount)
                ↓
         "## Known Corrections" injected into system prompt
```

**CorrectionStore** (`src/cognitive/correction/store.ts`):
- `addOrReinforce(userId, record)` — Jaccard dedup: same domain + mistake similarity > 0.6 → increment `reinforcedCount`
- `findSimilar(userId, domain, text)` — token-level Jaccard similarity
- `listActive(userId)` — returns records within TTL, sorted by `reinforcedCount` desc
- `removeStale()` — deletes records older than TTL
- Atomic file write to `~/.kaijibot/cognitive/corrections/{userId}.json`

**Agent tool**: `record_correction` — called when agent recognizes it made a mistake; returns `saved` or `reinforced` status

**Post-session extraction** (`src/cognitive/correction/extractor.ts`):
- `hasCorrectionSignals(transcript)` — regex pre-screen with 30 Chinese/English/apology patterns (skips LLM call if no signals)
- `extractCorrectionsFromTranscript(transcript, generateText)` — LLM extracts structured corrections; capped at 8K chars; JSON parsing with markdown code block handling

**System prompt injection** (`src/cognitive/correction/injector.ts`):
- `formatCorrectionsPrompt(corrections)` — sorts by `reinforcedCount` desc → `lastReinforced` desc; truncates to `MAX_INJECTED_CORRECTIONS` (15); formats as markdown section

### Key Integration Points

Insight delivery:
- `src/gateway/server.impl.ts` (cognitive section) — bootstraps ProactiveScheduler with shared FragmentStore, wires event sources and delivery
- `src/gateway/cognitive-delivery.ts` — resolves userId to session key for delivery routing
- `src/infra/heartbeat-reason.ts` — classifies `"cognitive-insight"` as `"wake"` kind to bypass HEARTBEAT.md gate
- `src/infra/heartbeat-runner.ts` — `hasCognitiveEvents` check for `shouldInspectPendingEvents`

Evolution (signal-driven via system events):
- `src/cognitive/evolution/hard-trigger.ts` — post-turn hook: detects ≥3 tool calls (noise filter), enqueues [Evolution Signal] with error context
- `src/agents/tools/evolution-suggest-tool.ts` — `evaluate_skill_evolution` agent tool (used when agent decides to act on signal)
- `src/agents/tools/evolution-patch-tool.ts` — `patch_skill` agent tool
- `src/cognitive/context-writer.ts` — injects "Skill Evolution" system prompt section when `evolutionEnabled`
- `src/auto-reply/reply/get-reply-run.ts` — passes `evolutionEnabled` to context-writer
- `src/infra/heartbeat-reason.ts` — classifies `"cognitive-evolution"` as `"wake"` kind to bypass HEARTBEAT.md gate

Shared:
- `src/agents/tools/cognitive-feedback-tool.ts` — agent tool for collecting explicit feedback
- `src/agents/system-prompt.ts` — injects cognitive mode prompt into agent system prompt

Correction (system prompt injection):
- `src/cognitive/correction/store.ts` — CorrectionStore: per-user persistence with Jaccard dedup
- `src/cognitive/correction/injector.ts` — formatCorrectionsPrompt: sorts + truncates + formats for system prompt
- `src/cognitive/correction/extractor.ts` — hasCorrectionSignals (regex pre-screen) + extractCorrectionsFromTranscript (LLM)
- `src/agents/tools/correction-report-tool.ts` — record_correction agent tool
- `src/cognitive/context-writer.ts` — injects "## Known Corrections" section when corrections exist
- `src/auto-reply/reply/get-reply-run.ts` — loads listActive corrections, passes to context-writer
- `src/hooks/bundled/session-memory/handler.ts` — post-session correction extraction (regex pre-screen → LLM → store)

### Session Memory

- `src/hooks/bundled/session-memory/handler.ts` — triggers on `command:new` / `command:reset` / `compaction:after`; generates structured summary via LLM, appends to daily `memory/YYYY-MM-DD.md` file, routes to topic files via `topicManager.appendEntry()`; also runs post-session correction extraction (regex pre-screen → LLM → CorrectionStore)
- `src/hooks/bundled/session-memory/summary.ts` — `formatSummaryAsMarkdown(summary, dateStr, sessionKey?, rawTranscript?)` outputs YAML frontmatter + structured sections + folded `<details>` raw transcript; `generateStructuredSummary` calls LLM to produce `StructuredSummary` (summary, decisions, followups, topics, participants, topicSlug)
- Dual output: structured summary for search/retrieval + raw transcript preserved in collapsible block for context recovery

### Dreaming

- Default storage mode: `"separate"` (`DEFAULT_MEMORY_DREAMING_STORAGE_MODE` in `src/memory-host-sdk/dreaming.ts`); writes dream output to separate files instead of inline in daily memory files
- `MemoryDreamingStorageMode` type: `"inline" | "separate" | "both"`
- `extensions/memory-core/src/dreaming.ts` — `enqueueSystemEvent` after memory promotion to trigger downstream processing

### Memory Organization

- `skills/memory-organize/SKILL.md` — four-step organize flow: GC (MEMORY.md cleanup + dedup) → Deep scan (QMD sessions) → Tidy (`memory_tidy` full) → Final check (4KB budget)
- MEMORY.md 4KB budget is a skill-level constraint enforced by the LLM + `memory_tidy` tool, not a code constant

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
- **Cognitive layer live tests** — after modifying `src/cognitive/evolution/` or `src/cognitive/insight/`, run the live quality tests to verify real LLM output:
  - Evolution: `KAIJIBOT_LIVE_TEST=1 pnpm test src/cognitive/evolution/evolution-live-quality.test.ts`
  - Evolution E2E: `KAIJIBOT_LIVE_TEST=1 ZAI_API_KEY=$ZAI_API_KEY pnpm test src/cognitive/evolution/evolution-live-e2e.test.ts`
  - Insight: `KAIJIBOT_LIVE_TEST=1 ZAI_API_KEY=$ZAI_API_KEY TAVILY_API_KEY=$TAVILY_API_KEY pnpm test src/cognitive/insight/insight-live-quality.test.ts`
  - Pipeline eval (5-round dual pipeline): `KAIJIBOT_LIVE_TEST=1 ZAI_API_KEY=$ZAI_API_KEY TAVILY_API_KEY=$TAVILY_API_KEY pnpm test src/cognitive/insight/insight-pipeline-live-eval.test.ts`
  - These tests are excluded from normal `pnpm test` (`**/*.live.test.ts` in vitest exclude). They call real LLM and web search APIs. Skip if API keys are unavailable.
  - Correction: `KAIJIBOT_LIVE_TEST=1 pnpm test src/cognitive/correction/` (38 tests, unit only — no live LLM tests currently)
- `pnpm test` (full suite) uses a custom runner (`scripts/test-projects.mjs`) that spawns vitest as child processes. **stdout is empty except for the pnpm header**; test output goes to stderr. Judge success by exit code only — do not wait for stdout feedback. For targeted output, use `pnpm test <path-or-filter>`.
- Known gap: `vitest.infra.config.ts` and `vitest.gateway.config.ts` exist but some test paths in `src/infra/` and `src/gateway/` are not fully configured; use `pnpm tsgo` for type verification when `pnpm test` cannot resolve a path.

## Auditing Default-Disabled Features

- When auditing which features default to disabled, grep patterns like `DEFAULT_.*ENABLED.*=.*false` and `?? false` across **all of `src/`** — not just `src/gateway/` or `src/cognitive/`. Feature defaults can live in cross-cutting modules like `src/memory-host-sdk/` that don't map 1:1 to a subsystem directory. Do not assume directory boundaries match feature module boundaries.

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
- Insight config: `cognitive.insight.patternModeRatio` (0-1, default 0.5), `cognitive.insight.engine` ("v1"/"v2"/"dual"/"knowledge"/"pattern"/"unified")
- Persona config: TypedInsight categories with `HALF_LIFE_BY_CATEGORY` decay; `InsightCategory` enum; `InterestPhase` lifecycle; dynamic domain discovery via LLM (no hardcoded keywords)
- Evolution config: `cognitive.evolution.enabled`, `cognitive.evolution.clawhubEnabled`, `cognitive.evolution.clawhubRegistry`
- Note: `minComplexity` and `errorComplexityThreshold` exist in engine config but are no longer used by hard-trigger or suggest-tool for gating; they remain for engine unit tests only
- Correction config: enabled by default when `cognitive.enabled` is true; no separate config key
- Correction data stored at `~/.kaijibot/cognitive/corrections/{userId}.json`. Schema: CorrectionStoreData with records array, each CorrectionRecord has id, domain, trigger, mistake, correction, provenance, reinforcedCount, createdAt, lastReinforced.
- Web search: `EXA_API_KEY` / `TAVILY_API_KEY` env vars or scoped credentials in config
- Env-source precedence: process env → `./.env` → `~/.kaijibot/.env` → `kaijibot.json` env block.
- Credentials stored at `~/.kaijibot/credentials/`.
- Persona data stored at `~/.kaijibot/cognitive/persona/{userId}.json`. Schema includes TypedInsights with category-aware decay and InterestPhase lifecycle per domain.
- Evolution records stored at `~/.kaijibot/cognitive/evolution/{userId}.json`; skills at `~/.kaijibot/skills/{name}/SKILL.md`.
- Evolution audit log at `~/.kaijibot/cognitive/evolution/audit.jsonl`.
- Never commit real phone numbers, API keys, or live config values.

## Syncing Upstream

```bash
git remote add upstream https://github.com/openclaw/openclaw
git fetch upstream
git merge upstream/main
```

Or use the Gitee mirror (squash history, no individual commits):
```bash
git remote add openclaw https://gitee.com/kaiji1126/openclaw
git fetch openclaw
git merge openclaw/main
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
