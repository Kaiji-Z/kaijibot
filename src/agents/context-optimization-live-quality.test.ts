/**
 * Live verification — real LLM behavior under optimized context engineering.
 *
 * Run: KAIJIBOT_LIVE_TEST=1 ZAI_API_KEY=$ZAI_API_KEY pnpm test src/agents/context-optimization.live.test.ts
 *
 * Validates 4 optimization pillars against real LLM (not just code structure):
 *   1. W2.2 — Lost in the Middle: corrections at tail are followed
 *   2. W2.3 — Information density: pruned Capabilities still preserves proactive identity
 *   3. W4.1 — Trigger-based retrieval: relevant corrections drive agent behavior
 *   4. W6.1 — Priority declaration: conflicts resolved by layer hierarchy
 */

import { describe, it, expect } from "vitest";
import { selectRelevantCorrections } from "../cognitive/correction/injector.js";
import type { CorrectionRecord } from "../cognitive/correction/types.js";
import { buildAgentSystemPrompt } from "./system-prompt.js";

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const ZAI_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODEL = "glm-5.2";

async function callLLM(systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch(ZAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${ZAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 500,
    }),
  });
  const data = (await res.json()) as {
    error?: { message: string };
    choices?: Array<{ message: { content: string } }>;
  };
  if (data.error) {
    throw new Error(data.error.message);
  }
  return data.choices?.[0]?.message?.content ?? "";
}

function makeCorrection(overrides?: Partial<CorrectionRecord>): CorrectionRecord {
  return {
    id: `corr-${Math.random().toString(36).slice(2, 8)}`,
    domain: "general",
    trigger: "general",
    mistake: "mistake",
    correction: "correction",
    provenance: "self",
    reinforcedCount: 1,
    createdAt: Date.now(),
    lastReinforced: Date.now(),
    ...overrides,
  };
}

function buildMinimalSystemPrompt(extraSystemPrompt?: string): string {
  return buildAgentSystemPrompt({
    workspaceDir: "/tmp/kaijibot-live-verify",
    toolNames: ["read", "exec", "message"],
    userTimezone: "Asia/Shanghai",
    extraSystemPrompt,
  });
}

