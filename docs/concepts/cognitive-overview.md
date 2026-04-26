---
summary: "How KaijiBot's cognitive layer works — persona, insights, scheduling, trust, and feedback"
read_when:
  - Understanding how proactive insights are generated
  - Configuring cognitive system behavior
  - Debugging insight quality or timing
title: "Cognitive Layer Overview"
---

# Cognitive Layer Overview

The cognitive layer is a self-contained module at `src/cognitive/` that transforms KaijiBot from a passive question-answering bot into a **proactive AI assistant**. It can be disabled via `cognitive.enabled: false` for a pure OpenClaw experience.

## Architecture

The cognitive layer has five subsystems, each answering a core question:

| Module | Question | Location |
|---|---|---|
| **Persona** | Who is this user? | `src/cognitive/persona/` |
| **Insight** | What should I tell them? | `src/cognitive/insight/` |
| **Scheduler** | When should I reach out? | `src/cognitive/scheduler/` |
| **Feedback** | How did they react? | `src/cognitive/feedback/` |
| **Mode Router** | What mode is this conversation? | `src/cognitive/mode-router.ts` |

## Persona — "Who is this user?"

The persona module builds and maintains a per-user cognitive model called `PersonaTree`.

### PersonaTree structure

- **identity** — core traits (confidence-weighted), communication style, timezone, language, domain lists
- **domains** — map of domain name to `DomainNode` (depth 1-5, recurrence count, key insights, active questions)
- **recentFocus** — last 10 focused topics
- **feedbackProfile** — Thompson Sampling bandits per topic, preferred style, optimal frequency, recent insight history
- **rapport** — trust score (0-1), total exchanges, avg response length, self-disclosure level
- **domainGraph** — learned co-occurrence graph with weighted edges
- **moodHistory** — sentiment snapshots with trend detection

### Dual extraction

1. **Rule-based** (`extractor.ts`): Fast (<50ms). Scans for domain keyword matches, self-disclosure patterns, question extraction, blacklist detection. Clause-level negation detection with double-negation handling.
2. **LLM-based** (`llm-extractor.ts`): Sends conversation turn + existing persona to LLM with structured JSON extraction. 5s timeout. Falls back to rule-based on failure.

### Domain evolution

Domains classify as **expert** (depth≥4, recurrence≥10), **interest** (depth≥2), or **curiosity** (depth≥1). Unmentioned domains decay with a 30-day half-life. Domains with 3+ negation signals in 30 days are auto-blacklisted.

### Persistence

`~/.kaijibot/cognitive/persona/{agentId}/{userId}.json` — atomic writes with Zod validation.

## Insight — "What should I tell them?"

### LLM engine

The production insight generator (`llm-engine.ts`):

1. Optionally runs web search (Exa/Tavily) for recent results matching user domains
2. Matches web results to domain keywords via alias expansion
3. Builds a rich prompt with:
   - User identity + traits + domain expertise
   - Cross-domain co-occurrence graph (≥3 observations)
   - Key insights from persona as "specific facts"
   - External facts from web search (prioritized as independent block)
   - Past insights for anti-repetition
   - Random prompt frame (8 variants) × structure seed (8 variants)
   - Banned openings from recent insights
4. Filters generic patterns via 20+ regex rules
5. 20s timeout, temperature 0.85

### Serendipity scoring

`serendipity = relevance × surprise × novelty` (trust-weighted). Low trust favors relevance, high trust favors surprise.

### Cross-domain mapper

Discovers connections between domains via:
- Hardcoded domain adjacency graph (8 known domain connections)
- Learned co-occurrence graph: tracks which domains appear together, weighted edges with 14-day exponential decay
- BFS-1 from user's domains to adjacent unexplored domains

## Scheduler — "When should I reach out?"

### SIRI loop

The ProactiveScheduler (`proactive-scheduler.ts`) runs a **Search → Identify → Resolve → Inform** cycle:

1. **Search**: Based on event type, scan for opportunities:
   - Cross-domain connections (adjacent unexplored domains)
   - Pending questions (unanswered user questions)
   - Domain depth (high-depth domains with recency boost)
   - Exploration (20% deterministic slot for unknown domains)
