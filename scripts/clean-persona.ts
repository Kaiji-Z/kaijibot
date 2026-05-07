import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { completeSimple, type Api, type Model, type TextContent } from "@mariozechner/pi-ai";
import { prepareSimpleCompletionModel } from "../src/agents/simple-completion-runtime.js";

const PERSONA_PATH = process.argv[2];
if (!PERSONA_PATH) {
  console.error("Usage: bun scripts/clean-persona.ts <persona.json-path>");
  process.exit(1);
}

const INSIGHT_CATEGORY_DESCRIPTIONS: Record<string, string> = {
  domain_knowledge: "Factual knowledge about a domain the user possesses",
  behavioral_pattern: "Repeated behaviors or thinking patterns observed in the user",
  stated_preference: "Explicit preferences the user has expressed",
  tool_config: "Configuration, usage, or evaluation of tools/APIs/services",
  contextual_fact: "Situational facts about the user's current context or environment",
  goal_or_aspiration: "Long-term goals, aspirations, or ambitions the user mentioned",
};

type InsightCategory = keyof typeof INSIGHT_CATEGORY_DESCRIPTIONS;

interface TypedInsight {
  text: string;
  category: InsightCategory;
  confidence: number;
  source: "explicit" | "inferred" | "observed";
  firstObserved: number;
  lastReinforced: number;
  evidenceCount: number;
  halfLifeDays: number;
}

const HALF_LIFE_BY_CATEGORY: Record<InsightCategory, number> = {
  tool_config: 7,
  contextual_fact: 14,
  domain_knowledge: 30,
  stated_preference: 60,
  behavioral_pattern: 90,
  goal_or_aspiration: 90,
};

function isTextBlock(b: { type: string }): b is TextContent {
  return b.type === "text";
}

async function classifyInsights(
  insights: string[],
  domainName: string,
  complete: typeof completeSimple,
  model: Model<Api>,
  apiKey: string,
): Promise<Array<{ text: string; category: InsightCategory; shouldKeep: boolean }>> {
  if (insights.length === 0) return [];

  const insightList = insights.map((t, i) => `${i + 1}. ${t}`).join("\n");

  const prompt = `You are a persona data cleaning system. Analyze each insight in the "${domainName}" domain and:
1. Classify into one of these categories:
${Object.entries(INSIGHT_CATEGORY_DESCRIPTIONS).map(([k, v]) => `   - ${k}: ${v}`).join("\n")}
2. Mark as shouldKeep=false if it is:
   - A generic/vague statement that provides no actionable knowledge (e.g. "正在讨论...", "涉及...", "持续监控...")
   - A duplicate or near-duplicate of another insight in this list
   - About the user configuring/using this specific bot (KaijiBot) rather than domain knowledge
   - A description of what the user is currently doing (transient) rather than lasting knowledge
3. For insights marked shouldKeep=true, optionally rewrite the text to be more concise and specific if the original is wordy or imprecise.

Insights:
${insightList}

Respond with ONLY a JSON array (no markdown, no code fences):
[
  {"index": 1, "category": "tool_config", "shouldKeep": false},
  {"index": 2, "category": "domain_knowledge", "shouldKeep": true, "rewritten": "concise version"}
]

Rules:
- Be aggressive about removing noise — keep only insights that would help generate meaningful proactive insights
- tool_config and contextual_fact should generally be shouldKeep=false unless they reveal a genuine user interest
- The "rewritten" field is optional — only include if you improve the text
- Preserve the original meaning when rewriting`;

  const result = await complete(
    model,
    { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
    { apiKey, maxTokens: 2000, temperature: 0.2, signal: AbortSignal.timeout(30_000) },
  );

  const text = result.content.filter(isTextBlock).map((b) => b.text).join("").trim();
  const cleaned = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: Record<string, unknown>) => ({
      text: typeof item.rewritten === "string" ? item.rewritten : insights[(Number(item.index ?? 0)) - 1] ?? "",
      category: isValidCategory(item.category) ? item.category as InsightCategory : "domain_knowledge",
      shouldKeep: Boolean(item.shouldKeep),
    }));
  } catch {
    return [];
  }
}

function isValidCategory(v: unknown): boolean {
  return typeof v === "string" && v in INSIGHT_CATEGORY_DESCRIPTIONS;
}

