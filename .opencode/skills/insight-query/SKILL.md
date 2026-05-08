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
   - Subsystem `"cognitive/scheduler"` — gate decisions, search, identify, resolve, insight output, processEvent done, exploration mode routing, knowledge-mode path, pattern-mode empty fallbacks, verification complete
   - Subsystem `"cognitive/insight-llm"` — web search, domain matching, LLM generation (both knowledge and pattern modes), trigram dedup
   - Subsystem `"cognitive/interest-inference"` — search query generation (extend-mode LLM query)
   - Subsystem `"cognitive/fragment-store"` — fragment clusters, dedup, maintenance
   - Subsystem `"cognitive/fragment-collector"` — per-turn fragment extraction, turn-skip reasons
   - Subsystem `"cognitive/pipeline"` — fragment store factory operations
   - Subsystem `"cognitive/feedback-collector"` — implicit bandit updates, explicit feedback processing, delivery signal recording
   - Subsystem `"cognitive/persona-curator"` — domain discovery, domain phase transitions, displayName sync
   - Subsystem `"cognitive/persona-extractor"` — LLM/rule-based extraction results, fallback reasons
   - Log line format: `{"0":"{\"subsystem\":\"cognitive/...\"}","1":{...meta},"2":"message","time":"ISO"}`

3. **Source code** (for reference, not routine queries)
   - `src/cognitive/insight/llm-engine.ts` — `generateInsightCandidatesLLM()` handles both knowledge and pattern modes; `buildPatternInsightPrompt()` with 4 behavioral frames; web search logic
   - `src/cognitive/scheduler/proactive-scheduler.ts` — `search()` (async), `identify()`, `resolve()` (pattern branch + knowledge branch), `scanExploration` (3-mode routing)
   - `src/cognitive/scheduler/gate.ts` — PRISM gate

## Pipeline Architecture

The unified pipeline uses two modes selected during the exploration scan phase:

**Knowledge mode** (surprise or extend sub-mode):
- Web search for external sources → LLM generates insight candidates from search results + persona
- Quality retries (up to 3 attempts) if first candidate scores below threshold
- Verification based on source presence: `verified` (has web sources) or `unverified` (no sources)
- Non-exploration unverified insights are skipped (delivery blocked)

**Pattern mode**:
- Loads conversation fragments from `FragmentStore` → finds multi-domain clusters
- LLM generates behavioral insight from fragment clusters (no web search)
- No quality retries (single attempt)
- Always `partial` verification status (behavioral inference, not fact-checked)
- Bypasses the source verification gate entirely

**Mode selection** happens in `scanExploration()` via `timestamp % 100`:
```
roll < patternModeRatio (default 0.5) → pattern mode
roll < patternModeRatio + surpriseWeight → surprise mode (knowledge, web search)
else → extend mode (knowledge, user domains)
```

Pattern mode falls back to surprise mode when fragment clusters are insufficient (no cluster with ≥2 fragments).

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
- Spot patterns (all knowledge, pattern starvation, repeated domains)
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
PIPELINE_KW="gate passed|gate vetoed|search found opportunities|identify selected pool|identify selected nothing|pre-gen freshness check|resolve: quality retry|resolve: early exit|resolve: selected best candidate|insight generated|pattern-mode insight bypasses verification gate|web search completed|surprise-mode web search completed|web search domain matching|web search cache hit|safety-net dedup|Pattern-mode LLM generated|force-aligned|fragments extracted|fragment clusters|processEvent done"

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

**Important**: Gateway sessions spanning midnight split pipeline events across two daily log files. Always search ALL log files, not just the one matching the insight's date. For example, a 2026-04-29T00:15 insight may have its gate/search in `kaijibot-2026-04-28.log` but web search in `kaijibot-2026-04-29.log`.

### Step 4: Check knowledge-mode pipeline (web search + LLM)