2. **Identify**: Sort by `pAct`, pick best if it exceeds cost threshold
3. **Resolve**: Call LLM engine to generate insight content
4. **Inform**: Deliver to user via `onInsightReady` callback

### PRISM cost-sensitive gate

Before each proactive attempt, the gate (`gate.ts`) computes:

- **Hard vetoes**: outside active hours, suppressed, <5 total exchanges
- **pNeed** = sigmoid(time) × eventFactor × domainActivity ÷ lifecycleFactor
- **pAccept** = 0.5×trust + 0.3×banditMean + 0.2×feedbackRatio, then calibration-corrected
- **Decision**: `pAct = pNeed × pAccept > C_FA / (C_FN + C_FA)` (default threshold 0.25)

### Event sources

| Source | Trigger | Default interval |
|---|---|---|
| **TimerSource** | Periodic timer | 4h (with random jitter 50%~150%) |
| **PersonaChangeSource** | Domain count changes ≥2 | On persona update |
| **InfoScanSource** | Periodic information scan | 6h |

### Dedup

Before delivery, checks domain overlap with recent 5 insights. Rejects if overlap >50%.

## Feedback — "How did they react?"

### Thompson Sampling

Each topic has a Beta(α, β) posterior with optimistic prior (2, 1). Positive feedback: α += 1. Negative: β += 1. Neutral: β += 0.5. 90-day exponential decay toward priors.

Frequency adapts: positive → -0.5h (more frequent), negative → +2h (less frequent), clamped 1-48h.

### Trust evolution (SARA framework)

| Phase | Trust range | Behavior |
|---|---|---|
| **Orientation** | < 0.3 | Demonstrate capability, no proactive suggestions |
| **Exploration** | 0.3–0.5 | Share observations, 1 curiosity question per 3 turns |
| **Rapport** | 0.5–0.7 | Connect patterns, brief insights, 2:1 statement-to-question |
| **Partnership** | ≥ 0.7 | Full thinking partner, challenge assumptions |

Trust deltas: positive +0.05, engaged +0.08, negative -0.08, neutral 0. Implicit: long response +0.02, quick reply +0.01, topic continuation +0.03, topic abandonment -0.02.

### Calibration

Linear regression slope corrects pAccept overconfidence/underconfidence. Needs 10+ calibration records to be reliable.

## Mode Router

Every user message is classified into one of four modes:

| Mode | Triggers | Agent behavior |
|---|---|---|
| **task** | Imperative verbs + explicit objects | Execute directly, minimal commentary |
| **insight** | Exploratory questions ("你觉得...", "怎么看待") | Deep analysis, multiple perspectives |
| **hybrid** | Mixed signals or uncertain | Balance execution and analysis |
| **proactive** | System-initiated (heartbeat/cognitive) | Insight delivery tone |

Classification is priority-ordered with Chinese + English pattern matching.

## End-to-end flow

```
Event source fires (timer / persona_change / info_scan)
  → ProactiveScheduler.processEvent(userId, event)
    → Gate: hard veto check → compute pNeed × pAccept → threshold comparison
      → Search: scan opportunities (cross-domain, questions, depth, exploration)
        → Identify: sort by pAct, pick best above threshold
          → Resolve: LLM generates insight (+ optional web search)
            → Dedup: check domain overlap with recent 5 insights
              → Deliver: find user session → send via Feishu
                → Feedback: collect response signals → update persona
```

## Configuration

```json5
{
  cognitive: {
    enabled: true,
    proactive: {
      enabled: true,
      minIntervalHours: 4,       // minimum gap between proactive messages
      activeHours: {
        start: "09:00",
        end: "22:00",
        timezone: "Asia/Shanghai",
      },
    },
  },
}
```

## Data locations

| Data | Path |
|---|---|
| Persona | `~/.kaijibot/cognitive/persona/{agentId}/{userId}.json` |
| Insights | `~/.kaijibot/cognitive/insights/{userId}/` |
| Gateway logs | `/tmp/kaijibot/kaijibot-YYYY-MM-DD.log` |

## Related

- [Cognitive Persona Research](/concepts/cognitive-persona-research) — academic foundations and design rationale
- [Architecture](/concepts/architecture) — overall Gateway architecture
- [Features](/concepts/features) — full capability list
