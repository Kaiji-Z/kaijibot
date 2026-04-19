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
   - Subsystem `"cognitive/scheduler"` — gate decisions, search, identify, insight output
   - Subsystem `"cognitive/insight-llm"` — web search calls, domain matching, LLM generation
   - Log line format: `{"0":"{\"subsystem\":\"cognitive/...\"}","1":{...meta},"2":"message","time":"ISO"}`

3. **Source code** (for reference, not routine queries)
   - `src/cognitive/insight/llm-engine.ts` — LLM insight generation + web search
   - `src/cognitive/scheduler/proactive-scheduler.ts` — SIRI loop
   - `src/cognitive/scheduler/gate.ts` — PRISM gate

## Query Procedure

Execute these steps in sequence. Adapt date ranges and grep patterns as needed.

### Step 1: Read persona data

```bash
PERSONA_FILE=$(ls -t ~/.kaijibot/cognitive/persona/main/*.json | head -1)
jq '{
  lastProactiveAt: .feedbackProfile.lastProactiveAt,
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

Find all successful insight generations for a given date range:

```bash
LOG_DIR="/tmp/kaijibot"
# Adjust date as needed. For today:
TODAY=$(date +%Y-%m-%d)
YESTERDAY=$(date -d "yesterday" +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d)

# Find "insight generated" entries (successful output)
for LOG_FILE in "$LOG_DIR"/kaijibot-${TODAY}.log "$LOG_DIR"/kaijibot-${YESTERDAY}.log; do
  [ -f "$LOG_FILE" ] || continue
  echo "=== $(basename "$LOG_FILE") ==="
  grep '"insight generated"' "$LOG_FILE" | jq -c '{time: .time, contentPreview: ."1".contentPreview, insightId: ."1".insightId, sourceCount: ."1".sourceCount, hasWebSources: ."1".hasWebSources, targetDomains: ."1".targetDomains}' 2>/dev/null
done
```

### Step 3: Trace full pipeline for each insight

For each insight found in Step 2, extract the complete pipeline trace by searching for log entries within ±60 seconds of the insight timestamp:

```bash
# Extract the timestamp from an insight entry, then search nearby
TARGET_TIME="2026-04-18T02:20"  # adjust per insight
LOG_FILE="/tmp/kaijibot/kaijibot-2026-04-18.log"

# Full pipeline trace: gate → search → identify → web search → LLM → insight generated
grep -E "(gate |search |identify |insight generated|web search|domain matching|gate vetoed)" "$LOG_FILE" | \
  grep -A0 -B0 "cognitive/" | \
  awk -v target="$TARGET_TIME" '{
    # Filter for entries within ~2 minutes of target
    if ($0 ~ target) print
  }' | \
  jq -c '{time: .time, subsystem: ."0", message: ."2", meta: ."1"}' 2>/dev/null
```

### Step 4: Check web search invocations

Web search logs are under subsystem `"cognitive/insight-llm"`:

```bash
grep "cognitive/insight-llm" "$LOG_FILE" | \
  jq -c '{time: .time, message: ."2", meta: ."1"}' 2>/dev/null
```

Key messages to look for:
- `"web search completed"` — `{query, resultCount}`
- `"web search failed"` — `{query, error}`
- `"web search skipped"` — reason: empty query or no dep
- `"web search domain matching"` — `{totalResults, matchedDomains, unmatchedSnippets}`
- `"LLM generated N insight candidate(s)"`
- `"LLM returned empty response"` / `"LLM response could not be parsed"`

### Step 5: Gate statistics (optional)

Summary of gate decisions for a day:

```bash
echo "Gate passed: $(grep -c '"gate passed"' "$LOG_FILE")"
echo "Gate vetoed: $(grep -c '"gate vetoed"' "$LOG_FILE")"
echo "Insights generated: $(grep -c '"insight generated"' "$LOG_FILE")"
echo "No insight: $(grep -c '"identify selected nothing"' "$LOG_FILE")"
```

## Report Format

Structure the report as:

```
## 洞察报告 — [date range]

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
- **Pipeline**: [event source] → gate (pAct=X.XX) → search (N opportunities) → identify ([type], targetDomains=[...]) → resolve
- **Web search**: [triggered/skipped] — query: "...", N results, matched domains: [...]
- **质量评估**: [high/medium/low] — [1-sentence rationale]

### Gate 统计 (当日)
- 通过: N / 否决: N (通过率 XX%)
- 平均 pAct: X.XX

### 建议改进 (如有)
- [Any issues noticed: repeated topics, failed web searches, etc.]
```

## Quality Assessment Rubric

Rate each insight on a 3-level scale:

- **高**: Cross-domain surprise OR resolves a pending question OR challenges an assumption with external evidence
- **中**: Useful but relies on recombining known knowledge without external input, or is a best-practice reminder
- **低**: Semantically duplicates a recent insight, is generic advice, or has no grounding in user's specific context