Knowledge-mode logs are under subsystem `"cognitive/insight-llm"`. Search ALL log files (cross-midnight awareness):

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
- `"force-aligned LLM output domains to input targetDomains"` — domain constraint fix activated
- `"force-aligned pattern-mode LLM output domains to input targetDomains"` — pattern-mode domain constraint fix
- `"LLM generated N insight candidate(s)"` — knowledge-mode generation
- `"Pattern-mode LLM generated N insight candidate(s)"` — pattern-mode generation
- `"LLM returned empty response"` / `"LLM response could not be parsed as insights"` — knowledge mode parse failure
- `"LLM returned empty response for pattern mode"` / `"LLM response could not be parsed as insights (pattern mode)"` — pattern mode parse failure
- `"resolve: quality retry"` — `{attempt, candidatesSoFar}` — quality retry attempt N (knowledge mode only)
- `"resolve: early exit — quality threshold met"` — `{attempt, bestScore}` — retry stopped early because quality was good enough
- `"resolve: selected best candidate"` — `{finalScore, totalCandidates}` — best candidate picked from retry pool
- `"safety-net dedup: near-identical content blocked"` — extreme similarity safety-net (0.95 trigram / 0.8 contentWord thresholds)
- `"pattern-mode insight bypasses verification gate"` — `{content, clusterCount, fragmentCount}` — pattern insight accepted without source check
- `"pattern-mode trigram dedup filtered candidates"` — `{before, after}` — pattern-mode internal dedup
  - `"pre-gen freshness check: skipping stale candidate"` — `{type, targetDomains}` — topic stale before LLM call, skipped to next

### Step 4a: Scheduler routing and path diagnostics

New diagnostic logs that reveal mode selection and path decisions:

```bash
LOG_DIR="/tmp/kaijibot"
for LOG_FILE in "$LOG_DIR"/kaijibot-*.log; do
  [ -f "$LOG_FILE" ] || continue
  echo "=== $(basename "$LOG_FILE") ==="

  # Exploration mode routing (pattern vs surprise vs extend)
  grep '"exploration mode routed"' "$LOG_FILE" | \
    jq -c '{time: .time, roll: ."1".roll, ratio: ."1".ratio, selectedMode: ."1".selectedMode, fatiguedDomains: ."1".fatiguedDomains}' 2>/dev/null

  # Knowledge mode path (self-refine vs blind-retry)
  grep '"resolve: knowledge mode path selected"' "$LOG_FILE" | \
    jq -c '{time: .time, path: ."1".path, mode: ."1".mode, targetDomains: ."1".targetDomains}' 2>/dev/null

  # Pattern mode fallbacks
  grep -E '"pattern mode: no clusters|pattern mode: LLM generated no"' "$LOG_FILE" | \
    jq -c '{time: .time, message: ."2", clusterCount: ."1".clusterCount}' 2>/dev/null

  # Verification results
  grep -E '"knowledge-mode insight verification complete|pattern-mode insight verification complete"' "$LOG_FILE" | \
    jq -c '{time: .time, message: ."2", verificationStatus: ."1".verificationStatus, hasSources: ."1".hasSources, clusterCount: ."1".clusterCount}' 2>/dev/null

  # Gate with event type
  grep -E '"gate (passed|vetoed)"' "$LOG_FILE" | \
    jq -c '{time: .time, message: ."2", eventType: ."1".eventType, pAct: ."1".pAct}' 2>/dev/null
done
```

Key messages:
- `"exploration mode routed"` — `{roll, ratio, selectedMode, fatiguedDomains}` — which exploration sub-mode was selected (pattern/surprise/extend) and which domains are fatigued
- `"resolve: knowledge mode path selected"` — `{path, mode, targetDomains}` — whether self-refine or blind-retry path is used, with the target domains
- `"pattern mode: no clusters available"` — `{userId, clusterCount}` — pattern mode can't run, falling back to surprise
- `"pattern mode: LLM generated no candidates"` — `{userId}` — pattern LLM returned nothing
- `"knowledge-mode insight verification complete"` — `{verificationStatus, hasSources}` — verification result for knowledge-mode insights
- `"pattern-mode insight verification complete"` — `{verificationStatus, clusterCount, fragmentCount}` — verification result for pattern-mode insights
- Gate messages now include `eventType` field showing which event source triggered this cycle

### Step 5: Fragment health (pattern mode diagnostics)

