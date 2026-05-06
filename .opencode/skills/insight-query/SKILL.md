---
name: insight-query
description: >
  Query and report on KaijiBot cognitive insight generation pipeline.
  Use when the user asks about recent insights, insight quality, proactive messages,
  cognitive system status, or what the bot proactively sent.
  Triggers: latest insights, insight report, cognitive insights, recent proactive messages,
  insight quality, proactive insight, 洞察报告, 认知洞察, 最新洞察.
---

# Insight Query

Query the KaijiBot cognitive insight pipeline — from persona data through PRISM gate → SIRI loop → LLM generation → delivery — and produce a structured report.

## Data Sources

Three data sources, queried in order:

1. **Persona JSON** — `~/.kaijibot/cognitive/persona/main/*.json`
   - `feedbackProfile.recentInsightIds` — last 20 insight IDs
   - `feedbackProfile.recentInsightContents` — last 5 insight texts
   - `feedbackProfile.lastProactiveAt` — timestamp of last delivered insight
   - `feedbackProfile.topicBandits` — Thompson Sampling arm states per topic
   - `rapport.trustScore`, `rapport.totalExchanges`
   - `domains` — all user domains with depth, keyInsights, lastMentioned
   - `pendingQuestions`, `recentFocus`

2. **Gateway logs** — `/tmp/kaijibot/kaijibot-YYYY-MM-DD.log` (JSONL, daily rotation)
    - Subsystem `"cognitive/scheduler"` — gate decisions, search, identify, insight output with source tag
    - Subsystem `"cognitive/insight"` — v2 pipeline: crystallization, quality gate, composer, dual merge
    - Subsystem `"cognitive/insight-llm"` — v1 web search, domain matching, LLM generation, trigram dedup
    - Subsystem `"cognitive/interest-inference"` — search query generation (extend-mode LLM query)
    - Subsystem `"cognitive/fragment-store"` — fragment clusters, dedup, maintenance
    - Subsystem `"cognitive/pipeline"` — dual pipeline merge, v2 crystallization results
    - Log line format: `{"0":"{\"subsystem\":\"cognitive/...\"}","1":{...meta},"2":"message","time":"ISO"}`

3. **Source code** (for reference, not routine queries)
   - `src/cognitive/insight/llm-engine.ts` — LLM insight generation + web search
   - `src/cognitive/scheduler/proactive-scheduler.ts` — SIRI loop
   - `src/cognitive/scheduler/gate.ts` — PRISM gate

## Query Procedure

### Step 0: Pipeline overview with cognitive-watch (MANDATORY)

Run the cognitive-watch script FIRST to get a visual pipeline overview. This provides the full picture before diving into details.

```bash
# Replay specific date range (pipe the relevant log file(s))
python3 -u ~/.kaijibot/scripts/cognitive-watch.py < /tmp/kaijibot/kaijibot-YYYY-MM-DD.log

# For cross-midnight analysis, concatenate both files
cat /tmp/kaijibot/kaijibot-2026-04-28.log /tmp/kaijibot/kaijibot-2026-04-29.log | \
  python3 -u ~/.kaijibot/scripts/cognitive-watch.py
```

Use the output to:
- Identify which pipeline cycles produced insights vs were vetoed
- Spot patterns (all v1, v2 starvation, repeated domains)
- Get exact timestamps for deeper investigation in Steps 1-8

### Steps 1-8: Detailed analysis

Execute these steps in sequence. Adapt date ranges and grep patterns as needed.

### Step 1: Read persona data

