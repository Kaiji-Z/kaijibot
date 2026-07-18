# Changelog

> KaijiBot forked from [OpenClaw](https://github.com/openclaw/openclaw) in April 2026 and is
> developed as an independent project. The changelog below records only KaijiBot's own work.
> Upstream OpenClaw history is available in the [upstream repository](https://github.com/openclaw/openclaw).

All notable KaijiBot changes, grouped by milestone. KaijiBot uses CalVer `YYYY.M.DD`;
multiple releases on the same date append `-1`, `-2`, etc.

Repo: https://github.com/Kaiji-Z/kaijibot · Backup: https://gitee.com/kaiji1126/kaijibot

---

## 2026.7.x — Cognitive identity system & live model discovery

### ⚠️ Breaking (2026.7.18-1)

- **Memory Flush default flipped from ON to OFF.** The session-memory hook now reads the
  full transcript at `compaction:after` (was capped at 500 messages), giving it complete
  pre-compaction context and making the parallel Memory Flush pipeline largely redundant.
  To re-enable agent-curated pre-compaction memory extraction, set
  `agents.defaults.compaction.memoryFlush.enabled: true` in `~/.kaijibot/kaijiBot.json`
  or toggle it on in **Settings → Quick Settings → 压缩前记忆冲刷**.
  Most users do not need to re-enable it — the hook covers the same ground.

### Highlights

- **Memory system: unified on session-memory hook as the canonical writer.** Two parallel
  fixes shipped together: (1) hook at `compaction:after` now reads the full session file
  (verified: compaction only appends a summary entry, never removes messages, so pre-compaction
  content is preserved in the file); previously it was capped at 500 messages and missed early
  pre-compaction content in long multi-compaction sessions. (2) Memory Flush now defaults to
  OFF to eliminate overlap with the hook.
- **Memory artifacts dated by conversation start, not pipeline trigger time.** Both the
  session-memory hook (dialogue archive, daily file, dialogue frontmatter, topic frontmatter)
  and the consolidation pipeline (MEMORY.md inline sections, daily file append, wiki route)
  now derive their date stamps from the first user/assistant message timestamp in the source
  transcript, with fallback to wall-clock time. Fixes the bug where a 22:00→02:00 conversation
  that was `/new`'d at 09:00 next morning got filed under the wrong day.
- **Dialogues archive browser (new Control UI tab).** New "聊天记录" tab reads
  `memory/dialogues/*.md` per-agent workspace, with Agent → Date → Dialogue hierarchy in the
  sidebar and markdown-rendered detail pane. Two new gateway RPCs: `dialogues.list` and
  `dialogues.get`. Distinct from the existing "Sessions" tab (renamed from "History"), which
  continues to manage active sessions from `sessions.json`.
- **Quick settings card redesigned** with hierarchical cognitive toggles (master +
  洞察推送 / 技能进化 / 纠错记忆 / 画像建模), and surfaced three previously hidden
  token-consuming features: 记忆整合 (consolidation), 会话记忆归档 (session-memory hook),
  and 压缩前记忆冲刷 (memory flush, now default-off).
- **Cognitive identity system** (`src/cognitive/identity.ts`): unified, channel-agnostic
  `resolveCognitiveUserId()`. Control UI, TUI, and mobile clients map to a single `operator`
  identity; group sessions are correctly excluded from per-user profiles. The old `ou_`-prefix
  assumption is gone — any channel (feishu, wechat, future) works.
- **dmScope adaptive** (`src/routing/session-key.ts`): `dmScope` auto-promotes from `"main"` to
  `"per-peer"` when any channel has credentials configured, giving per-user session isolation
  with zero config.
- **Live model discovery**: providers fetch their real model list (models.dev cache + per-provider
  fetchers) and merge into the catalog with a 12h disk cache, so new models show up without a
  release. Discovery `modelOverrides` are injected into `models.json`.
- **Unified heartbeat insight delivery**: proactive insights now route through the heartbeat runner
  for **all** channels (feishu, Control UI, TUI) instead of per-channel special-casing. Wake
  heartbeats render in Control UI without a refresh.

### Changes

- i18n: locale-aware CLI, cognitive prompts, wizard, and agent tools — auto-detects `LANG` /
  `LC_ALL` / `KAIJIBOT_CLI_LOCALE`, switches between Chinese and English.
- Gateway: `X-KaijiBot-Session-Reset` HTTP header triggers the session-memory hook via the API,
  so non-message reset paths still capture summaries and corrections.
- Memory: chunk dialogue files at turn boundaries and default to Porter stemming for better
  full-text search recall.
- Memory: `appendToMemoryFile` dep now accepts a `localDateStr` string to avoid UTC/local
  off-by-one when routing consolidated summaries to the correct daily file. Previously the
  route layer computed local date but the dep impl used `toISOString()` (UTC), causing the
  section header and target file to disagree at certain timezones.
- Cognitive: new `cognitive.correction.enabled` config key (default `true`) gates the
  correction pipeline in three locations: `get-reply-run.ts` (CorrectionStore load),
  `session-memory` hook (post-session extraction), and `kaijibot-tools.ts`
  (`record_correction` agent tool registration). Surfaces as the "纠错记忆" sub-toggle.
- Branding: replaced inherited OpenClaw lobster icons with the KaijiBot K logo; filter evolution
  signals out of chat history.

### Fixes

- `resolveCognitiveUserId` now rejects cron/heartbeat/subagent session keys so background runs
  never pollute a real user's persona.
- Evolution/insight heartbeats no longer trigger the daily session reset.
- Wake-heartbeat replies are now visible in Control UI immediately (covered by tests).

---

## 2026.6.x — Provider migration, Android, Kindle Portal, knowledge-wiki

### Highlights

- **pi-ai 0.65.2 → 0.79.4 + TypeBox migration**: AJV/JSON Schema validators replaced with
  TypeBox across the runtime, unifying compile-time and run-time types. Also renamed upstream
  packages to `kaijibot` and resolved all resulting type errors.
- **Android / Termux**: full Termux compatibility with `sharp` WASM32 fallback, Chromium path
  detection, zero-interaction install + `.bashrc` autostart, and a **KaijiBot Launcher APK** that
  bundles Termux for one-tap install (no download needed).
- **Knowledge Wiki** (refactored from `memory-wiki`): Karpathy-style LLM Wiki with per-agent
  vault isolation, relationship rendering as wikilinks, claim/evidence fields, and
  freshness-weighted search. Enabled by default.
- **Feishu QR-scan auto-create bot**: `kaijibot onboard` supports scanning a QR code to create
  the feishu bot in ~10 seconds via `lark.registerApp` (SDK 1.60 → 1.66), no manual open-platform
  work needed. Wizard now validates LLM provider keys (ZAI/DeepSeek/Qwen/Anthropic/Google) with a
  non-blocking warning.
- **Kindle Portal extension**: agent state monitor and cognitive map rendered for Kindle e-ink
  displays — inline SVG map, quota bars, force-directed knowledge graph, all-agents view.
- **WeChat channel**: iLink Bot port with QR login, long-poll, and CDN media encryption.

### Changes

- Control UI: complete theme system (6 variants), model favorites with per-provider collapsible
  groups, unified settings layout, provider → endpoint → API key → model hierarchy.
- Live model discovery wired into the catalog with a 12h provider disk cache.
- 15 LLM provider extensions synced from upstream OpenClaw; auth keys broadcast to all agent dirs.
- Plugin SDK: 6 missing test entrypoints added for extension tests; 13 missing plugin-sdk subpath
  barrels added earlier for upstream extension compatibility.
- `generate-text` seam added to plugin SDK for LLM access from extensions.
- Dialogue archive with compaction-safe staging.
- MBTI Soul preset migrated from global to per-agent config.
- One-command release script (`scripts/release.sh`): build → publish → tag → push.
- `create-portable-usb.sh` one-command USB installer builder.

### Fixes

- Windows dual-gateway race condition fixed by porting OpenClaw restart infrastructure.
- Feishu streaming-card reliability improvements ported from `openclaw-lark`.

---

## 2026.5.x — Correction self-evolution, consolidation engine, upstream port

### Highlights

- **Correction self-evolution** (`src/cognitive/correction/`): dual-path detection (agent
  self-report via `record_correction` + post-session LLM extraction on `/new`/`/reset`),
  `CorrectionStore` with Jaccard-based dedup and reinforcement (TTL 90d, max 50, threshold 0.6),
  injected into every turn's system prompt via `context-writer.ts`.
- **Memory consolidation engine**: daily cron (`0 3 * * *`) scans session transcripts, LLM extracts
  structured knowledge (domain_knowledge / behavioral_pattern / stated_preference /
  goal_or_aspiration), Jaccard dedup, routes to PersonaStore / FragmentStore / CorrectionStore +
  MEMORY.md inline sections. Replaces OpenClaw's dreaming system.
- **Per-agent isolation** for persona, fragment, correction, and evolution stores
  (`cognitive/{subsystem}/{agentId}/{userId}.json`).
- **Self-evolution hard-trigger**: post-turn hook detects ≥3 tool calls (noise filter only),
  enqueues an evolution signal for the agent to evaluate — no code-level complexity gating.
- **OpenClaw → KaijiBot migration** (`kaijibot migrate`): auto-detect OpenClaw install, import
  agents/workspace/skills/config with dry-run support, workspace `.md` content rewriting, onboard
  wizard integration.

### Changes

- Upstream port — Tier 1 (11 low-conflict items) + Tier 2 batches (silent-error retry, proxy crash
  fix, Anthropic unsafe integers, per-model transport override, feishu subagent delivery).
- Native module loader: `.js` plugins use native `require` fast path, `.ts` falls back to jiti.
- Consolidation runtime wiring + agent isolation + MEMORY.md structural repair in daily pipeline.
- Epsilon-greedy exploration promotion in the scheduler resolve loop.
- MBTI Soul preset system (CLI, agent tool, first-conversation guidance).
- Evolution: domain/mode bandit penalties on no-response + content strategy rotation; implicit
  feedback signal chain fix; bandit-weighted mode selection.
- Evolution: LLM draft generator wired into tools for higher-quality skill suggestions; skill patch,
  trial-error trigger, dedup + expiry lifecycle.
- Control UI: complete "涌" redesign — rich sidebar, chip inputs, cognitive status, mobile deck-bar.
- `@larksuite/cli` integrated as a bundled dependency with auto-disable + multi-profile support;
  lark-cli skills auto-installed after update; lark-cli bin dir injected into PATH at gateway startup.
- Feishu streaming-card reliability ported from `openclaw-lark`.
- Topic registry + LLM topic router + semantic merge in the memory system.
- Insight diagnostic logging: pattern fallback, contradicted verification, empty web match,
  parse-failed raw output.
- 35+ LLM provider extensions integrated.

### Fixes

- Migration: MEMORY.md truncation removed, multi-agent sessions supported, path rewriting,
  archived sessions, bindings warning, workspace validation.
- Empty heartbeat LLM calls + transient isolated sessions skipped.

---

## 2026.4.x — Fork origin: cognitive layer foundation

KaijiBot forked from OpenClaw and immediately began adding the cognitive layer — the project's
core differentiator. This milestone established persona, proactive insight generation,
self-evolution, and the memory overhaul.

### Highlights

- **Persona system** (`src/cognitive/persona/`): two-layer per-agent × per-user architecture.
  LLM-driven structured extraction with `TypedInsight` (6 categories: domain_knowledge,
  behavioral_pattern, stated_preference, tool_config, contextual_fact, goal_or_aspiration),
  category-aware decay (`HALF_LIFE_BY_CATEGORY`), interest lifecycle (emergent → stable →
  declining → dormant → revived), dynamic domain discovery via LLM (no hardcoded keywords).
- **Proactive insight pipeline** (`src/cognitive/insight/`): PRISM cost-sensitive gate + SIRI
  search-identify-resolve loop. Unified pipeline with contrastive dedup, LLM self-refine loop
  (critique → rewrite), LLM-as-judge verification, semantic freshness check. Web search results
  serve as supporting evidence. Pattern mode mines behavioral patterns from FragmentStore clusters.
- **Self-evolution** (`src/cognitive/evolution/`): agent-driven skill generation with embedded
  skill-creator spec, `SKILL.md` output, skill patch/delete/archive lifecycle, dedup
  (Levenshtein + Jaccard), 30-day expiry, effectiveness tracking.
- **Brand identity**: KaijiBot palette, banner, wizard, Control UI. 🦞 → 🧠.

### Changes

- Dual insight pipeline (v1 + v2) with blind-spot detection, source tracking, observability logging.
- Insight quality: temperature 1.0, silent web folding, dynamic anti-repetition, random prompts,
  template fallback removed, persona-driven delivery format.
- Web search integrated into insight generation (Exa + Tavily providers); promoted to
  `EXTERNAL_FACTS` block.
- Epsilon-greedy exploration promotion; domain/mode bandit penalties; content strategy rotation.
- Per-agent + per-user persona isolation; flat → directory migration on gateway boot.
- Scheduler: 2-hop cross-domain connections, exploration verification bypass, domain cooldown,
  random jitter for human-like timing, 30min proactive default, local client IDs filtered.
- Memory P0+P1 quality overhaul: classification, dedup, verification, pruning.
- Memory Wave 0 foundation: topic types, topic manager, MEMORY.md index manager.
- Evolution: error-driven trigger (tool errors/retries lower threshold); feishu space manager.
- Cognitive config: Chinese labels and help text for all 37 cognitive fields.
- Agent capabilities section in system prompt for self-introduction.
- MCP config tool for managing server configurations; auto-inject `node_modules/.bin` into exec PATH.
- Default tools profile changed from `coding` to `full`.
- Web UI: 4-tab mobile-first layout, then redesigned with agent dashboard and visual config.

### Fixes

- Persona pollution prevention (bot self-description no longer pollutes user persona).
- Insight repetition root causes (5 fixes), domain monopoly, resolve dedup, fragment thresholds.
- Cluster thresholds relaxed; domain-aware fragment dedup; `domainGraph` passed to
  cross-domain connections; trigram dedup after LLM generation.
- Insight JSON repair, verification gate, correct `minInterval` fallback.
- Cognitive-insight classified as wake heartbeat reason to bypass `HEARTBEAT.md` gate.
- Dynamic multi-user proactive scheduler with correct session routing.
- `dmScope` defaulted to per-channel-peer; legacy feishu sessions migrated.