Check fragment collection and clustering status, critical for diagnosing pattern mode starvation:

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

  # Cluster formation (needed for pattern mode)
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
- **Zero `"fragments extracted"` entries** → fragment collector never succeeds. Check model config and that `collectFragmentsForTurn` is being called after conversation turns.
- **All `"fragment dedup hit"`** → fragments are redundant, not adding new signal.
- **`removed > 0` in maintenance** → fragments expiring faster than being collected.
- **`clusterCount: 0`** → fragments don't overlap enough to form multi-domain clusters (needs ≥2 fragments sharing ≥2 domains in a cluster). Pattern mode will fall back to surprise mode.

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
- **`byType: {domain_depth: N}` only** → scanCrossDomain/scanExploration producing nothing.
- **`recentTypes` shows repeated types** → informational only (type cooldown removed; domain cooldown still active via 0.5^n).
- **`poolSize: 1` consistently** → only one candidate survives penalties, low diversity in opportunities.
- **`pre-gen freshness check` fires frequently** → isTopicStale too aggressive, or recentInsightDomains too broad.

### Step 7: Verification status breakdown

Check how insights are being verified (or not). The pipeline uses three verification statuses:

- `"verified"` — knowledge mode with web sources found
- `"unverified"` — knowledge mode with no web sources (non-exploration insights are blocked)
- `"partial"` — pattern mode (behavioral inference, always bypasses verification gate)

```bash
LOG_DIR="/tmp/kaijibot"

for LOG_FILE in "$LOG_DIR"/kaijibot-*.log; do
  [ -f "$LOG_FILE" ] || continue
  echo "=== $(basename "$LOG_FILE") ==="

  # Pattern mode: bypasses verification
  grep '"pattern-mode insight bypasses verification gate"' "$LOG_FILE" | \
    jq -c '{time: .time, clusterCount: ."1".clusterCount, fragmentCount: ."1".fragmentCount, content: ."1".content}' 2>/dev/null

  # Knowledge mode: blocked for lack of sources
  grep '"insight candidate has no verifiable sources"' "$LOG_FILE" | \
    jq -c '{time: .time, sources: ."1".sources, content: ."1".content}' 2>/dev/null
done
```

Key diagnostics:
- **Frequent `"insight candidate has no verifiable sources"`** → web search consistently returning no results for targeted domains. Check search API config.
- **Many `"pattern-mode insight bypasses verification gate"`** with low `clusterCount`** → pattern mode producing insights from weak clusters.
- **No pattern mode entries at all** → patternModeRatio is 0, or fragment clusters are always empty (falls back to surprise).

### Step 7a: Feedback collector diagnostics

```bash
LOG_DIR="/tmp/kaijibot"
for LOG_FILE in "$LOG_DIR"/kaijibot-*.log; do
  [ -f "$LOG_FILE" ] || continue
  echo "=== $(basename "$LOG_FILE") ==="

  grep '"cognitive/feedback-collector"' "$LOG_FILE" | \
    jq -c '{time: .time, message: ."2", meta: ."1"}' 2>/dev/null
done
```

Key messages:
- `"implicit feedback bandits updated"` — `{signalCount, updatedTopics, topicProvided}` — implicit feedback from user response behavior. If `topicProvided: false` consistently, the `topic=undefined` bug is still present (see known issues).
- `"explicit insight feedback processed"` — `{domains, feedback, trustDelta}` — user explicitly liked/disliked an insight
- `"insight delivery signal recorded"` — `{insightId, domains}` — insight delivery recorded for feedback tracking

### Step 7b: Persona pipeline diagnostics

```bash
LOG_DIR="/tmp/kaijibot"
for LOG_FILE in "$LOG_DIR"/kaijibot-*.log; do
  [ -f "$LOG_FILE" ] || continue
  echo "=== $(basename "$LOG_FILE") ==="

  # Curator: domain discovery and phase transitions
  grep '"cognitive/persona-curator"' "$LOG_FILE" | \
    jq -c '{time: .time, message: ."2", meta: ."1"}' 2>/dev/null

  # Extractor: LLM vs rule-based extraction
  grep '"cognitive/persona-extractor"' "$LOG_FILE" | \
    jq -c '{time: .time, message: ."2", meta: ."1"}' 2>/dev/null
done
```

