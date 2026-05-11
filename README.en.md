# KaijiBot 👾

> **Your AI assistant reaches out to you — not the other way around.**

Fork of [OpenClaw](https://github.com/openclaw/openclaw) · Feishu + 30+ LLM Providers · Cognitive Layer Turns AI from Reactive to Proactive

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >=22](https://img.shields.io/badge/Node.js-%3E%3D22-339933.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6.svg)](https://www.typescriptlang.org/)
[![Vitest 450+ tests](https://img.shields.io/badge/Vitest-450%2B%20tests-6DA55F.svg)](https://vitest.dev/)

**README** | **English** | [简体中文](./README.md)

## Why KaijiBot

Every AI assistant you've used follows the same pattern: you ask, it answers. You stop asking, it goes silent.

KaijiBot is different. After a few conversations on Feishu, it starts **reaching out to you** proactively — not with spam or hydration reminders, but with things you'd actually find interesting.

| | Typical Chatbot | KaijiBot |
|---|---|---|
| **Interaction** | Reactive — you ask, it answers | Proactive insights + normal Q&A |
| **User Understanding** | Stateless, starts from zero every time | Continuously learns your interests, domains, preferences |
| **Timing Awareness** | Doesn't care what you're doing | Respects active hours, trust level, conversation cadence |
| **Chinese Support** | English-first, Chinese often breaks | Chinese-native: pattern routing, persona extraction optimized for Chinese |
| **Integration** | Requires Web/SDK integration | Feishu is the terminal — just send a message |

## ✨ Core Features

### 🔮 Cognitive Engine — From Reactive Replies to Proactive Insights

You've been chatting with KaijiBot about AI architecture and distributed systems. Next week, it sends you a message unprompted:

> "Saw a recent article on using eBPF for distributed tracing — combining it with the observability direction you've been exploring, this might spark some ideas."

This isn't a scheduled push. It's a genuine insight KaijiBot produced after **understanding you**.

Two weeks later, you bring up Rust and embedded systems. One day it tells you:

> "You've been learning Rust, and you previously showed interest in embedded systems. There's a hands-on article on writing an RTOS kernel in Rust at the intersection of these two — worth a look."

How it works:

- **Persona Profiling** — Every conversation teaches it something new. LLM-driven structured extraction automatically discovers domains and extracts 6 categories of typed insights (domain knowledge, behavioral patterns, preferences, tool configs, contextual facts, goals/aspirations) into your profile. Insights decay by category (behavioral patterns 60 days, tool configs 180 days). Interest lifecycle tracking: emergent → stable → declining → dormant → revived. Domain names discovered dynamically by LLM — no hardcoded keyword tables.
- **Cross-Domain Insights** — You're interested in both A and B, it finds potential connections. You asked about something before but didn't dig deeper, it follows up from a new angle. You've gone deep enough in one area, it suggests extension directions. Domains linked via co-occurrence graphs (2-hop indirect connections supported), with edge decay. Domain cooldown prevents short-term repeated recommendations. LLM self-refine loop (generate → critique → rewrite) ensures quality. Contrastive anti-dedup framework ensures every push differs from history. Semantic freshness check blocks semantically repetitive content.
- **Timing Gate** — It doesn't push whenever it feels like it. The PRISM model (based on signal detection theory) calculates expected value for each insight. Only pushes when expected benefit exceeds interruption cost. No late-night打扰, restraint during low trust, waits if you've been inactive.
- **Trust Evolution** — Cautious at first, understands you better over time, eventually becomes a confident partner who can make bold recommendations. Four stages (SARA framework): orientation → exploration → rapport → partnership. Trust level determines what the system is allowed to do.
- **Preference Learning** — You wrote a long reply? It notes you like this topic. You gave a one-word response? It tries a different direction next time. Each topic maintains Thompson Sampling parameters (Beta distribution). Implicit feedback (reply depth, response latency) is more honest than explicit feedback.

Insight content is generated from your profile + LLM knowledge + real-time web search. With an Exa or Tavily API key, insights stay current.

### 🧬 Self-Evolution — Agent Decides When to Learn New Skills

You've done several complex Feishu knowledge base operations with KaijiBot — searching meeting records, extracting minutes, creating documents, setting tasks. KaijiBot notices this workflow is repetitive and complex, and tells you:

> "I noticed you've been doing similar meeting minute archiving workflows recently. I wrote myself a skill — next time you say 'archive meetings', I'll execute the entire flow automatically."

Or it quietly learns and casually mentions it days later.

How it works:

- **Hard Trigger Detection** — Code does one thing: detect 3+ tool calls in a conversation (noise filter). No LLM calls, no quality judgments.
- **Agent-Driven Decision** — After detection, a system event is injected (with tool sequence and error info), triggering an Agent turn. The Agent has full conversation context and decides whether it's worth creating a skill. Not worth it? Ignored.
- **No Cooldown, No Cap** — No code-level rate limits or complexity thresholds. The Agent sees recent suggestion history and decides frequency itself. If it feels frequent but genuinely worthwhile, it silently creates the skill and mentions it at a natural moment.
- **Full Lifecycle** — Dedup check before creation, usage frequency tracking after, 30-day auto-cleanup for unused skills.

### 🔄 Correction Self-Evolution — Never Makes the Same Mistake Twice

Ever had an AI assistant make the same mistake every new session? Like always trying to create a blank Feishu document, getting corrected, then doing it again next session?

KaijiBot doesn't do that. It has a correction memory system that ensures every mistake is made at most once.

How it works:

- **Dual-Path Detection** — Path A: the Agent catches its own error and reports via `record_correction` tool. Path B: when you run `/new` or `/reset`, the system pre-screens with 60 regex patterns (covering Chinese/English corrections, questioning tone, agent apologies), then passes matching transcripts to LLM for structured extraction.
- **Jaccard Dedup + Reinforcement** — Corrections stored in `~/.kaijibot/cognitive/corrections/{userId}.json`. Jaccard similarity determines if a new error duplicates an existing record. Duplicates don't create new entries — they increment `reinforcedCount`, signaling this mistake keeps recurring and deserves higher priority. Max 50 per user, 90-day TTL.
- **System Prompt Injection** — This is the key design. Corrections are injected into the system prompt's "Known Corrections" section, sorted by reinforcement count, up to 15 entries. The Agent sees them every single turn. Why not put them in skill files or MEMORY.md? Because skills aren't always loaded, MEMORY.md is only read at startup — only the system prompt is guaranteed to be visible every turn.

Step into a pit once. That's enough.

### 🔌 62 Extensions Out of the Box

Not locked into any single provider. Switch between domestic and international at will. `kaijibot onboard` wizard auto-discovers configured API keys.

| China (Recommended) | International | Aggregator / Self-hosted |
|---|---|---|
| Zhipu GLM · DeepSeek · Qwen · Kimi · MiniMax · Baidu Qianfan · StepFun · Volcengine · BytePlus · Kimi Coding · Xiaomi · Alibaba | Claude · Gemini · Grok · Mistral · Perplexity · Groq · Nvidia · HuggingFace · OpenAI | OpenRouter · LiteLLM · Together · Fireworks · Cloudflare AI · Vercel AI · SGLang · vLLM · Ollama · LMStudio |

Switch models with a single command:

```bash
kaijibot config set agent.model "deepseek/deepseek-chat"
kaijibot config set agent.model "qwen/qwen-max"
kaijibot config set agent.model "anthropic/claude-sonnet-4-20250514"
```

### 🛠️ 21 Built-in Skills + Full Agent

**Agent Loop**: Reason → Call tools → Observe → Continue reasoning. Supports streaming, context compression, parallel sub-agent dispatch.

**Built-in Tools**: Code execution, web scraping, PDF operations, image/video/music generation, TTS synthesis, Canvas, file I/O, cron scheduling — 20+ total. Supports model failover and API key rotation.

**Memory System**: Three storage backends (in-memory, LanceDB vector store, Wiki knowledge base). Semantic search over conversation history. Periodic memory consolidation (similar to human sleep-based memory processing). Short-term important info auto-promoted to long-term knowledge. Dream system stores separately, doesn't pollute daily memory files. Session memory: `/new` or `/reset` triggers LLM structured summary generation (technical concepts, errors & fixes, key decisions, topic classification), written to daily journal and routed to topic files. Feishu message metadata stripped during extraction. 16K character budget covers full conversations.

**Scheduled Tasks**: `at` (one-shot), `every` (interval), `cron` (cron expression + timezone). Supports message delivery, webhook callbacks, or silent execution. Auto-retry on failure.

**Skill Marketplace**: github, weather, summarize, coding-agent, notion, obsidian, nano-pdf, taskflow, blogwatcher — 21 built-in skills, with more available from ClawHub:

```bash
kaijibot skills install <skill-name>
```

## 🚀 Quick Start

**Prerequisites**: Node.js >= 22 (24 recommended), pnpm, git

**Option 1: One-Click Install**

```bash
curl -fsSL https://raw.githubusercontent.com/Kaiji-Z/kaijibot/main/install.sh | bash
```

**Option 2: Docker**

```bash
git clone https://github.com/Kaiji-Z/kaijibot.git
cd kaijibot
docker compose up -d
```

**Option 3: Manual Install**

```bash
git clone https://github.com/Kaiji-Z/kaijibot.git
cd kaijibot
pnpm install
pnpm build
kaijibot onboard   # Interactive wizard, auto-configures (detects OpenClaw and prompts migration)
# Migrating from OpenClaw? Run:
kaijibot migrate
```

**Start**

```bash
kaijibot gateway --port 18789 --verbose
```

After starting, find your bot on Feishu and send a message. KaijiBot automatically begins building your cognitive profile and will push the first proactive insight after a few conversations.

## ⚙️ Configuration

**Required**: At least one LLM provider API key + Feishu bot credentials.

```bash
# LLM API Key (pick one, configure for the model you use)
export ZAI_API_KEY="your-key"              # Zhipu GLM
# export DEEPSEEK_API_KEY="your-key"       # DeepSeek
# export DASHSCOPE_API_KEY="your-key"      # Qwen
# export MOONSHOT_API_KEY="your-key"       # Kimi
# export ANTHROPIC_API_KEY="your-key"      # Claude
# export GOOGLE_API_KEY="your-key"         # Gemini

# Feishu channel
kaijibot config set channels.feishu.appId "your-app-id"
kaijibot config set channels.feishu.appSecret "your-app-secret"
```

**Optional**: Web search to enhance insight timeliness.

```bash
export EXA_API_KEY="your-key"
export TAVILY_API_KEY="your-key"
```

Config file at `~/.kaijibot/kaijibot.json`, supports hot reload. Cognitive system can be disabled via `cognitive.enabled: false` to fall back to pure OpenClaw experience.

## 🏗️ Architecture

### Cognitive Insight Pipeline

```
Event Sources (timer + random jitter / persona change / info scan)
  → PRISM Gate (pNeed × pAccept > cost threshold?)
    → Search Insight Opportunities (cross-domain / domain depth / 3-mode exploration)
      → Domain Cooldown + Starvation Boost → Pick Best Opportunity
        → Semantic Freshness Check (LLM judges if semantically duplicate with recent insights)
          → Unified Pipeline (mode routing via timestamp % 100):
              Knowledge Mode (40%): Web search + LLM → Self-refine (critique→rewrite) → Quality retries → LLM verification
              Pattern Mode (50%): Dialog fragment clustering → LLM behavioral insight → Partial verification
              Extend Mode (10%): Known user domains → LLM depth suggestions
            → Contrastive Anti-dedup + Safety-net Trigram Dedup
              → Deliver to your Feishu conversation
                → Collect Feedback → Thompson Sampling updates preference model
```

### Self-Evolution Pipeline

```
Agent completes task (≥3 tool calls)
→ Code detects ≥3 tool calls (noise filter, no LLM call)
→ Inject system event directly → Trigger Agent turn
      → Agent sees full conversation context + recent suggestion history
        → Worth making a skill? → Generate skill draft → Ask user or silently create
        → Not worth it? → Ignore
        → Frequent but worthwhile? → Silently create, mention later
```

### Correction Self-Evolution Pipeline

```
Dual-Path Detection
  Path A: Agent self-report (record_correction tool)    Path B: Post-session LLM extraction (/new or /reset)
              ↓                                              ↓
        CorrectionStore.addOrReinforce (Jaccard dedup + reinforcement)
              ↓
        ~/.kaijibot/cognitive/corrections/{userId}.json
              ↓
        Next conversation → context-writer injects into system prompt
              ↓
        Agent sees historical corrections → Avoids repetition
```

### Technical Architecture

Gateway provides WebSocket + HTTP dual protocol, 100+ RPC methods, compatible with OpenAI API (`/v1/chat/completions`) and MCP protocol. Plugin SDK supports 20+ lifecycle hooks. Extensions loadable via npm packages, Git repos, or bundled. Sessions isolated by channel + conversation partner.

Agent system implements full reasoning loop: system prompt assembly (context files + cognitive mode + tool descriptions + memory search) → LLM reasoning → tool calls → observation → continued reasoning → streaming output. Supports context compression, parallel sub-agent dispatch, model failover, and API key rotation.

Project scale: `src/agents/` (762 files), `src/infra/` (484), `src/gateway/` (356), `src/plugin-sdk/` (341), `src/plugins/` (256), `src/cognitive/` (10+ modules).

## 📦 Extensions & Skills

**62 extensions** covering all capability layers:

| Category | Extensions |
|---|---|
| **Messaging** | feishu (Feishu/Lark) |
| **China LLMs** | Zhipu GLM · DeepSeek · Qwen · Kimi · MiniMax · Baidu Qianfan · StepFun · Volcengine · BytePlus · Kimi Coding · Xiaomi · Alibaba |
| **International LLMs** | Claude · Gemini · Grok · Mistral · Perplexity · Groq · Nvidia · HuggingFace · OpenAI |
| **Aggregators / Gateways** | OpenRouter · LiteLLM · Together · Fireworks · Cloudflare AI · Vercel AI · Copilot Proxy · Microsoft · Microsoft Foundry · Anthropic Vertex |
| **Self-hosted** | Ollama · LMStudio · SGLang · vLLM |
| **Dev Tools** | OpenCode · OpenCode-Go · Open-Prose · OpenShell · Kilocode · Arcee · Chutes · Venice · Vydra · Runway |
| **Search / Browser** | Exa · Tavily · Browser (Playwright) |
| **Memory** | Memory-Core · Memory-LanceDB · Memory-Wiki |
| **Voice / Media** | Speech-Core · Talk-Voice · Media-Understanding · Image-Generation |
| **Utilities** | Diffs · LLM-Task · Device-Pair · Webhooks · Shared · GitHub-Copilot |

**21 built-in skills**: github, gh-issues, weather, summarize, coding-agent, mcporter, skill-creator, session-logs, healthcheck, notion, obsidian, canvas, nano-pdf, taskflow, taskflow-inbox-triage, clawhub, video-frames, gifgrep, node-connect, blogwatcher, sherpa-onnx-tts.

Need more? `kaijibot skills install <name>` to install from ClawHub.

## Acknowledgments

Built on the [OpenClaw](https://github.com/openclaw/openclaw) open-source project.

### Academic Research

The cognitive system design draws on the following research:

**Foundational Theory**

- Green, D. M., & Swets, J. A. (1966). *Signal detection theory and psychophysics*. Wiley.
- Thompson, W. R. (1933). On the likelihood that one unknown probability exceeds another in view of the evidence of two samples. *Biometrika*, 25(3/4), 285–294.
- Altman, I., & Taylor, D. A. (1973). *Social penetration: The development of interpersonal relationships*. Holt, Rinehart & Winston.
- Gentner, D. (1983). Structure-mapping: A theoretical framework for analogy. *Cognitive Science*, 7(2), 155–170.

**Human-Computer Relationships & Recommender Systems**

- Bickmore, T. W., & Picard, R. W. (2005). Establishing and maintaining long-term human-computer relationships. *ACM Transactions on Computer-Human Interaction*, 12(2), 293–327.
- Kotkov, D., Wang, S., & Veijalainen, J. (2016). A survey of serendipity in recommender systems. *Knowledge-Based Systems*, 111, 180–192.

**LLM Persona & Memory**

- DEEPER: Directed Persona Refinement. (2025). *Proceedings of ACL 2025*. 32.2% error reduction via active contradiction resolution in persona maintenance.
- PERSONAMEM: Persona-Aware Memory in LLMs. (2025). *Proceedings of COLM 2025*. Benchmark showing LLMs achieve ~50% accuracy on evolving profile tasks.
- DV365: Dynamic User Representations over 365 Days. (2025). *Proceedings of KDD 2025*. Instagram's multi-slicing user embedding architecture.
- GemiRec: Gemini-Powered Recommendations. (2025). Xiaohongshu's multi-interest vector architecture with codebook quantization.
- PIE: Personalized Interest Exploration. (2023). *Proceedings of WWW 2023*. Personalized PageRank with bandit exploration.
- ProfiLLM: Fully Implicit User Profiling from Chatbot Interactions. (2025).

### Open Source Dependencies

[Feishu Open Platform](https://open.feishu.cn/), [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/), [tsdown](https://github.com/nicepkg/tsdown), [Zod](https://zod.dev/).

## License

[MIT](LICENSE)