```bash
PERSONA_FILE=$(ls -t ~/.kaijibot/cognitive/persona/main/*.json | head -1)
jq '{
  lastProactiveAt: .feedbackProfile.lastProactiveAt,
  lastProactiveAtReadable: (.feedbackProfile.lastProactiveAt / 1000 | strftime("%Y-%m-%dT%H:%M:%S")),
  insightCount: (.feedbackProfile.recentInsightIds | length),
  insightIds: .feedbackProfile.recentInsightIds[-5:],
  insightContents: .feedbackProfile.recentInsightContents,
  trustScore: .rapport.trustScore,
  totalExchanges: .rapport.totalExchanges,
  domainCount: (.domains | length),
  domainNames: (.domains | keys),
  pendingQuestions: .pendingQuestions,
  recentFocus: .recentFocus,
  lifecycleStage: .lifecycle.stage
}' "$PERSONA_FILE"
```

Report:
- How many insights delivered total (insightCount)
- Last insight timestamp (convert from epoch ms to local time)
- The 5 most recent insight texts
- User's current domain landscape

### Step 2: Find insight generation traces in logs

Find all successful insight generations for a given date range. The script checks ALL available log files to handle cross-midnight sessions.

```bash
LOG_DIR="/tmp/kaijibot"

# Adapt the date range to the user's request. Examples:
# - "yesterday": TODAY and YESTERDAY
# - "April 28 18:00 onwards": just kaijibot-2026-04-28.log and kaijibot-2026-04-29.log
# - "last 3 days": loop over 3 dates
START_DATE="2026-04-28"  # ← adapt per request
END_DATE="2026-04-29"    # ← adapt per request

for LOG_FILE in "$LOG_DIR"/kaijibot-${START_DATE}.log "$LOG_DIR"/kaijibot-${END_DATE}.log; do
  [ -f "$LOG_FILE" ] || continue
  echo "=== $(basename "$LOG_FILE") ==="
  grep '"insight generated"' "$LOG_FILE" | jq -c 'select(."1".contentPreview != null) | {time: .time, contentPreview: ."1".contentPreview, insightId: ."1".insightId, sourceCount: ."1".sourceCount, hasWebSources: ."1".hasWebSources, targetDomains: ."1".targetDomains, source: ."1".source}' 2>/dev/null
done
```

### Step 3: Trace full pipeline for each insight

Auto-trace the complete pipeline for each insight found in Step 2. Handles cross-midnight log rotation by searching ALL available log files (gateway sessions spanning midnight split events across files).

```bash
LOG_DIR="/tmp/kaijibot"
# Collect ALL log files that might contain relevant events
LOG_FILES=()
for f in "$LOG_DIR"/kaijibot-*.log; do [ -f "$f" ] && LOG_FILES+=("$f"); done

# Pipeline keywords to trace
PIPELINE_KW="gate passed|gate vetoed|search found opportunities|identify selected pool|identify selected nothing|pre-gen freshness check|resolve: quality retry|resolve: selected best candidate|insight generated|web search completed|surprise-mode web search completed|web search domain matching|web search cache hit|safety-net dedup|crystallized|quality gate assessed|dual pipeline: merged|force-aligned|fragments extracted|fragment clusters|processEvent done"

# For each insight from Step 2, extract its timestamp HH:MM prefix and trace nearby events
# Replace INSIGHT_TIMES with actual timestamps from Step 2 output (just the HH:MM part)
INSIGHT_TIMES=("18:57" "20:46" "22:33")  # ← adapt from Step 2 results

for LOG_FILE in "${LOG_FILES[@]}"; do
  echo "=== $(basename "$LOG_FILE") ==="
  for T in "${INSIGHT_TIMES[@]}"; do
    echo "--- Pipeline near $T ---"
    grep -E "($PIPELINE_KW)" "$LOG_FILE" | grep "cognitive/" | grep "$T" | \
      jq -c '{time: .time, subsystem: ."0", message: ."2", meta: ."1"}' 2>/dev/null
  done
done
```

**Important**: Gateway sessions spanning midnight split pipeline events across two daily log files. Always search ALL log files, not just the one matching the insight's date. For example, a 2026-04-29T00:15 insight may have its gate/search in `kaijibot-2026-04-28.log` but web search/merge in `kaijibot-2026-04-29.log`.

### Step 4: Check web search invocations