Key messages:
- `"new domain discovered"` — `{domain, depth, insights}` — new domain added to user's persona
- `"domain phase transition"` — `{domain, from, to}` — domain lifecycle phase change (emergent→stable→declining→dormant→revived)
- `"displayName synced"` — `{displayName, source}` — user's display name synchronized from coreTraits
- `"persona extraction completed"` — `{method, domainsFound, attributesFound, hasFocus}` — successful LLM extraction with counts
- `"persona extraction fell back to rule-based"` — `{reason}` — LLM failed, reason is one of: `error`, `empty`, `parse-failed`, `timeout`

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
  echo "Early exits: $(grep -c '"resolve: early exit"' "$LOG_FILE")"
  echo "Safety-net blocked: $(grep -c '"safety-net dedup"' "$LOG_FILE")"
  echo "Pattern mode bypasses: $(grep -c '"pattern-mode insight bypasses verification gate"' "$LOG_FILE")"
  echo "Web search cache hits: $(grep -c '"web search cache hit"' "$LOG_FILE")"
  echo "Force-alignments: $(grep -c '"force-aligned"' "$LOG_FILE")"
  echo "Unverified blocked: $(grep -c '"no verifiable sources"' "$LOG_FILE")"
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
- **模式**: [knowledge/pattern]
- **验证状态**: [verified/unverified/partial]
- **Pipeline**: [event source] → gate (pAct=X.XX) → search (N opportunities) → identify pool (top N) → freshness check → resolve (X attempts, best score: Y.YY)
- **Web search**: [triggered/skipped/n/a for pattern] — query: "...", N results, matched domains: [...]
- **质量评估**: [high/medium/low] — [1-sentence rationale]

### Gate 统计 (当日)
- 通过: N / 否决: N (通过率 XX%)
- 平均 pAct: X.XX

### 搜索类型分布 (当日)
- domain_depth: N 次 (XX%)
- cross_domain: N 次 (XX%)
- exploration: N 次 (XX%)
  - pattern: N 次
  - surprise: N 次
  - extend: N 次
- 多样性惩罚触发: N 次 (domain cooldown only, 0.5^n)

### 模式对比 (knowledge vs pattern)
- Knowledge 洞察: N 条 (XX%)
  - verified: N / unverified: N (blocked: N)
- Pattern 洞察: N 条 (XX%)
- 前置新鲜度拦截: N 条
- 安全网拦截: N 条
- Quality retry 平均轮次: X.X

### Fragment 诊断 (pattern mode 健康)
- Fragment 库: N 个 (有效 N / 过期 N)
- 集群: N 个 (平均大小 X.X)
- 冷启动: 是/否 (pattern mode needs clusters with ≥2 fragments)
- Pattern mode fallback: N 次 (clusters insufficient → surprise)

