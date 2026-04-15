# Cognitive Persona System: Research & Architecture

## Overview

KaijiBot's cognitive persona system builds a user profile from natural conversation to deliver personalized proactive insights. This document captures the research, architecture decisions, and improvement roadmap.

## Research Sources

### Recommendation Systems Studied

| Platform | Architecture | Key Takeaway |
|----------|-------------|--------------|
| **TikTok/Douyin** | Interest graph + Monolith real-time training | Implicit signals (watch time) > explicit (likes). 30-50% exploration slots. |
| **Xiaohongshu (RED)** | Dual-tower + multi-interest (GemiRec, HyMiRec) | Multiple simultaneous interest vectors prevent interest collapse. |
| **Instagram** | Social + interest dual-graph (DV365, PIE) | Account-level embeddings. Explicit aversion modeling (P(see_less)). DM shares as #1 quality signal. |
| **ChatGPT Memory** | Fact extraction + vector retrieval (mem0) | Two-phase LLM pipeline: extract facts → reconcile (ADD/UPDATE/DELETE). |
| **Spotify** | Time-decayed taste profile | 70/30 familiar/novel split. Recent behavior weighted higher. |
| **Netflix** | Context-aware + retention optimization | CTR is misleading. Completion + retention = true quality signal. |
| **Character.AI/Replika** | Narrative compression | Relationship summary alongside discrete facts gives "relationship feel". |

### Key Academic Papers

- **DEEPER** (ACL 2025) — Directed persona refinement. 32.2% error reduction via active contradiction resolution.
- **PERSONAMEM** (COLM 2025) — LLMs achieve only ~50% accuracy on evolving profile tasks.
- **DV365** (KDD 2025) — Instagram's multi-slicing user embedding over 365 days.
- **GemiRec** (Xiaohongshu 2025) — Interest dictionary with codebook quantization.
- **PIE** (WWW 2023) — Personalized PageRank + bandit exploration.
- **ProfiLLM** (2025) — Fully implicit profiling from chatbot interactions.

## What We Learned: Transferable vs Not

### Transferable to KaijiBot (single-user chatbot)

| Pattern | Source | Why It Works |
|---------|--------|-------------|
| Fact extraction + reconciliation | ChatGPT/mem0 | Two-phase: extract → ADD/UPDATE/DELETE against existing |
| Time-decayed interest weighting | Spotify | Recent conversations matter more |
| Temporal depth decay | TikTok/Instagram | Interests fade when not discussed |
| Domain co-occurrence graph | All | Cross-domain connections enable serendipitous insights |
| Multi-objective value model | Instagram | Not just "will user like this" but also "will user dislike this" |
| Narrative compression | Character.AI | Running relationship summary alongside structured facts |
| Cost-sensitive gating (PRISM) | Our design | Don't reach out unless there's something worth saying |
| SARA trust phases | Our design | Behavior adapts to relationship stage |

### NOT Transferable (avoid)

| Pattern | Why It Fails |
|---------|-------------|
| Collaborative filtering | Requires millions of users. N=1. |
| Matrix factorization embeddings | Same — needs population. |
| A/B testing at scale | N=1. Use qualitative feedback. |
| Heavy vector DB infrastructure | SQLite + in-memory handles thousands of memories. |
| Real-time online training | Too expensive for a single-user bot. |

## Architecture Decisions

### The Persona Model (PersonaTree)

```
PersonaTree
├── identity
│   ├── coreTraits: Record<string, ConfidenceValue>  -- weighted attributes with evidence
│   ├── communicationStyle: {formality, verbosity, technicalLevel, language}
│   ├── expertDomains / interestDomains / curiosityDomains
│   └── userId
├── domains: Record<string, DomainNode>  -- per-domain: depth, recurrence, insights, questions
├── recentFocus: string[]  -- last 10 topics
├── pendingQuestions: string[]  -- unresolved questions
├── feedbackProfile
│   ├── topicBandits: Record<string, Beta(α,β)>  -- Thompson Sampling per topic
│   ├── preferredStyle
│   ├── optimalFrequencyHours
│   ├── recentInsightIds: string[]  -- dedup delivered insights
│   └── suppressUntil
├── rapport: {trustScore, totalExchanges, avgResponseLength, selfDisclosureLevel}
└── domainGraph: LearnedDomainGraph  -- co-occurrence edges with decay
```

### The Pipeline

```
User message → Agent response
                ↓ (fire-and-forget, non-blocking)
            Extraction (rule-based + LLM fallback)
                ↓
            Curator (merge + decay + prune)
                ↓
            Persist to ~/.kaijibot/cognitive/persona/{agentId}/{userId}.json

Timer tick → Gate (PRISM cost-sensitive) → Search → Identify → Resolve (LLM) → Deliver
```

### Key Design Principles

1. **Implicit > Explicit**: Response latency and depth are more honest than explicit feedback.
2. **Decay everything**: Domains, graph edges, and bandits all decay over time. Nothing grows forever.
3. **Trust gates behavior**: SARA phases determine what the system is allowed to do.
4. **Cost-sensitive outreach**: C_FN=5, C_FA=1 means we prefer reaching out over staying silent.
5. **Persona-driven voice**: Insights are generated in the agent's personality (SOUL.md/IDENTITY.md).

## Improvement Roadmap

### Phase 1 — Wire Up Existing Code (DONE)

| Fix | Status |
|-----|--------|
| `recentInsightIds` now populated from persona data | ✅ |
| `topicRecency` computed from `domainNode.lastMentioned` | ✅ |
| `decayEdges()` called on every extraction | ✅ |
| Domain depth decays when not mentioned (30-day half-life) | ✅ |
| `prunePersona()` already wired in attempt.ts | ✅ (was already done) |
| Atomic file writes in PersonaStore (write-to-tmp + rename) | ✅ |

### Phase 2 — Algorithmic Improvements (Next)

| Enhancement | Description | Effort |
|-------------|-------------|--------|
| Negation handling | "我不喜欢X" should decrement, not increment domain X | Medium |
| Fixed exploration slots | 20% of proactive messages target unknown domains | Medium |
| Decayed Thompson Sampling | Apply time discount to bandit alpha/beta counts | Medium |
| Communication style injection | Populate + inject `identity.communicationStyle` into agent context | Low |
| Mood/sentiment detection | Lightweight sentiment classifier in extraction pipeline | Medium |

### Phase 3 — Productization (Future)

| Enhancement | Description | Effort |
|-------------|-------------|--------|
| Directed persona refinement (DEEPER) | Active contradiction resolution | High |
| Confidence calibration | Log predicted pAccept vs actual feedback | Medium |
| Narrative summary | LLM-generated relationship summary rewritten periodically | Medium |
| User lifecycle model | New/active/dormant with different strategies | Medium |
| Domain blacklist | "Never talk about X" support | Low |
