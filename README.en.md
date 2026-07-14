# KaijiBot 👾

> **Your AI assistant reaches out to you — not the other way around.**

Pluggable provider/channel architecture · Cognitive layer turns AI from reactive to proactive · 40+ LLM providers · 17+ messaging channels · Auto locale switching (EN/zh)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >=22](https://img.shields.io/badge/Node.js-%3E%3D22-339933.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6.svg)](https://www.typescriptlang.org/)

[English](./README.en.md) | [简体中文](./README.md)

## Why KaijiBot

Every AI assistant you've used follows the same pattern: you ask, it answers. You stop asking, it goes silent.

KaijiBot is different. After a few conversations on Feishu / Telegram / Discord, it starts **reaching out to you** proactively — not with spam or hydration reminders, but with things you'd actually find interesting.

|                        | Typical Chatbot                        | KaijiBot                                                                             |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| **Interaction**        | Reactive — you ask, it answers         | Proactive insights + normal Q&A                                                      |
| **User Understanding** | Stateless, starts from zero every time | Continuously learns your interests, domains, preferences                             |
| **Timing Awareness**   | Doesn't care what you're doing         | Respects active hours, trust level, conversation cadence                             |
| **Chinese Support**    | English-first, Chinese often breaks    | Chinese-native: pattern routing, persona extraction optimized for Chinese            |
| **Localization**       | UI hardcoded in one language           | CLI / wizard / cognitive prompts auto-detect system locale, switch between EN and zh |
| **Integration**        | Requires Web/SDK integration           | Feishu · Telegram · Discord · WeChat · Slack and 17+ channels                        |

## ✨ Core Features

### 🔮 Cognitive Engine — From Reactive Replies to Proactive Insights

You've been chatting with KaijiBot on Feishu / Telegram about AI architecture and distributed systems. Next week, it sends you a message unprompted:

> "Saw a recent article on using eBPF for distributed tracing — combining it with the observability direction you've been exploring, this might spark some ideas."

This isn't a scheduled push. It's a genuine insight KaijiBot produced after **understanding you**.

Two weeks later, you bring up Rust and embedded systems. One day it tells you:

> "You've been learning Rust, and you previously showed interest in embedded systems. There's a hands-on article on writing an RTOS kernel in Rust at the intersection of these two — worth a look."

How it works:

- **Persona Profiling** — Every conversation teaches it something new. LLM-driven structured extraction automatically discovers domains and interests from conversations. Insights decay by category independently. Interest lifecycle is tracked automatically. Domain names discovered dynamically by LLM — no hardcoded keywords.
- **Cross-Domain Insights** — You're interested in both A and B, it finds potential connections. You asked about something before but didn't dig deeper, it follows up from a new angle. You've gone deep enough in one area, it suggests extension directions. LLM self-refine loop ensures quality, semantic dedup ensures every push is fresh.
- **Timing Gate** — It doesn't push whenever it feels like it. The PRISM model calculates expected value for each insight. Only pushes when expected benefit exceeds interruption cost. No late-night打扰, restraint during low trust, waits if you've been inactive.
- **Trust Evolution** — Cautious at first, understands you better over time, eventually becomes a confident partner who can make bold recommendations. SARA framework drives four-stage trust evolution. Trust level determines what the system is allowed to do.
- **Preference Learning** — You wrote a long reply? It notes you like this topic. You gave a one-word response? It tries a different direction next time. Thompson Sampling-driven preference learning. Implicit feedback is more honest than explicit feedback.

Insight content is generated from your profile + LLM knowledge + real-time web search. With a search API key, insights stay current.

### 🧬 Self-Evolution — Agent Decides When to Learn New Skills

You've done several complex Feishu knowledge base operations with KaijiBot — searching meeting records, extracting minutes, creating documents, setting tasks. KaijiBot notices this workflow is repetitive and complex, and tells you:

> "I noticed you've been doing similar meeting minute archiving workflows recently. I wrote myself a skill — next time you say 'archive meetings', I'll execute the entire flow automatically."

How it works:

- **Hard Trigger Detection** — Code does noise filtering only, no quality judgments. After detecting complex tasks, a system event is injected.
- **Agent-Driven Decision** — The Agent has full conversation context and decides whether it's worth creating a skill. Not worth it? Ignored.
- **Full Lifecycle** — Dedup check before creation, usage frequency tracking after, auto-cleanup for unused skills.

### 🔄 Correction Self-Evolution — Never Makes the Same Mistake Twice

AI assistant making the same mistake every new session? KaijiBot won't. It has a correction memory system that ensures every mistake is made at most once.

- **Dual-Path Detection** — Agent self-reports errors, or the system automatically extracts corrections from conversations at session end.
- **Dedup + Reinforcement** — Repeated errors don't create new records; they increase weight, ensuring high-frequency issues get priority.
- **System Prompt Injection** — Corrections are injected into the system prompt that the Agent sees every turn, rather than in files that may not be read.

Step into a pit once. That's enough.

### 🔌 Pluggable Architecture

Not locked into any single provider. Switch between domestic and international at will. `kaijibot onboard` wizard auto-discovers configured API keys.

| China                                          | International                                   | Aggregator / Self-hosted                           |
| ---------------------------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| DeepSeek · Qwen · Kimi · MiniMax · Zhipu GLM … | Claude · Gemini · Grok · Mistral · Perplexity … | OpenRouter · Together · Ollama · LMStudio · vLLM … |

Switch models with a single command:

```bash
kaijibot config set agent.model "deepseek/deepseek-chat"
kaijibot config set agent.model "anthropic/claude-sonnet-4-20250514"
```

### 🌐 Auto Locale Switching (EN / zh)

CLI output, onboarding wizard, and cognitive layer prompts all switch automatically based on system language:

- **CLI** — Detects `LANG` / `LC_ALL` environment variables. Banner, help text, command descriptions, wizard dialogue all switch between English and Chinese.
- **Cognitive Layer** — Based on `preferredLanguage` in the user's Persona, insight generation prompts, correction injection, and evolution signals are all locale-aware.
- **Docs** — Automated translation pipeline for 13 languages (zh / ja / ko / es / pt-BR / de / fr / ar / it / tr / uk / id / pl).

```bash
export LANG=en_US.UTF-8   # English
export LANG=zh_CN.UTF-8   # Chinese
# Or override explicitly:
export KAIJIBOT_CLI_LOCALE=en
```

### 🛠️ Full Agent

**Agent Loop**: Reason → Call tools → Observe → Continue reasoning. Supports streaming, context compression, parallel sub-agent dispatch. Built-in tools include code execution, web scraping, PDF operations, image/video/music generation, TTS synthesis, Canvas, and more.

**Memory System**: Multiple storage backends with semantic search over conversation history. Three complementary systems maintain Agent context: session memory, daily consolidation, and manual organization.

**Skill Marketplace**: Dozens of built-in skills (github, weather, summarize, coding-agent, notion, obsidian, taskflow, and more). Install additional skills from ClawHub:

```bash
kaijibot skills install <skill-name>
```

## 🚀 Quick Start

### One-click install (recommended — auto-detects environment, installs dependencies, runs onboard wizard)

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/Kaiji-Z/kaijibot/main/scripts/install.sh | bash
```

**Windows (PowerShell):**

```powershell
iwr -useb https://raw.githubusercontent.com/Kaiji-Z/kaijibot/main/scripts/install.ps1 | iex
```

### npm

```bash
npm install -g kaijibot
kaijibot onboard
```

### Docker

Using the Docker setup script (recommended — handles image build and env config):

```bash
git clone https://github.com/Kaiji-Z/kaijibot.git
cd kaijibot
bash scripts/docker/setup.sh
```

Or manual:

```bash
git clone https://github.com/Kaiji-Z/kaijibot.git
cd kaijibot
docker build -t kaijibot:local .
# Create .env (see .env.example), at minimum:
#   ZAI_API_KEY=your-key
#   KAIJIBOT_GATEWAY_TOKEN=your-token
#   KAIJIBOT_CONFIG_DIR=~/.kaijibot
#   KAIJIBOT_WORKSPACE_DIR=~/.kaijibot/workspace
docker compose up -d
```

### Build from Source

```bash
git clone https://github.com/Kaiji-Z/kaijibot.git
cd kaijibot
pnpm install
pnpm build
kaijibot onboard   # Interactive wizard, auto-configures
# Migrating from OpenClaw? Run:
kaijibot migrate
```

### Start

```bash
kaijibot gateway --port 18789 --verbose
```

## ⚙️ Configuration

**Required**: At least one LLM provider API key + at least one messaging channel credential.

```bash
# LLM API Key — pick one provider, uncomment the corresponding line
# export DEEPSEEK_API_KEY="your-key"         # DeepSeek
# export ANTHROPIC_API_KEY="your-key"        # Claude
# export GOOGLE_API_KEY="your-key"           # Gemini
# export ZAI_API_KEY="your-key"              # Zhipu GLM

# Feishu channel
kaijibot config set channels.feishu.appId "your-app-id"
kaijibot config set channels.feishu.appSecret "your-app-secret"
```

**Optional**: Web search to enhance insight timeliness.

```bash
export EXA_API_KEY="your-key"
export TAVILY_API_KEY="your-key"
```

Config file at `~/.kaijibot/kaijibot.json`, supports hot reload. Cognitive system can be disabled via `cognitive.enabled: false`. For detailed configuration, see `AGENTS.md`.

## 🏗️ Relationship with OpenClaw

KaijiBot was originally forked from [OpenClaw](https://github.com/openclaw/openclaw) (the general-purpose AI agent ranked #1 globally on OpenRouter by token consumption, 382K+ GitHub stars), but has evolved into an independent project. **KaijiBot does three things, not just "OpenClaw + cognitive layer"**:

### 1. Hardened and simplified the base

OpenClaw is a massive project built for a global, multi-channel, multilingual audience. KaijiBot consolidates the base layer on top of it:

- **Type system modernization** — migrated from AJV/JSON Schema validators to TypeBox, unifying runtime and compile-time types
- **Dependency tracking** — pi-ai SDK 0.65.2→0.79.4, keeping pace with the LLM abstraction layer's rapid evolution
- **Code quality cleanup** — fixed 1220 pre-existing lint errors inherited from upstream (across 191 files)
- **Critical bug fixes** — resolved upstream issues like the Windows dual-gateway race condition and Android rendering crashes
- **Plugin SDK completion** — backfilled 13 missing plugin-sdk subpath barrels from upstream
- **Native module loading** — `.js` plugins take the native `require` fast path, `.ts` falls back to jiti

### 2. Rewrote the memory layer

OpenClaw's original "dreaming"-style memory consolidation was replaced with a **memory consolidation engine**:

- Daily cron scans historical sessions, LLM extracts structured knowledge (domain knowledge, behavioral patterns, preferences, goals)
- Jaccard deduplication prevents redundant entries from accumulating
- Routes to `PersonaStore` / `FragmentStore` / `CorrectionStore` + MEMORY.md inline sections
- Category-aware routing (domain_knowledge / behavioral_pattern / stated_preference / goal_or_aspiration) → different inline sections
- MEMORY.md 8KB budget auto-balancing — high-frequency content inlined, low-frequency content kept as pointers

### 3. Added the cognitive layer (KaijiBot's differentiator)

- **Persona profile system** — TypedInsight 6 categories + category-aware decay half-lives
- **Proactive insight generation** — PRISM cost-sensitive gate + SIRI search-identify-resolve loop
- **Self-evolution** — Agent-driven skill generation (code layer does noise filtering only; the Agent judges value)
- **Correction self-evolution** — dual-path detection (Agent self-report + post-session LLM extraction) + Jaccard dedup + system prompt injection
- **Interest lifecycle** — emergent → stable → declining → dormant → revived

> Want a slimmed-down OpenClaw experience? Set `cognitive.enabled: false` in config to disable the entire cognitive layer, falling back to the "hardened base + rewritten memory layer" state — which is already a step beyond upstream OpenClaw in memory and stability.

KaijiBot continuously syncs critical fixes and architectural improvements from upstream (see the `sync from upstream OpenClaw` commit series in git history). If you only want the OpenClaw base + improved memory layer without the cognitive layer, that's a fully supported usage.

## Acknowledgments

KaijiBot stands on the shoulders of [OpenClaw](https://github.com/openclaw/openclaw) (built by Peter Steinberger and the community). OpenClaw provides the Gateway architecture, Plugin SDK boundaries, agent loop, multi-channel integrations, and a complete tool ecosystem — these are the foundation that lets KaijiBot focus on the cognitive layer.

### Academic Research

The cognitive system design draws on the following research:

**Foundational Theory**

- Green, D. M., & Swets, J. A. (1966). _Signal detection theory and psychophysics_. Wiley.
- Thompson, W. R. (1933). On the likelihood that one unknown probability exceeds another in view of the evidence of two samples. _Biometrika_, 25(3/4), 285–294.
- Altman, I., & Taylor, D. A. (1973). _Social penetration: The development of interpersonal relationships_. Holt, Rinehart & Winston.
- Gentner, D. (1983). Structure-mapping: A theoretical framework for analogy. _Cognitive Science_, 7(2), 155–170.

**Human-Computer Relationships & Recommender Systems**

- Bickmore, T. W., & Picard, R. W. (2005). Establishing and maintaining long-term human-computer relationships. _ACM Transactions on Computer-Human Interaction_, 12(2), 293–327.
- Kotkov, D., Wang, S., & Veijalainen, J. (2016). A survey of serendipity in recommender systems. _Knowledge-Based Systems_, 111, 180–192.

**LLM Persona & Memory**

- DEEPER: Directed Persona Refinement. (2025). _Proceedings of ACL 2025_. 32.2% error reduction via active contradiction resolution in persona maintenance.
- PERSONAMEM: Persona-Aware Memory in LLMs. (2025). _Proceedings of COLM 2025_. Benchmark showing LLMs achieve ~50% accuracy on evolving profile tasks.
- DV365: Dynamic User Representations over 365 Days. (2025). _Proceedings of KDD 2025_. Instagram's multi-slicing user embedding architecture.
- GemiRec: Gemini-Powered Recommendations. (2025). Xiaohongshu's multi-interest vector architecture with codebook quantization.
- PIE: Personalized Interest Exploration. (2023). _Proceedings of WWW 2023_. Personalized PageRank with bandit exploration.
- ProfiLLM: Fully Implicit User Profiling from Chatbot Interactions. (2025).

### Open Source Dependencies

[Feishu Open Platform](https://open.feishu.cn/), [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/), [tsdown](https://github.com/nicepkg/tsdown), [Zod](https://zod.dev/).

## License

[MIT](LICENSE)