Web search logs are under subsystem `"cognitive/insight-llm"`. Search ALL log files (cross-midnight awareness):

```bash
LOG_DIR="/tmp/kaijibot"
for LOG_FILE in "$LOG_DIR"/kaijibot-*.log; do
  [ -f "$LOG_FILE" ] || continue
  grep "cognitive/insight-llm" "$LOG_FILE" | \
    jq -c '{time: .time, message: ."2", meta: ."1"}' 2>/dev/null
done
```

Key messages to look for:
- `"extend-mode LLM query generated"` — `{query}` — the search query derived from interest inference
- `"surprise-mode web search completed"` — `{query, resultCount}` — web search in surprise/exploration mode
- `"web search completed"` — `{query, resultCount}`
- `"web search failed"` — `{query, error}`
- `"web search skipped"` — reason: empty query or no dep
- `"web search cache hit"` — `{query}` — cached result reused (identical query)
- `"web search domain matching"` — `{totalResults, matchedDomains, unmatchedSnippets}`
- `"force-aligned LLM output domains to input targetDomains"` — domain constraint fix activated (LLM domains → forced to input domains)
- `"LLM generated N insight candidate(s)"`
- `"LLM returned empty response"` / `"LLM response could not be parsed"`
- `"resolve: quality retry"` — `{attempt, candidatesSoFar}` — quality retry attempt N
- `"resolve: selected best candidate"` — `{attempts, finalScore, totalCandidates}` — best candidate picked from retry pool
- `"safety-net dedup: near-identical content blocked"` — extreme similarity safety-net (0.95 trigram / 0.8 contentWord thresholds)
- `"pre-gen freshness check: skipping stale candidate"` — `{type, targetDomains}` — topic stale before LLM call, skipped to next

### Step 5: Fragment health (v2 pipeline diagnostics)

Check fragment collection and clustering status — critical for diagnosing v2 pipeline starvation:

```bash
LOG_DIR="/tmp/kaijibot"

for LOG_FILE in "$LOG_DIR"/kaijibot-*.log; do
  [ -f "$LOG_FILE" ] || continue
  echo "=== $(basename "$LOG_FILE") ==="

  # Fragment collection success (from conversation turns)
  grep '"fragments extracted"' "$LOG_FILE" | \
    jq -c '{time: .time, count: ."1".count, kinds: ."1".kinds}' 2>/dev/null

  # Fragment store: dedup vs new inserts
  grep -E '"fragment (dedup hit|added)"' "$LOG_FILE" | \
    jq -c '{time: .time, message: ."2", tag: ."1".structuralTag, strength: ."1".strength}' 2>/dev/null

  # Fragment maintenance: expiry and decay
  grep '"fragment maintenance"' "$LOG_FILE" | \
    jq -c '{time: .time, before: ."1".before, after: ."1".after, removed: ."1".removed}' 2>/dev/null

  # Cluster formation (needed for crystallization)
  grep '"fragment clusters"' "$LOG_FILE" | \
    jq -c '{time: .time, clusterCount: ."1".clusterCount, sizes: ."1".sizes}' 2>/dev/null
done

# Current fragment state on disk (direct read, no log dependency)
FRAG_FILE=$(ls -t ~/.kaijibot/cognitive/fragments/*.json 2>/dev/null | head -1)
if [ -n "$FRAG_FILE" ]; then
  echo "Fragment file: $FRAG_FILE"
  jq '{total: (.fragments | length), byKind: (.fragments | group_by(.kind) | map({kind: .[0].kind, count: length})), avgStrength: ((.fragments | map(.strength) | add) / (.fragments | length)), domains: ([.fragments[].domains[]] | unique), byTag: (.fragments | group_by(.structuralTag) | map({tag: .[0].structuralTag, count: length})), strengthRange: {min: (.fragments | map(.strength) | min), max: (.fragments | map(.strength) | max)}}' "$FRAG_FILE"
fi
```

