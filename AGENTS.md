# KaijiBot — Repository Guidelines

KaijiBot is an independent project — a proactive cognitive AI assistant with a pluggable provider/channel architecture. Supports any LLM provider (35+ bundled) and extensible messaging channels. Originally forked from [OpenClaw](https://github.com/openclaw/openclaw), now developed independently with its own cognitive layer, architecture, and direction.

- Repo: independent project, originally forked from [OpenClaw](https://github.com/openclaw/openclaw)
  - Main (GitHub): `https://github.com/Kaiji-Z/kaijibot`
  - Backup (Gitee): `https://gitee.com/kaiji1126/kaijibot`
  - Upstream (GitHub): `https://github.com/openclaw/openclaw`
  - Upstream mirror (Gitee): `https://gitee.com/kaiji1126/openclaw` (manual mirror, squash history)
- In chat replies, file references must be repo-root relative only (e.g. `src/cli/index.ts:80`); never absolute paths or `~/...`.

## Mandatory Verification Protocol

Before developing any feature or changing any code, read and follow `VERIFICATION.md`. Output that violates a red line in VERIFICATION.md §7 is void. The current verification system status and backlog are in [Verification System](#verification-system) below.

## Project Structure

- **`src/`** — core engine: CLI (`src/cli`), commands (`src/commands`), gateway (`src/gateway`), agents (`src/agents`), config (`src/config`), plugin system (`src/plugins`, `src/plugin-sdk`), channels (`src/channels`), media pipeline (`src/media`), **cognitive layer (`src/cognitive`)**
- **`src/cognitive/`** — KaijiBot's proactive AI system (unique to this fork, not in upstream OpenClaw):
  - `persona/` — per-user cognitive model (identity, domains, interests, trust). LLM-driven extraction with structured `TypedInsight` (6 categories: domain_knowledge, behavioral_pattern, stated_preference, tool_config, contextual_fact, goal_or_aspiration). Dynamic domain discovery via LLM (no hardcoded keywords). Interest lifecycle tracking (emergent/stable/declining/dormant/revived). Category-aware decay (`HALF_LIFE_BY_CATEGORY`). Persistence at `~/.kaijibot/cognitive/persona/`
  - `insight/` — proactive insight generation (cross-domain connections, domain depth, exploration). Unified pipeline with contrastive dedup, LLM self-refine loop (critique→rewrite), LLM-as-judge verification, semantic freshness check. Knowledge mode consumes TypedInsights (filtered by category) + cognitive fragments. Pattern mode uses dialog fragment clusters. Web search results serve as supporting evidence (not primary content). `FragmentStore` for behavioral pattern mining
  - `evolution/` — agent-driven self-evolution: hard-trigger detects complex tasks (≥3 tool calls), enqueues system event for agent to evaluate; LLM skill draft generator (with embedded skill-creator spec), skill writer (`~/.kaijibot/skills/`), lifecycle manager (dedup via Levenshtein+Jaccard, 30-day expiry), preference adapter (Thompson Sampling), safety gate, audit log, ClawHub publisher/catalog
  - `scheduler/` — proactive timing (PRISM cost-sensitive gate, SIRI search-identify-resolve loop, timer/persona-change/info-scan/evolution-scan event sources)
  - `feedback/` — feedback collection (explicit + implicit), Thompson Sampling preference learner, trust/rapport calculator (SARA framework)
  - `correction/` — error-correction self-evolution: dual-path detection (agent self-report via `record_correction` tool + post-session LLM extraction on `/new`/`/reset`), `CorrectionStore` with Jaccard-based dedup and reinforcement (TTL=90d, MAX=50, threshold=0.6), system prompt injection via `context-writer.ts` (top 15 corrections sorted by reinforcement count). Persistence at `~/.kaijibot/cognitive/corrections/{agentId}/{userId}.json`
  - `mode-router.ts` — classifies turns into task/insight/hybrid/proactive modes (Chinese + English pattern matching)
  - `context-writer.ts` — builds cognitive mode prompt sections for system prompt injection
- **`src/infra/openclaw-migrator/`** — OpenClaw → KaijiBot migration: auto-detect OpenClaw installation, import agents/workspace/skills/config with dry-run support, onboard wizard integration
- **`src/commands/migrate.ts`** — `kaijibot migrate` CLI command
- **`extensions/`** — bundled plugins (~75 packages with their own `package.json` + ~15 bundled-in modules without one). Ground-truth categories as of the current tree:
  - **Channels — first-class** (own package, project focus, China-oriented): **feishu**, **wechat**
  - **Channels — bundled/inherited from upstream fork** (code present, NOT first-class, untested in this project): discord, googlechat, irc, line, matrix, mattermost, nextcloud-talk, nostr, qa-matrix, qqbot, signal, slack, synology-chat, telegram, tlon, twitch, zalo, zalouser. **Note**: `docs/channels/` additionally documents bluebubbles/imessage/msteams/whatsapp which have **no bundled code** (dead doc pages).
  - **LLM providers (~47)**: **zai** (default/recommended), deepseek, qwen, moonshot, minimax, alibaba (qianfan), anthropic, anthropic-vertex, google, openai, openrouter, mistral, groq, together, fireworks, stepfun, volcengine/byteplus, xai, ollama, lmstudio, vllm, sglang, litellm, huggingface, nvidia, cerebras, runway, venice, chutes, kilocode, kimi-coding, gradium, vydra, opencode, opencode-go, microsoft-foundry, copilot-proxy, github-copilot, arcee, cloudflare-ai-gateway, vercel-ai-gateway, qianfan, xiaomi, open-prose
  - **Web search**: exa, tavily, perplexity
  - **Core/media/memory/other**: browser, memory-core, memory-lancedb, knowledge-wiki, speech-core, talk-voice, voice-call, media-understanding-core, image-generation-core, diffs, llm-task, webhooks, kindle-portal, openshell, canvas, device-pair, amazon-bedrock, codex, codex-supervisor, sms, qa-channel, qa-lab, acpx, bonjour, clickclack, migrate-hermes, oc-path
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
- **Plugin loading** has three registration modes (`KaijiBotPluginApi.registrationMode`):
  - `"cli-metadata"` — only CLI command descriptors are registered; no runtime side-effects. Used for fast CLI boot.
  - `"light"` — registration runs but lazy surfaces stay deferred.
  - `"full"` — full runtime registration including tools, gateway methods, hooks.
- **Plugin SDK** (`src/plugin-sdk/*`) exposes 237 subpath entrypoints (`kaijibot/plugin-sdk/*`). API baseline (`src/plugin-sdk/api-baseline.ts`) locks the public export set; CI fails if unauthorized exports leak. The SDK alias map (`src/plugins/sdk-alias.ts`) resolves `kaijibot/plugin-sdk/*` to source TS (dev) or built `dist/plugin-sdk/*` artifacts (prod).

## Atomic File Writes

- **Canonical pattern**: use `writeTextAtomic(filePath, content, options?)` / `writeJsonAtomic(filePath, value, options?)` from `src/infra/json-files.ts` for all persistent file writes. These create temp files in the target's same directory (avoiding EXDEV across filesystems), handle Windows EPERM/EEXIST via `replaceFileWithWindowsFallback`, and ensure dir creation.
- **Do NOT** use the old `tmpdir() + writeFile + rename` pattern — `tmpdir()` may be on a different filesystem causing `rename()` to fail with EXDEV.
- `writeJsonAtomic` uses `JSON.stringify(value, null, 2)` internally (2-space indent). Options: `{ mode?, trailingNewline?, ensureDirMode? }`.
- `writeTextAtomic` options: `{ mode?, ensureDirMode?, appendTrailingNewline? }`. Default mode `0o600`.

## End-to-End Message Flow

```
User sends message in Feishu
  → extensions/feishu/src/bot.ts (event decode, dedup, mention gating)
  → gateway ingress (src/gateway/server-methods/chat.ts)
  → src/auto-reply/dispatch.ts (dispatchInboundMessage)
    → allowlist check → command detection → session routing
    → src/auto-reply/reply/get-reply-run.ts (runPreparedReply)
      → src/cognitive/context-writer.ts (injects: mode + persona + corrections + evolution)
      → src/agents/pi-embedded-runner/run.ts (agent loop: LLM streaming + tool execution)
        → provider plugin (zai) → LLM API
        → tool execution (feishu docs, memory, browser, etc.)
        → post-turn: evaluateHardTrigger (≥3 tools → evolution signal)
        → session-memory hook (summary + correction extraction)
      → ReplyDispatcher → channel.outbound → Feishu API
```

Async pipelines (not triggered by user messages):

- **Proactive insights**: scheduler events (timer/persona-change/info-scan) → PRISM gate → search → identify → resolve → LLM generates insight → deliver via Feishu
- **Memory consolidation**: cron `0 3 * * *` → scan session files → LLM extract → Jaccard dedup → route to PersonaStore/FragmentStore/CorrectionStore + MEMORY.md inline sections
- **Skill evolution**: heartbeat triggers agent turn on evolution signal → Agent decides whether to create a skill

## Cognitive System Architecture

### Identity Resolution

The cognitive system identifies users through a single unified function: `resolveCognitiveUserId(sessionKey?, senderId?)` in `src/cognitive/identity.ts`. Channel-agnostic — no `ou_` prefix check, works with feishu, wechat, and any future channel.

**Resolution rules (priority order):**

1. `senderId` present (conversation-time path) → `resolveOperatorSenderId(senderId) ?? senderId`
2. `sessionKey` tail === `"main"` → `OPERATOR_USER_ID` (`"operator"`)
3. Group session without `:sender:` → `null` (tail is a group ID, not a user ID)
4. Otherwise → tail returned as-is (any format: `ou_xxx`, `wx_xxx`, etc.)

**Operator identity:** Control UI, TUI, and mobile apps (macOS/iOS/Android) are mapped to `userId = "operator"` at the gateway boundary (`chat.ts` SenderId mapping). The operator has a fully isolated cognitive profile per agent.

**dmScope adaptive:** `resolveEffectiveDmScope(cfg)` in `src/routing/session-key.ts` automatically promotes `dmScope` from `"main"` to `"per-peer"` when any channel has credentials configured. This ensures per-user session isolation without requiring manual configuration. Explicit dmScope settings are always respected.

**All cognitive subsystems use the same storage dimensions:**

- Persona/Correction/Evolution/Fragments: `cognitive/{subsystem}/{agentId}/{userId}.json` — agent × user isolation
- Skills/Memory: workspace-isolated (per-agent, no userId dimension)
- AuditLog/Effectiveness: global

**Store concurrency:** PersonaStore, CorrectionStore, and FragmentStore all wrap writes in per-`(agentId, userId)` `createAsyncLock` (from `src/infra/json-files.ts`). Use `PersonaStore.update(agentId, userId, mutator)` for atomic load → mutate → save; avoid external `load()` + `save()` pairs (they leave a race window between load and save). CorrectionStore and FragmentStore lock internally — callers don't need to do anything special.

### Proactive Insight Pipeline

```
Event Sources (timer / persona_change / info_scan)
  → ProactiveScheduler.processEvent(userId, event)
    → computeGradedGate() [pNeed × pAccept vs cost threshold]
      → search() [scan opportunities: cross-domain, domain depth, exploration]
        → scanExploration: mode selection deferred to resolve() via banditWeightedSelect
            modeCandidates: ["pattern", "surprise", "extend"] (or forced single mode via content strategy)
            resolve() calls selectMode() → banditWeightedSelect() with BASE_WEIGHTS (pattern:0.5, surprise:0.4, extend:0.1)
        → identify() [pick best by pAct, with domain cooldown + type cooldown]
      → applyEpsilonGreedy() [with probability ε, promote one exploration candidate to front]
        → resolve loop tries candidates in order (promoted exploration first if triggered)
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
- **Mode routing**: `scanExploration()` creates exploration opportunities with `modeCandidates: ["pattern", "surprise", "extend"]`. Mode selection is deferred to `resolve()` which calls `selectMode()` → `banditWeightedSelect()` using `BASE_WEIGHTS` (pattern:0.5, surprise:0.4, extend:0.1) with a 30% probability floor (`BASE_PROBABILITY_FLOOR=0.3`) to prevent starvation. Content strategy override (`computeContentStrategy`) can force a specific mode when no-response streak ≥ 2. The actual resolved mode is propagated via `InsightCandidate.resolvedMode`.

**Scheduler Diversification:**

- `identify()` applies domain cooldown: `Math.pow(0.5, overlapCount)` for domains overlapping with recent insights.
- Fatigued domains (≥2 appearances in last 5) are filtered out entirely before selection.
- Starvation boost: domains absent from last 8 insights get 1.5× bonus.
- `scanCrossDomain` uses 1-hop and 2-hop connections from the domain graph. Falls back to `semanticDistance()` to find the most distant user-domain pair when both produce zero results.
- `scanDomainDepth` filters out recently targeted domains, falls back to all depth-3+ domains when none remain.

**Persona TypedInsight System:**

- `InsightCategory`: 6 categories — `domain_knowledge`, `behavioral_pattern`, `stated_preference`, `tool_config`, `contextual_fact`, `goal_or_aspiration`
- `TypedInsight`: each insight carries `category`, `confidence`, `source` (explicit/inferred/observed), `evidenceCount`, `halfLifeDays` (category-aware), `firstObserved`, `lastReinforced`
- `HALF_LIFE_BY_CATEGORY`: category-specific decay — tool_config (7d), contextual_fact (14d), domain_knowledge (30d), stated_preference (60d), behavioral_pattern (90d), goal_or_aspiration (90d)
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
            Worth it → calls evaluate_skill_evolution → generateSkillDraftLLM → tells user what was created
            Not worth it → ignores signal
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
- `patch_skill` — text replace or LLM-guided patch on existing skills
- `delete_skill` — permanently delete a skill (requires confirm: true)
- `manage_archived_skills` — list and recover archived skills
- **Quality gate**: generated skills are evaluated by LLM-as-judge (4 dimensions, threshold 0.7) with up to 2 refine-retry loops before persistence
- **Independent reviewer**: after save, fresh-context LLM review runs async and logs to AuditLog
- **Effectiveness tracking**: post-skill-use tool count delta measured against domain baseline

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
- Atomic file write to `~/.kaijibot/cognitive/corrections/{agentId}/{userId}.json`

**Agent tool**: `record_correction` — called when agent recognizes it made a mistake; returns `saved` or `reinforced` status

**Post-session extraction** (`src/cognitive/correction/extractor.ts`):

- `hasCorrectionSignals(transcript)` — regex pre-screen with ~60 Chinese/English/apology patterns covering direct correction (`搞错`/`wrong`), action-oriented (`改成`/`重做`), questioning tone (`怎么回事`/`为什么不`), problem identification (`有问题`/`出问题了`), and agent apology (`抱歉`/`sorry`); skips LLM call if no signals
- `extractCorrectionsFromTranscript(transcript, generateText)` — LLM extracts structured corrections; capped at 16K chars; uses `createStandaloneGenerateText` for single-turn LLM call

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

- `src/hooks/bundled/session-memory/handler.ts` — triggers on `command:new` / `command:reset` / `compaction:after`; generates structured summary via LLM, appends to daily `memory/YYYY-MM-DD.md` file, routes to topic files via `topicManager.appendEntry()`; updates MEMORY.md with topic pointer via `indexManager.updateSection()`, routes high-importance content to inline sections based on `summary.memoryType` (core/active; legacy user/feedback/reference → ⚡ Core Memory, project → 🔥 Active Context), then calls `rebalanceIndex()` to enforce 8KB budget; also runs post-session correction extraction (regex pre-screen → LLM → CorrectionStore). `extractUserIdFromSessionKey` extracts `ou_xxx` from feishu session keys for per-user correction storage.
- `src/hooks/bundled/session-memory/summary.ts` — `generateStructuredSummary` uses `createStandaloneGenerateText` (single-turn LLM call, 60s timeout) to produce `StructuredSummary` (summary, decisions, followups, topics, participants, topicSlug, memoryType); `memoryType` routes high-importance content to inline sections (⚡ Core Memory / 🔥 Active Context); preferred types: `core` → ⚡ Core Memory, `active` → 🔥 Active Context; legacy types still supported: `user`/`feedback`/`reference` → ⚡ Core Memory, `project` → 🔥 Active Context; transcript budget 16K chars; `formatSummaryAsMarkdown` outputs YAML frontmatter + structured sections
- `src/hooks/bundled/session-memory/transcript.ts` — `getRecentSessionContent` reads JSONL session files, extracts user/assistant text, strips feishu metadata (`Conversation info`/`Sender` JSON blocks + `ou_xxx:` prefix) via `stripMessageMetadata`; `getRecentSessionContentWithResetFallback` falls back to `.reset.` archived files

### Memory Consolidation

- Replaces the old dreaming system. Scans session transcripts daily (cron `0 3 * * *`, configurable), extracts structured knowledge via LLM, routes to existing cognitive stores.
- `src/memory-host-sdk/consolidation.ts` — config types + defaults (`DEFAULT_MEMORY_CONSOLIDATION_ENABLED = true`, cron, concurrency, batchSize, lookbackDays)
- `src/memory-host-sdk/consolidation-userid.ts` — resolves session file → `ou_xxx` userId (sessions.json lookup, 60s TTL cache)
- `extensions/memory-core/src/consolidation.ts` — orchestrator: `runConsolidationForAgent` / `runConsolidationAllAgents`, per-user pipeline via `resolveUserIdForFile`
- `extensions/memory-core/src/consolidation-extract.ts` — LLM extraction + Jaccard dedup + conflict resolution
- `extensions/memory-core/src/consolidation-route.ts` — `routeToStores`: routes to PersonaStore/FragmentStore/CorrectionStore + high-confidence items (≥0.7, behavioral_pattern ≥0.8) to MEMORY.md inline sections + daily file append
- `extensions/memory-core/src/consolidation-types.ts` — `ExtractedItem`, `RouteItem`, `FileWithUserId`, `ConsolidationCheckpoint`, `ConsolidationResult`
- Category → inline section mapping: `domain_knowledge`/`stated_preference`/`behavioral_pattern` → ⚡ Core Memory; `goal_or_aspiration` → 🔥 Active Context
- Gateway bootstrap: `src/gateway/server.impl.ts` (~line 1491), uses `croner` Cron for scheduling
- All LLM/store deps injected as callbacks (no direct core imports from extensions)

### Memory Organization

- `skills/memory-organize/SKILL.md` — four-step organize flow: GC (MEMORY.md cleanup + dedup) → Deep scan (QMD sessions) → Tidy (`memory_tidy` full, now includes inline section dedup) → Final check (8KB budget)
- MEMORY.md structure: inline sections (⚡ Core Memory, 🔥 Active Context) for high-frequency content + flat `## Topic Pointers` list for topic file references; no `## Recent Sessions` (removed — redundant with daily files and topic pointers)
- MEMORY.md 8KB budget enforced by `rebalanceIndex()` in `memory-core/src/memory-index.ts` (`DEFAULT_MAX_BYTES = 8192`); the `memory-organize` skill instructs the LLM to aim for 4KB but the code-level hard limit is 8KB
- `addRecentSession()` is retained on `MemoryIndexManager` but no longer serialized — the hook uses `updateSection()` for topic pointers instead
- **Dedup**: Three systems maintain MEMORY.md inline sections — session-memory handler, consolidation, and `memory_save`. All use Jaccard similarity (≥0.8) for inline dedup. `memory_tidy full` includes `actionInlineDedup` (within-section + cross-topic inline↔topic dedup). `memory_save` adds date prefix and calls `rebalanceIndex()`. `relocateInlineToTopic` checks for existing similar content before appending.

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
- Known gaps: `vitest.infra.config.ts` and `vitest.gateway.config.ts` exist but some test paths in `src/infra/` and `src/gateway/` are not fully configured; `src/process/**` is excluded from all vitest projects and `scripts/test-projects.mjs` references a non-existent `vitest/vitest.process.config.ts`. For all gap paths, use `pnpm tsgo` for type verification, or create a temporary vitest config to run tests locally.

## Auditing Default-Disabled Features

- When auditing which features default to disabled, grep patterns like `DEFAULT_.*ENABLED.*=.*false` and `?? false` across **all of `src/`** — not just `src/gateway/` or `src/cognitive/`. Feature defaults can live in cross-cutting modules like `src/memory-host-sdk/` that don't map 1:1 to a subsystem directory. Do not assume directory boundaries match feature module boundaries.

## Commit Guidelines

- Create commits with `scripts/committer "<msg>" <file...>` to keep staging scoped.
- Concise, action-oriented commit messages (e.g. `CLI: add verbose flag to send`).
- Group related changes; avoid bundling unrelated refactors.

## Release Process

- **Versioning**: `YYYY.M.DD` format (e.g. `2026.6.27`). Multiple releases on the same date append `-1`, `-2`, `-3` (e.g. `2026.6.27-1`, `2026.6.27-2`). Do NOT use future dates.
- **One command**: `bash scripts/release.sh <version>` (e.g. `bash scripts/release.sh 2026.6.27-1`)
- The script: bumps version → `pnpm build` → `npm publish --ignore-scripts` → `git tag` → `git push`
- **CI auto-builds npm tarball**: `.github/workflows/publish-tarball.yml` triggers on tag push (`v*`), runs `npm pack`, uploads `kaijibot-<version>.tgz` to the corresponding GitHub Release
- Tarball is required for Android/Termux install (the install script downloads it from GitHub Releases instead of npmjs.org for China network reliability)
- Launcher APK: `.github/workflows/android-build.yml` triggers on `android/**` changes, builds APK with bundled Termux, uploads to `launcher` release tag
- Release guardrails: do not change version numbers without operator's explicit consent.

### Manual release (if `release.sh` is unavailable)

These gotchas are handled by `release.sh` automatically. If doing manual steps:

1. **`pnpm build` is mandatory before `npm publish`** — `dist/` is not committed to git; npm package includes it. Without rebuild, published package has stale code.
2. **`npm publish --ignore-scripts` is mandatory** — the `prepack` script fails on Control UI build (non-fatal error exits with code 1). `--ignore-scripts` skips prepack.
3. **GitHub push uses SSH** — `git push github main` (remote `github` = `git@github.com:Kaiji-Z/kaijibot.git`). Never use HTTPS to github.com (port 443 unreachable from this machine).
4. **Gitee push uses HTTPS** — `git push origin main` (remote `origin` = Gitee).
5. **Create GitHub Release tarball after publish** — `npm pack --ignore-scripts` → upload `.tgz` to GitHub Release for that tag. Android install script depends on it.

## Prompt Cache Stability

- Any code assembling model/tool payloads from maps, sets, registries, plugin lists, or filesystem reads must make ordering deterministic before building the request.
- Do not rewrite older transcript/history bytes on every turn unless intentionally invalidating the cached prefix.
- For cache-sensitive changes, require a regression test proving turn-to-turn prefix stability.

## Config and Environment

- Config lives in `~/.kaijibot/kaijibot.json`. CLI: `kaijibot config set <key> <value>`.
- Set model via `kaijibot config set agent.model "<provider>/<model>"`.
- Feishu channel config: `channels.feishu.appId`, `channels.feishu.appSecret`.
- Cognitive config: `cognitive.enabled`, `cognitive.proactive.enabled`, `cognitive.proactive.minIntervalHours`, `cognitive.proactive.activeHours`
- Insight config: `cognitive.insight.engine` ("knowledge"/"pattern"/"unified", default "unified"; legacy aliases "v1"→"knowledge", "v2"→"pattern", "dual"→"unified"), `cognitive.proactive.epsilonGreedy` (0-1, default 0.2; probability of promoting exploration candidates to front of resolve loop; set to 0 to disable)
- Persona config: TypedInsight categories with `HALF_LIFE_BY_CATEGORY` decay; `InsightCategory` enum; `InterestPhase` lifecycle; dynamic domain discovery via LLM (no hardcoded keywords)
- Evolution config: `cognitive.evolution.enabled` (dead fields removed: minComplexity, errorComplexityThreshold, minTrustScore, clawhub\*)
- Correction config: enabled by default when `cognitive.enabled` is true; no separate config key
- dmScope adaptive: `session.dmScope` defaults to `"main"`, but automatically promotes to `"per-peer"` when any channel has credentials configured (feishu, wechat, etc.). Explicit settings are always respected.
- Consolidation config: `memory.consolidation.enabled` (default `true`), `memory.consolidation.cron` (default `0 3 * * *`), `memory.consolidation.concurrency` (default 2), `memory.consolidation.batchSize` (default 4000), `memory.consolidation.lookbackDays` (default 7), `memory.consolidation.timezone`
- Correction data stored at `~/.kaijibot/cognitive/corrections/{agentId}/{userId}.json`. Schema: CorrectionStoreData with records array, each CorrectionRecord has id, domain, trigger, mistake, correction, provenance, reinforcedCount, createdAt, lastReinforced.
- Web search: `EXA_API_KEY` / `TAVILY_API_KEY` env vars or scoped credentials in config
- Env-source precedence: process env → `./.env` → `~/.kaijibot/.env` → `kaijibot.json` env block.
- Credentials stored at `~/.kaijibot/credentials/`.
- Persona data stored at `~/.kaijibot/cognitive/persona/{agentId}/{userId}.json` (per-agent subdirectory). Schema includes TypedInsights with category-aware decay and InterestPhase lifecycle per domain.
- Evolution records stored at `~/.kaijibot/cognitive/evolution/{agentId}/{userId}.json`; skills at `~/.kaijibot/skills/{name}/SKILL.md`.
- Evolution audit log at `~/.kaijibot/cognitive/evolution/audit.jsonl` (rotates at 5MB, keeps last 5 `audit-*.jsonl.rotated` archives).
- Config clobber protection: writes to `kaijibot.json` that would shrink the file by >50% vs the last-known-good snapshot (when prior config had `gateway.mode` set) are refused with `ConfigClobberProtectionError`. Bypass via `KAIJIBOT_ALLOW_CONFIG_CLOBBER_SHRINK=1` env or `allowConfigClobberShrink: true` write option.
- Postinstall kill switches: `KAIJIBOT_DISABLE_BUNDLED_PLUGIN_POSTINSTALL=1` (skip all npm postinstall) and `KAIJIBOT_DISABLE_LARK_SKILLS_INSTALL=1` (skip lark-cli skills only).
- Never commit real phone numbers, API keys, or live config values.

## Upstream Relationship (Independent)

KaijiBot forked from [OpenClaw](https://github.com/openclaw/openclaw) in April 2026 and now **develops independently**. We no longer merge upstream automatically — the cognitive layer, memory rewrite, and China/Feishu focus have taken the project in a different direction.

**When (rarely) to look upstream:** only to research how a specific upstream bug was fixed, or to hand-port a concrete improvement. This is a manual, selective judgment call — never a blanket merge. There is no expectation that upstream changes flow in.

The upstream remotes are kept dormant for this occasional reference only:

```bash
# Reference only — do NOT merge into main.
git remote add upstream https://github.com/openclaw/openclaw      # GitHub
git remote add openclaw  https://gitee.com/kaiji1126/openclaw      # Gitee mirror (squash history)
```

If you do selectively port a fix, attribute it in the commit message (e.g. `port: <fix> from OpenClaw`). The cognitive layer (`src/cognitive/`) is unique to KaijiBot and never has an upstream counterpart.

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
- Tool schema guardrails: avoid `Type.Union` / `anyOf` / `oneOf` / `allOf` in tool input schemas. Use `stringEnum` / `optionalStringEnum` from `src/agents/schema/typebox.ts` (or `kaijibot/plugin-sdk/core` for extensions). Avoid raw `format` property names. For action-based tools, flatten to `Type.Object({ action: stringEnum([...]), ...allFieldsOptional })` and enforce per-action required fields at runtime via a `requiredParam()` helper (see `extensions/feishu/src/wiki.ts` for the pattern).

## Verification System

Established by `VERIFICATION.md` diagnosis pipeline. This section is the live audit/status/backlog; the protocol itself lives in `VERIFICATION.md`.

### ACI Architecture Audit — PASS (all criteria)

| Criterion                      | Verdict | Evidence                                                                                                                                                                                                                  |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2.1 Runs without the UI       | ✅ PASS | `kaijibot gateway --port 18789` (`src/cli/gateway-cli/run.ts`); `POST /v1/chat/completions` (`src/gateway/openai-http.ts:431`); gateway RPC `chat` (`src/gateway/server-methods/chat.ts`); `*.e2e.test.ts` headless suite |
| §2.2 Intermediate state logged | ✅ PASS | Session JSONL transcripts (`src/gateway/session-transcript-files.fs.ts:39`); evolution audit log (`src/cognitive/evolution/audit-log.ts`); `getRecentSessionContent` (`src/hooks/bundled/session-memory/transcript.ts`)   |
| §2.3 Programmatic interface    | ✅ PASS | `GET /api/status` (`src/gateway/status-http.ts:58`); gateway RPC `sessions.list`/`chat.history` (`src/gateway/server-methods/`); backend/frontend split (no MCP-web-sim)                                                  |

Architecture is sound. Gaps are in the verification _layers_, not the runtime.

### Test Infrastructure Status

| Item                           | Status                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Regression run                 | `pnpm test` (`scripts/test-projects.mjs`); scoped `pnpm test <path>`. ✅ present                                                                                                                       |
| Regression set                 | Colocated `*.test.ts` (unit), `*.e2e.test.ts` (e2e), `*.live.test.ts` (live, excluded by default). 12 vitest configs incl. `vitest.cognitive.config.ts`. ✅ present                                    |
| Assertion framework            | vitest native `expect`/`assert`. ✅ present (Layer 1 deterministic)                                                                                                                                    |
| Supervisor (Layer 2 LLM judge) | ⚠️ ad-hoc only — `verifyInsightWithLLM` (`src/cognitive/insight/llm-engine.ts`), `skill-quality-gate.ts`, `skill-reviewer.ts`. NOT a reusable/clean-context harness for arbitrary features. **P0 gap** |
| Flag-based regression (§4)     | ⚠️ config `enabled` booleans exist (`src/config/types.cognitive.ts:3,7,64`), `insight.engine` enum. NO env FEATURE_FLAG system; NO on/off comparison SOP. **P0 gap**                                   |
| Contract drift checks (CI)     | ✅ CI runs `pnpm format:check`, `pnpm plugin-sdk:check-exports`, `NODE_OPTIONS=--max-old-space-size=8192 pnpm plugin-sdk:api:check` on every PR. Remediated 2026.7.19.                                 |

### Project Parameters (§8) — Filled

| Item                    | Category    | Value                                                                                                                                                                    |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 8.1 Backend start       | auto-fill   | `kaijibot gateway --port 18789`                                                                                                                                          |
| 8.1 Workflow trigger    | auto-fill   | `POST /v1/chat/completions`; gateway RPC `chat`; `kaijibot infer`/`send` CLI                                                                                             |
| 8.1 Trace fetch         | auto-fill   | `GET /api/status`; `kaijibot sessions list`; session JSONL at `~/.kaijibot/`                                                                                             |
| 8.2 Regression run      | auto-fill   | `pnpm test`; scoped `pnpm test <path>`                                                                                                                                   |
| 8.2 Regression set      | auto-fill   | colocated `*.test.ts`; e2e `*.e2e.test.ts`; live `*.live.test.ts`                                                                                                        |
| 8.2 Assertion framework | auto-fill   | vitest native (no eval harness)                                                                                                                                          |
| 8.3 Flags               | auto-fill   | config `enabled` booleans (`src/config/types.cognitive.ts`); `insight.engine` enum. No env FEATURE_FLAG / on-off SOP                                                     |
| 8.4 Supervisor model    | must-ask ✅ | Reuse agent's main model (ZAI/GLM) as judge. NOTE: §3.2 recommends a different model — self-scoring risk acknowledged; acceptable until a second key is available        |
| 8.4 Scoring dimensions  | must-ask ✅ | Quality / Relevance / Novelty / Safety — each 0–10                                                                                                                       |
| 8.4 Pass threshold      | must-ask ✅ | Each dimension ≥ 0.7                                                                                                                                                     |
| 8.5 Acceptance scope    | must-ask ✅ | 5 core workflows: proactive insight / skill self-evolution / correction memory / memory consolidation / normal conversation reply (happy path + reverse acceptance each) |
| 8.7 Eval toolchain      | auto-fill   | vitest only. No deepeval/langsmith. §3/§4 land on vitest native assertions; supervisor harness to be built                                                               |

### Verification Backlog (sorted by priority)

| Priority | Gap                                          | Remediation                                                                                                                                       | Status              |
| -------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **P0**   | No reusable supervisor framework (§3.2)      | `test/helpers/eval/supervisor.ts` — `createSupervisor({ generateText })`, clean-context (accepts only expected+actual), 4 dims ≥0.7, 8 unit tests | ✅ remediated       |
| **P0**   | No flag-based regression comparison (§4)     | `scripts/regression-flag-diff.mjs [target]` — runs suite twice via temp `KAIJIBOT_CONFIG_PATH`, JSON reporter, REGRESSIONS = pass-off/fail-on     | ✅ remediated       |
| **P1**   | Acceptance criteria not centralized (§8.5)   | `docs/ACCEPTANCE.md` — happy path + reverse acceptance for the 5 core workflows                                                                   | ✅ remediated       |
| **P1**   | Live tests excluded from default `pnpm test` | Wire a periodic live-test gate + document acceptance thresholds                                                                                   | pending remediation |
| **P2**   | No dataset-management eval harness           | Optional: thin vitest-based eval harness (fixtures + judge scoring) vs. introducing a heavy dependency                                            | deferred            |

**DoD reminder (§6):** a feature is done only when its happy-path regression test passes under flag=on, the supervisor reaches threshold, and flag=off shows no regression — all reproducible by one command. Until the P0 items are remediated, "done" claims for fuzzy-output features (insights, skill drafts) rest on the ad-hoc inline judges only.

### Verification System — Remediation Status

The P0 supervisor + flag-regression and the P1 acceptance doc have landed:

| Deliverable                                 | Location                                                  | Usage                                                                                                                                                                                              |
| ------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supervisor** (clean-context LLM-as-judge) | `test/helpers/eval/supervisor.ts` (+ `.test.ts`, 8 tests) | `createSupervisor({ generateText })` → `supervise({ expected, actual })`; enforces §3.2 by accepting ONLY expected+actual (no code-leak path). Wire to live LLM via `createStandaloneGenerateText` |
| **Flag-regression diff**                    | `scripts/regression-flag-diff.mjs [target]`               | Runs a suite twice (cognitive enabled/disabled via temp `KAIJIBOT_CONFIG_PATH`), emits a REGRESSIONS list (pass-off/fail-on). Exit 1 on regression                                                 |
| **Acceptance criteria**                     | `docs/ACCEPTANCE.md`                                      | Happy path + reverse acceptance for the 5 core workflows — the `expected` text the supervisor scores against                                                                                       |

**How to use them together** (§6 DoD, one command per layer):

```bash
# Layer 1 — deterministic regression (flag on vs off)
node scripts/regression-flag-diff.mjs src/cognitive/insight

# Layer 2 — supervisor (clean-context judge) inside a live test:
#   const supervise = createSupervisor({ generateText });
#   const r = await supervise({ expected: <from docs/ACCEPTANCE.md>, actual: output });
#   assert(r.passed);
```

The supervisor reuses the ZAI/GLM main model (operator decision, §8.4) but in an isolated context — this satisfies §3.2 rule 1 (clean context) while rule 3 (different model) stays relaxed until a second key is available.

**Remaining backlog:** P1 live-test periodic gate; P2 optional dataset eval harness.