describe.skipIf(!isLive || !ZAI_API_KEY)(
  "live context optimization verification — real LLM",
  () => {
    const TIMEOUT = 60_000;

    describe("W2.2: Lost in the Middle — corrections at tail are followed", () => {
      it(
        "agent can recall correction content from cognitive-context tail",
        async () => {
          const uniqueMarker = "QWX-RYZ-7741";
          const systemPrompt = buildMinimalSystemPrompt(
            [
              "## Known Corrections",
              `1. [testing] When testing context injection, the marker code is ${uniqueMarker}. → Remember ${uniqueMarker}.`,
              "## Current Mode: Task Execution",
              "Execute precisely.",
            ].join("\n\n"),
          );

          const reply = await callLLM(
            systemPrompt,
            "请把你从 Known Corrections 里看到的所有内容原文告诉我。",
          );
          console.log(`\n  Reply: ${reply.slice(0, 300)}\n`);

          const recallsMarker = reply.includes(uniqueMarker);
          console.log(
            `  Correction visible to LLM (marker ${uniqueMarker} recalled): ${recallsMarker}`,
          );
          expect(recallsMarker).toBe(true);
        },
        TIMEOUT,
      );

      it(
        "agent follows mode instruction placed at tail (Current Mode: Task)",
        async () => {
          const systemPrompt = buildMinimalSystemPrompt(
            ["## Current Mode: Task Execution", "Execute precisely. No unsolicited insights."].join(
              "\n\n",
            ),
          );

          const reply = await callLLM(systemPrompt, "帮我算一下 15 * 23");
          console.log(`\n  Reply: ${reply.slice(0, 200)}\n`);

          const isConcise = reply.length < 300 || !/insight|洞察|顺便|proactively/i.test(reply);
          console.log(`  Mode-respected (concise, no unsolicited insight): ${isConcise}`);
          expect(isConcise).toBe(true);
        },
        TIMEOUT,
      );
    });

    describe("W2.3: Information density — pruned Capabilities preserve proactive identity", () => {
      it(
        "agent still identifies as proactive after Core Abilities removal",
        async () => {
          const systemPrompt = buildMinimalSystemPrompt();

          const reply = await callLLM(systemPrompt, "你能做什么？你是什么样的助手？");
          console.log(`\n  Reply: ${reply.slice(0, 300)}\n`);

          const mentionsProactive = /主动|proactive|洞察|insight|不是被动|not.*passive|积极/i.test(
            reply,
          );
          console.log(`  Mentions proactive identity: ${mentionsProactive}`);
          expect(mentionsProactive).toBe(true);
        },
        TIMEOUT,
      );

      it(
        "agent does NOT list generic abilities (proof that Core Abilities pruning works)",
        async () => {
          const systemPrompt = buildMinimalSystemPrompt();

          const reply = await callLLM(systemPrompt, "你能做什么？简要回答。");
          console.log(`\n  Reply: ${reply.slice(0, 300)}\n`);

          const listsGenericAbilities =
            /conversational ai|tool use.*execute shell|three-layer memory|multi-agent.*spawn sub/i.test(
              reply,
            );
          console.log(
            `  Lists generic (model-known) abilities: ${listsGenericAbilities} (should be false)`,
          );
          expect(listsGenericAbilities).toBe(false);
        },
        TIMEOUT,
      );
    });

    describe("W4.1: Trigger-based retrieval — relevant corrections drive behavior", () => {
      it(
        "selects git-relevant correction and agent follows it",
        async () => {
          const gitCorrection = makeCorrection({
            id: "git-1",
            domain: "git",
            trigger: "git commit code",
            mistake: "commit code without descriptive message",
            correction: "always include a descriptive commit message with ticket number",
            reinforcedCount: 5,
          });
          const irrelevantCorrections = Array.from({ length: 19 }, (_, i) =>
            makeCorrection({
              id: `cooking-${i}`,
              domain: "cooking",
              trigger: `baking ${i}`,
              mistake: `wrong temperature for recipe ${i}`,
              correction: `check recipe ${i} temperature`,
              reinforcedCount: 100 - i,
            }),
          );
          const all = [gitCorrection, ...irrelevantCorrections];

          const selected = selectRelevantCorrections(all, "帮我 commit 代码", 5);
          console.log(`\n  Selected ${selected.length} corrections (from ${all.length} total):`);
          selected.forEach((c) => console.log(`    - [${c.domain}] ${c.mistake}`));

          const gitSelected = selected.some((c) => c.id === "git-1");
          console.log(`\n  Git correction selected: ${gitSelected}`);
          expect(gitSelected).toBe(true);

          const correctionsPrompt = selected
            .map((c, i) => `${i + 1}. [${c.trigger}] ${c.mistake} → ${c.correction}`)
            .join("\n");
          const systemPrompt = buildMinimalSystemPrompt(
            `## Known Corrections\n${correctionsPrompt}`,
          );

          const reply = await callLLM(systemPrompt, "帮我写 commit message，有什么要注意的？");
          console.log(`\n  Reply: ${reply.slice(0, 300)}\n`);

          const mentionsCommitMessage = /message|描述|说明|ticket|comment/i.test(reply);
          console.log(
            `  Agent followed correction (mentions commit message): ${mentionsCommitMessage}`,
          );
          expect(mentionsCommitMessage).toBe(true);
        },
        TIMEOUT,
      );
    });

    describe("W6.1: Priority declaration — layer hierarchy resolves conflicts", () => {
      it(
        "project-doc rule overrides cognitive-context rule",
        async () => {
          const systemPrompt = buildAgentSystemPrompt({
            workspaceDir: "/tmp/kaijibot-live-verify",
            toolNames: ["read"],
            userTimezone: "Asia/Shanghai",
            contextFiles: [
              {
                path: "AGENTS.md",
                content:
                  "# Project Rule\nWhen replying, you MUST respond entirely in English. This is a hard project rule.",
              },
            ],
            extraSystemPrompt:
              "## User Cognitive Profile\nCommunication Style: Formalality: casual, preferredLanguage: zh (Chinese).",
          });

          const reply = await callLLM(systemPrompt, "你好，请介绍一下你自己");
          console.log(`\n  Reply: ${reply.slice(0, 300)}\n`);

          const mostlyEnglish =
            reply.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w)).length >
            reply.split(/\s+/).length * 0.5;
          const hasChinese = /[\u4e00-\u9fff]/.test(reply);
          console.log(`  Mostly English (>50% latin words): ${mostlyEnglish}`);
          console.log(`  Contains Chinese: ${hasChinese}`);

          expect(mostlyEnglish).toBe(true);
        },
        TIMEOUT,
      );
    });

    describe("End-to-end: full optimized prompt produces quality response", () => {
      it(
        "agent introduces itself correctly with full optimized prompt",
        async () => {
          const systemPrompt = buildAgentSystemPrompt({
            workspaceDir: "/tmp/kaijibot-live-verify",
            toolNames: ["read", "exec", "process", "cron", "message", "gateway"],
            userTimezone: "Asia/Shanghai",
            runtimeInfo: {
              agentId: "main",
              host: "live-test",
              os: "linux",
              arch: "x64",
              node: "v22",
              provider: "zai",
              model: "glm-5.2",
              channel: "feishu",
            },
            contextFiles: [{ path: "AGENTS.md", content: "# Project rules\nBe helpful." }],
            extraSystemPrompt: [
              "## User Cognitive Profile",
              "Traits: 称呼: TestUser (90%)",
              "## Current Mode: Hybrid",
              "Execute task first, then brief insight.",
            ].join("\n\n"),
          });

          const reply = await callLLM(systemPrompt, "你好，你能帮我做什么？");
          console.log(`\n  Full reply (${reply.length} chars):\n${reply.slice(0, 500)}\n`);

          const qualityChecks = {
            mentionsIdentity: /助手|assistant|kaijibot/i.test(reply),
            notEmpty: reply.length > 20,
            noGenericList: !/conversational ai|three-layer memory/i.test(reply),
          };

          console.log(`  Quality checks:`, qualityChecks);
          expect(qualityChecks.notEmpty).toBe(true);
          expect(qualityChecks.noGenericList).toBe(true);
        },
        TIMEOUT,
      );
    });
  },
);