Key diagnostics:
- **Zero `"fragments extracted"` entries** → fragment collector never succeeds — check model config
- **All `"fragment dedup hit"`** → fragments are redundant, not adding new signal
- **`removed > 0` in maintenance** → fragments expiring faster than being collected
- **`clusterCount: 0`** → fragments don't overlap enough to form multi-domain clusters (needs ≥2 frags sharing ≥2 domains)

### Step 6: Search/identify breakdown

Check opportunity type distribution and domain cooldown activity:

```bash
LOG_DIR="/tmp/kaijibot"

for LOG_FILE in "$LOG_DIR"/kaijibot-*.log; do
  [ -f "$LOG_FILE" ] || continue
  echo "=== $(basename "$LOG_FILE") ==="

  # Search: per-type opportunity counts
  grep '"search found opportunities"' "$LOG_FILE" | \
    jq -c '{time: .time, count: ."1".count, byType: ."1".byType}' 2>/dev/null

  # Identify: pool size + top candidate + recent history (shows domain cooldown activity)
  grep '"identify selected pool"' "$LOG_FILE" | \
    jq -c '{time: .time, poolSize: ."1".poolSize, topType: ."1".topType, topTargetDomains: ."1".topTargetDomains, topPAct: ."1".topPAct, recentTypes: ."1".recentTypes}' 2>/dev/null

  # Pre-gen freshness check: stale candidates skipped
  grep '"pre-gen freshness check"' "$LOG_FILE" | \
    jq -c '{time: .time, type: ."1".type, targetDomains: ."1".targetDomains}' 2>/dev/null
done
```

Key patterns:
- **`byType: {domain_depth: N}` only** → scanCrossDomain/scanExploration producing nothing
- **`recentTypes` shows repeated types** → informational only (type cooldown removed; domain cooldown still active via 0.5^n)
- **`poolSize: 1` consistently** → only one candidate survives penalties, low diversity in opportunities
- **`pre-gen freshness check` fires frequently** → isTopicStale too aggressive, or recentInsightDomains too broad

### Step 7: Quality gate scores (v2 diagnostics)

Check why v2 insights get parked or discarded. Quality gate uses LLM-as-judge for novelty+actionability (60% weight) + code formula for emotional readiness (15%) + LLM for non-obviousness (25%). LLM verdict "no" forces discard regardless of composite score.

```bash
LOG_DIR="/tmp/kaijibot"

for LOG_FILE in "$LOG_DIR"/kaijibot-*.log; do
  [ -f "$LOG_FILE" ] || continue
  echo "=== $(basename "$LOG_FILE") ==="
  grep '"quality gate assessed"' "$LOG_FILE" | \
    jq -c '{time: .time, verdict: ."1".verdict, composite: ."1".composite, llmNoveltyActionable: ."1".llmNoveltyActionable, llmVerdict: ."1".llmVerdict, emotionalReadiness: ."1".emotionalReadiness, nonObviousness: ."1".nonObviousness, blindSpot: ."1".blindSpot}' 2>/dev/null
done
```

Key diagnostics:
- **`llmVerdict: "no"`** → LLM judged insight as not novel/actionable for this user — forced discard
- **`llmNoveltyActionable < 0.3`** → insight too obvious or not actionable (60% weight dominates composite)
- **`emotionalReadiness < 0.3`** → user trust too low (new/dormant user) or suppressUntil active
- **`nonObviousness < 0.5`** → LLM rated the blind spot as common knowledge
- **`verdict: "park"` (composite 0.45-0.64)** → close to delivering, could be rescued with lower threshold
- **`verdict: "discard"` (composite < 0.45 or llmVerdict=no)** → blind spot too weak or LLM rejected

### Step 8: Gate statistics

Summary of gate decisions across all log files:

