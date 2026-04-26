---
summary: "KaijiBot capabilities: Feishu channel, cognitive AI, routing, media, and UX."
read_when:
  - You want a full list of what KaijiBot supports
title: "Features"
---

# Features

## Highlights

<Columns>
  <Card title="Feishu Channel" icon="message-square">
    Full Feishu integration via WebSocket — group chats, DMs, rich messages, and file sharing.
  </Card>
  <Card title="Cognitive AI" icon="brain">
    Proactive insights, persona learning, cross-domain mapping, and trust evolution.
  </Card>
  <Card title="Routing" icon="route">
    Multi-agent routing with isolated sessions.
  </Card>
  <Card title="Media" icon="image">
    Images, audio, video, documents, and image/video generation.
  </Card>
  <Card title="Memory" icon="database">
    Semantic memory with LanceDB vector store and Wiki knowledge base.
  </Card>
  <Card title="Tools" icon="wrench">
    Browser automation, web search, cron jobs, skills, and plugin ecosystem.
  </Card>
</Columns>

## Full list

**Channel:**

- Feishu (飞书) — the sole messaging channel, with WebSocket long-connection and event subscription
- Group chat support with mention-based activation
- DM safety with allowlists and pairing
- Rich message types: text, images, files, interactive cards

**Cognitive AI (proactive layer):**

- **Persona system** — per-user cognitive model that learns identity, domains, interests, communication style, and mood over time; dual extraction (rule-based fast path <50ms + LLM deep path with 5s timeout); persisted at `~/.kaijibot/cognitive/persona/`
- **Proactive insights** — cross-domain discovery, domain-depth nudges, and exploration suggestions; LLM-powered with 8×8 prompt frame/structure combinations; optional web search integration (Exa/Tavily) for timely external facts
- **Cost-sensitive gate** — PRISM-style graded gating weighs pNeed × pAccept against disturbance cost; hard vetoes for active hours, suppression, and insufficient exchanges; calibration correction from historical outcomes
- **Trust evolution** — SARA framework with four relationship stages (orientation → exploration → rapport → partnership); each stage has specific behavior guidance for tone and proactivity
- **Preference learning** — Thompson Sampling per topic with Beta(α, β) posterior, optimistic prior, 90-day decay, and automatic frequency adaptation (positive → more frequent, negative → less frequent)
- **Feedback collection** — explicit and implicit signals (reply length, latency, topic continuation/abandonment, question depth) continuously refine per-topic preference probabilities
- **Timing naturalness** — timer jitter (50%~150% of base interval) ensures proactive messages don't arrive like clockwork
- **Semantic dedup** — domain overlap check (>50% with recent insights) prevents repeating the same angle
- **Anti-repetition** — banned openings, generic pattern filtering (20+ regex), and past insight history comparison

**Agent:**

- Embedded agent runtime with tool streaming
- Multi-agent routing with isolated sessions per workspace or sender
- Sessions: direct chats collapse into shared `main`; groups are isolated
- Streaming and chunking for long responses

**Auth and providers:**

- Z.AI (智谱 GLM) as primary provider (GLM-4.7, GLM-5, and more)
- 35+ LLM providers total: DeepSeek, Qwen (通义千问), Kimi, MiniMax, 百度千帆, 阶跃星辰, 火山引擎, BytePlus, Kimi Coding, 小米, Alibaba, Anthropic Claude, Google Gemini, xAI Grok, Mistral, Perplexity, Groq, Nvidia, HuggingFace, OpenAI, OpenRouter, LiteLLM, Together, Fireworks, Cloudflare AI, Vercel AI, Microsoft, Ollama, LMStudio, SGLang, vLLM, and more
- OpenAI-compatible provider support (any OpenAI-compatible or Anthropic-compatible endpoint)
- Model failover and API key rotation

**Media:**

- Images, audio, video, and documents in and out
- Shared image generation and video generation capability surfaces
- Voice note transcription
- Text-to-speech with multiple providers

**Interfaces:**

- WebChat and browser Control UI
- CLI and TUI terminal interfaces

**Tools and automation:**

- Browser automation (Playwright), exec, sandboxing
- Web search (Exa, Tavily)
- Cron jobs and heartbeat scheduling
- Skills (21 built-in, ClawHub marketplace) and 62 bundled extensions (plugin ecosystem)