async function main() {
  console.log("Loading persona:", PERSONA_PATH);
  const raw = await readFile(PERSONA_PATH, "utf-8");
  const persona = JSON.parse(raw);

  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) {
    console.error("ZAI_API_KEY env var required");
    process.exit(1);
  }

  const prepared = await prepareSimpleCompletionModel({
    cfg: {} as never,
    provider: "zai",
    modelId: "glm-5-turbo",
  });
  if ("error" in prepared) {
    console.error("Model prep failed:", prepared.error);
    process.exit(1);
  }

  console.log("\n=== Cleaning coreTraits ===");
  const traitsToRemove: string[] = [];
  const traitsToFix: Array<{ key: string; newValue: string }> = [];

  for (const [key, val] of Object.entries(persona.identity.coreTraits)) {
    const v = val as { value: string; confidence: number; source: string; evidenceCount: number };
    if (key === "角色" && v.value === "kaijibot用户") {
      traitsToRemove.push(key);
      console.log(`  REMOVE: ${key} = "${v.value}" (meaningless, conf=${v.confidence.toFixed(2)})`);
      continue;
    }
    if (key === "自我描述" && (v.value === "三件事：" || v.value.includes("GitHub热门AI项目"))) {
      traitsToRemove.push(key);
      console.log(`  REMOVE: ${key} = "${v.value}" (extraction failure)`);
      continue;
    }
    if (key === "技术角色" && v.confidence < 0.6) {
      const merged = { ...v, value: "AI系统开发者/架构师", confidence: 0.9, source: "observed" };
      persona.identity.coreTraits[key] = merged;
      console.log(`  FIX: ${key}: "${v.value}" → "${merged.value}" (conf ${v.confidence.toFixed(2)} → 0.90)`);
      continue;
    }
    if (v.confidence < 0.25) {
      traitsToRemove.push(key);
      console.log(`  REMOVE: ${key} = "${v.value}" (too low confidence: ${v.confidence.toFixed(2)})`);
    }
  }

  for (const key of traitsToRemove) {
    delete persona.identity.coreTraits[key];
  }

  console.log("\n=== Cleaning domain insights ===");
  for (const [domainName, domain] of Object.entries(persona.domains)) {
    const d = domain as {
      keyInsights: string[];
      insights: TypedInsight[];
      activeQuestions: string[];
      lastMentioned: number;
      [k: string]: unknown;
    };

    if (d.keyInsights.length === 0 && (d.insights?.length ?? 0) === 0) {
      console.log(`  ${domainName}: no insights to clean`);
      continue;
    }

    const allTexts = d.keyInsights.length > 0 ? d.keyInsights : (d.insights ?? []).map((i) => i.text);
    console.log(`  ${domainName}: classifying ${allTexts.length} insights...`);

    try {
      const classified = await classifyInsights(allTexts, domainName, completeSimple, prepared.model, prepared.auth.apiKey);
      const kept = classified.filter((c) => c.shouldKeep);
      const removed = classified.filter((c) => !c.shouldKeep);

      if (removed.length > 0) {
        console.log(`    REMOVED ${removed.length}:`);
        for (const r of removed) {
          console.log(`      - [${r.category}] ${r.text.slice(0, 60)}...`);
        }
      }

      const now = d.lastMentioned;
      d.insights = kept.map((c) => ({
        text: c.text,
        category: c.category,
        confidence: c.category === "tool_config" ? 0.3 : 0.6,
        source: "inferred" as const,
        firstObserved: now,
        lastReinforced: now,
        evidenceCount: 1,
        halfLifeDays: HALF_LIFE_BY_CATEGORY[c.category],
      }));

      d.keyInsights = kept
        .filter((c) => c.category !== "tool_config" && c.category !== "contextual_fact")
        .map((c) => c.text);

      console.log(`    KEPT ${kept.length}, REMOVED ${removed.length}`);
    } catch (err) {
      console.log(`    ERROR classifying ${domainName}: ${String(err)}`);
    }
  }

  console.log("\n=== Cleaning activeQuestions ===");
  const oneShotPatterns = [
    /^(什么|怎么|如何|为什么|哪个|哪个|是不是|多少|几)/,
    /\?$/, /？$/,
    /^(最新|最近|今天|昨天)/,
  ];
  for (const [domainName, domain] of Object.entries(persona.domains)) {
    const d = domain as { activeQuestions: string[] };
    const before = d.activeQuestions.length;
    d.activeQuestions = d.activeQuestions.filter((q) => {
      if (q.length < 5 || q.length > 80) return false;
      return true;
    });
    if (d.activeQuestions.length < before) {
      console.log(`  ${domainName}: ${before} → ${d.activeQuestions.length} questions`);
    }
  }

  console.log("\n=== Cleaning recentFocus ===");
  const noisePatterns = [
    /^(AI|认知|工具|技能)/,
    /概念理解$/, /架构$/, /运维$/,
  ];
  const before = persona.recentFocus.length;
  persona.recentFocus = persona.recentFocus.filter((f: string) => {
    for (const p of noisePatterns) {
      if (p.test(f)) return false;
    }
    return f.length >= 3 && f.length <= 20;
  });
  console.log(`  ${before} → ${persona.recentFocus.length} focus items`);

  const tmpPath = join(tmpdir(), `kaijibot-persona-clean-${randomUUID()}.json`);
  await writeFile(tmpPath, JSON.stringify(persona, null, 2), "utf-8");

  const backupPath = PERSONA_PATH + ".bak";
  await rename(PERSONA_PATH, backupPath);
  await rename(tmpPath, PERSONA_PATH);

  console.log(`\nDone! Backup: ${backupPath}`);
  console.log(`Cleaned persona: ${PERSONA_PATH}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