```bash
LOG_DIR="/tmp/kaijibot"

for LOG_FILE in "$LOG_DIR"/kaijibot-*.log; do
  [ -f "$LOG_FILE" ] || continue
  echo "=== $(basename "$LOG_FILE") ==="
  echo "Gate passed: $(grep -c '"gate passed"' "$LOG_FILE")"
  echo "Gate vetoed: $(grep -c '"gate vetoed"' "$LOG_FILE")"
  echo "Insights generated: $(grep '"insight generated"' "$LOG_FILE" | grep -c 'contentPreview')"
  echo "No insight: $(grep -c '"identify selected nothing"' "$LOG_FILE")"
  echo "Pre-gen freshness skipped: $(grep -c '"pre-gen freshness check"' "$LOG_FILE")"
  echo "Quality retries: $(grep -c '"resolve: quality retry"' "$LOG_FILE")"
  echo "Safety-net blocked: $(grep -c '"safety-net dedup"' "$LOG_FILE")"
  echo "Web search cache hits: $(grep -c '"web search cache hit"' "$LOG_FILE")"
  echo "Force-alignments: $(grep -c '"force-aligned"' "$LOG_FILE")"
done
```

## Report Format

Structure the report as:

```
## 洞察报告 — [date range]

### Pipeline 全景 (from cognitive-watch)
[Brief summary from Step 0: total cycles, insight/veto counts, notable patterns visible in the visualization]

### 概况
- 总洞察数: N
- 最后洞察时间: [timestamp]
- 用户信任分: X.XX
- 总交换次数: N
- 用户领域: [list top domains by depth]

### 洞察详情

#### 洞察 #[N]
- **内容**: [text]
- **时间**: [timestamp]
- **来源**: [v1/v2]
- **Pipeline**: [event source] → gate (pAct=X.XX) → search (N opportunities) → identify pool (top N) → freshness check → resolve (X attempts, best score: Y.YY)
- **Web search**: [triggered/skipped] — query: "...", N results, matched domains: [...]
- **质量评估**: [high/medium/low] — [1-sentence rationale]

### Gate 统计 (当日)
- 通过: N / 否决: N (通过率 XX%)
- 平均 pAct: X.XX

### 搜索类型分布 (当日)
- domain_depth: N 次 (XX%)
- cross_domain: N 次 (XX%)
- exploration: N 次 (XX%)
- 多样性惩罚触发: N 次 (domain cooldown only, 0.5^n)

### v2 管线诊断
- Fragment 库: N 个 (有效 N / 过期 N)
- 集群: N 个 (平均大小 X.X)
- 冷启动: 是/否 (需要 ≥5 fragments)
- 质量门控: deliver N / park N / discard N
- 最弱支柱: [哪个 pillar 最低，均值多少]

### 管线对比 (v1 vs v2)
- v1 洞察: N 条 (XX%)
- v2 洞察: N 条 (XX%)
- 前置新鲜度拦截: N 条
- 安全网拦截: N 条

### 建议改进 (如有)
- [Any issues noticed: repeated topics, failed web searches, etc.]
```

## Real-time Pipeline Monitor

A Python script provides real-time 15-step pipeline visualization with color-coded output.

### Script location

- **Standalone (recommended)**: `~/.kaijibot/scripts/cognitive-watch.sh` — self-contained, auto-tails log
- **Python filter**: `~/.kaijibot/scripts/cognitive-watch.py` — reads from stdin, for replay/custom piping
- **Ephemeral copies**: `/tmp/kaijibot/cognitive-watch.{sh,py}` (may not survive reboot)

### Usage

```bash
# Live monitoring — one command, auto-follows today's log
~/.kaijibot/scripts/cognitive-watch.sh

# Replay a specific day's pipeline (Python version, reads stdin)
python3 -u ~/.kaijibot/scripts/cognitive-watch.py < /tmp/kaijibot/kaijibot-2026-04-22.log

# In tmux (for persistent monitoring)
tmux new-session -s cog-watch "~/.kaijibot/scripts/cognitive-watch.sh"
```

### Pipeline steps displayed