### 建议改进 (如有)
- [Any issues noticed: repeated topics, failed web searches, pattern starvation, etc.]
```

## Real-time Pipeline Monitor

A Python script provides real-time pipeline visualization with color-coded output.

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
| 2 | 🟢/🔴 GATE | green/red | PRISM gate pass/veto with pNeed, pAccept, pAct + eventType |
| 3 | 🔍 SEARCH | yellow | Number of opportunities found + **per-type breakdown** (cross_domain, domain_depth, exploration) |
| 3a | 🎲 ROUTE | yellow | Exploration mode routing: roll value, patternModeRatio, selectedMode (pattern/surprise/extend), fatigued domains |
| 4 | 🎯 IDENTIFY | cyan | **Pool size** (top N), top candidate type/domains/pAct + **recentTypes** (diversity penalty visibility) |
| 4a | 🧹 STALE | yellow | Pre-gen freshness check: stale candidate skipped (saves LLM tokens) |
| 4b | 🧩 PATTERN | cyan | Pattern mode: fragment cluster count + fragment count loaded |
| 5 | 🌐 WEB + 📊 MATCH | blue | Web search query, result count, domain matching (knowledge mode only) |
| 6 | 🤖 LLM GEN | magenta | Number of insight candidates (knowledge or pattern mode) |
| 6a | 🔄 RETRY + ✅ BEST | yellow/green | Quality retry: attempt count + early exit + final best score (knowledge mode only) |
| 6b | 🔀 PATH | blue | Knowledge mode path selection: self-refine vs blind-retry, mode, target domains |
| 6c | ⚠️ PATTERN ∅ | yellow | Pattern mode fallback: no clusters or no LLM output |
| 7 | ❌ PARSE FAIL | red | JSON parse errors |
| 8 | ✅/⚠️ VERIFY | green/yellow | Verification results for both knowledge and pattern modes (pass + fail) |
| 9 | 🚫 DEDUP | magenta | Safety-net: near-identical content blocked (0.95/0.8 thresholds) |
| 10 | 💡 INSIGHT ✓ | green | Final insight with mode tag (from new `mode` field), source tag, content preview, opportunityType |
| 11 | 📨 DELIVERED | green | Successfully sent to feishu |
| 12 | 🏁 DONE | green/dim | Pipeline completion status |
| — | 📊 FEEDBACK | cyan | Implicit bandit updates, explicit feedback, delivery signals |
| — | 🆕 PERSONA | blue | Domain discovery, phase transitions, displayName sync |
| — | 🧠 EXTRACTOR | green/yellow | LLM extraction results and fallback reasons |
| — | ✂️ FRAGMENT | dim | Turn-skip reasons (short messages, non-user turns) |

### Key patterns to watch for

- **`type=domain_depth` every time** → opportunity selection is monopolized, cross_domain never wins
- **`poolSize: 1` consistently** → only one candidate survives penalties, consider relaxing domain cooldown
- **`pre-gen freshness check` fires every cycle** → isTopicStale too aggressive, or recentInsightDomains too broad. No LLM calls happening.
- **`matchedDomains: (none)`** → web search results don't match user domains, insight has no factual grounding
- **Same `targetDomains` repeated** → always targeting the same domain
- **Gate vetoed with low pAct** → normal (PRISM cost gate working)
- **Zero `"fragments extracted"` in logs** → fragment collector never fires. Check model config and userId in persona.
- **`clusterCount: 0` consistently** → fragments don't overlap across domains. Pattern mode falls back to surprise.
- **No pattern-mode insights appearing** → patternModeRatio may be 0, or fragments/clusters insufficient for pattern mode
- **`byType` only has domain_depth** → cross-domain and exploration scan functions producing nothing
- **🚀 SCHEDULER START** → gateway was restarted, check if interval is correct
- **Pattern mode STEP 4b showing low cluster/fragment counts** → pattern mode running but with weak data, insights may be generic
- **`insight candidate has no verifiable sources` fires often** → web search failing or returning irrelevant results. Knowledge-mode non-exploration insights get blocked.
- **`resolve: quality retry` attempt=2/3 often** → first attempt quality low, retry rescuing insights
- **`safety-net dedup` fires frequently** → LLM generating near-identical content, check prompt diversity
- **Pattern mode insights all partial** → expected behavior. Pattern insights are behavioral inferences, not fact-checked.
- **`exploration mode routed` always same mode** → patternModeRatio misconfigured or surpriseWeight=0
- **`pattern mode: no clusters available` every pattern roll** → fragment data insufficient, clusters never form. Pattern mode is dead.
- **`pattern mode: LLM generated no candidates`** → pattern LLM returning empty, check model and prompt
- **`resolve: knowledge mode path selected` path=blind-retry** → self-refine disabled (no llmDeps or botConfig)
- **`knowledge-mode insight verification complete` status=unverified** → web search returning no results for the target domains
- **`persona extraction fell back to rule-based`** frequently → LLM extraction failing (check model, timeout, parse errors)
- **`feedback-collector: bandits` topicProvided=false** → the `topic=undefined` bug (known issue, bandit updates happening but topic field is always empty)
- **`domain phase transition` to dormant** → user's interest domains decaying, may need refresh from new conversations

## Config

Relevant config fields for tuning the pipeline:

- `cognitive.insight.patternModeRatio` — 0 to 1, default 0.5. Controls the ratio of pattern mode vs knowledge mode in exploration scans. Higher = more behavioral insights from conversation fragments.
- `cognitive.insight.engine` — accepts "v1"/"v2"/"dual"/"knowledge"/"pattern"/"unified". Controls which pipeline engine is active.
- `cognitive.proactive.minIntervalHours` — minimum interval between proactive insight cycles
- `cognitive.proactive.activeHours` — hours when proactive insights are allowed

## Quality Assessment Rubric

Rate each insight on a 3-level scale:

- **高**: Cross-domain surprise OR resolves a pending question OR challenges an assumption with external evidence, OR reveals a non-obvious behavioral pattern from conversation history
- **中**: Useful but relies on recombining known knowledge without external input, or is a best-practice reminder, OR a plausible behavioral observation that lacks specificity
- **低**: Semantically duplicates a recent insight, is generic advice, or has no grounding in user's specific context
