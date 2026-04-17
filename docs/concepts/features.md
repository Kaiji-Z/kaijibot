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

- **Persona system** — per-user cognitive model that learns identity, domains, interests, and communication style over time; dual extraction (rule-based fast path + LLM deep path)
- **Proactive insights** — cross-domain discovery, pending-question follow-ups, domain-depth nudges; serendipity-scored for optimal novelty
- **Cost-sensitive gate** — PRISM-style graded gating weighs need (pNeed) × acceptance (pAccept) against disturbance cost before every proactive contact
- **Trust evolution** — four-stage relationship model (orientation → exploration → rapport → partnership) with Thompson Sampling preference learning
- **Feedback collection** — explicit and implicit signals (reply length, topic continuation, depth cues) continuously refine per-topic preference probabilities

**Agent:**

- Embedded agent runtime with tool streaming
- Multi-agent routing with isolated sessions per workspace or sender
- Sessions: direct chats collapse into shared `main`; groups are isolated
- Streaming and chunking for long responses

**Auth and providers:**

- Z.AI (智谱 GLM) as primary provider (14 models including GLM-5-turbo)
- OpenAI-compatible provider support (vLLM, SGLang, Ollama, and any OpenAI-compatible or Anthropic-compatible endpoint)

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
- Skills (21 built-in, ClawHub marketplace) and plugin ecosystem