| Step | Label | Color | What it shows |
|------|-------|-------|---------------|
| 1 | ⏰ TICK | dim | Timer fire, user count, interval |
| 2 | 🟢/🔴 GATE | green/red | PRISM gate pass/veto with pNeed, pAccept, pAct |
| 3 | 🔍 SEARCH | yellow | Number of opportunities found + **per-type breakdown** (cross_domain, domain_depth, exploration) |
| 4 | 🎯 IDENTIFY | cyan | **Pool size** (top N), top candidate type/domains/pAct + **recentTypes** (diversity penalty visibility) |
| 4a | 🧹 STALE | yellow | Pre-gen freshness check: stale candidate skipped (saves LLM tokens) |
| 4b | 🧊 CRYSTAL | cyan | v2: Crystallized blind spot count + mode |
| 4c | 📊 QGATE | green/yellow/red | v2: Quality gate verdict (deliver/park/discard) + composite + LLM novelty/actionable score + LLM verdict (yes/no) + emotionalReadiness + nonObviousness |
| 5 | 🌐 WEB + 📊 MATCH | blue | Web search query, result count, domain matching |
| 6 | 🤖 LLM GEN | magenta | v1: Number of insight candidates |
| 6a | 🔄 RETRY + ✅ BEST | yellow/green | Quality retry: attempt count + final best score from retry pool |
| 6b | 🔀 MERGE | cyan | Dual: v1=N v2=N total=N deduped=N |
| 7 | ❌ PARSE FAIL | red | JSON parse errors |
| 8 | ⚠️ VERIFY | yellow | Verification failures |
| 9 | 🚫 DEDUP | magenta | Safety-net: near-identical content blocked (0.95/0.8 thresholds) |
| 10 | 💡 INSIGHT ✓ | green | Final insight with [v1]/[v2] source tag, content preview |
| 11 | 📨 DELIVERED | green | Successfully sent to feishu |
| 12 | 🏁 DONE | green/dim | Pipeline completion status |

### Key patterns to watch for

- **`type=domain_depth` every time** → opportunity selection is monopolized, cross_domain never wins
- **`poolSize: 1` consistently** → only one candidate survives penalties, consider relaxing domain cooldown
- **`pre-gen freshness check` fires every cycle** → isTopicStale too aggressive, or recentInsightDomains too broad — no LLM calls happening
- **`matchedDomains: (none)`** → web search results don't match user domains, insight has no factual grounding
- **Same `targetDomains` repeated** → always targeting the same domain
- **Gate vetoed with low pAct** → normal (PRISM cost gate working)
- **Zero `"fragments extracted"` in logs** → fragment collector never fires — check model config and userId in persona
- **`clusterCount: 0` consistently** → fragments don't overlap across domains — v2 pipeline starves
- **`llmVerdict: "no"` every time** → LLM consistently rejecting insights as not novel/actionable for this user; check prompt or persona data
- **`byType` only has domain_depth** → cross-domain and exploration scan functions producing nothing
- **🚀 SCHEDULER START** → gateway was restarted, check if interval is correct
- **v2 `[v2]` insights appearing** → dual pipeline working, blind spot detection producing deliverable insights
- **v2 cold start** → fragment count < 5, v2 falls back to v1
- **🔀 MERGE v2=0 consistently** → v2 pipeline never produces candidates, check fragment count and crystallization
- **Quality gate verdict=discard every time** → blind spots not novel enough, consider lowering thresholds
- **`resolve: quality retry` attempt=2/3 often** → first attempt quality low, retry rescuing insights
- **`safety-net dedup` fires frequently** → LLM generating near-identical content, check prompt diversity

## Quality Assessment Rubric

Rate each insight on a 3-level scale:

- **高**: Cross-domain surprise OR resolves a pending question OR challenges an assumption with external evidence
- **中**: Useful but relies on recombining known knowledge without external input, or is a best-practice reminder
- **低**: Semantically duplicates a recent insight, is generic advice, or has no grounding in user's specific context
