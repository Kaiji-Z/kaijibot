/**
 * Live test: verify the quality gate works with real LLM calls.
 * Ensures generated skills pass the 4-dimension quality evaluation.
 *
 * Run: KAIJIBOT_LIVE_TEST=1 ZAI_API_KEY=$ZAI_API_KEY pnpm test src/cognitive/evolution/skill-quality-gate-live.test.ts
 */

import { describe, it, expect } from "vitest";
import { loadConfig } from "../../config/config.js";
import { createStandaloneGenerateText } from "./standalone-generate.js";
import { evaluateSkillQuality, refineSkillDraft } from "./skill-quality-gate.js";
import type { SkillDraft } from "./types.js";

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;

const goodDraft: SkillDraft = {
  name: "feishu-meeting-archive",
  description: "Archive meeting notes to feishu wiki with task extraction",
  triggerPhrases: ["帮我把会议纪要归档", "archive meeting notes to wiki"],
  bodyMarkdown: `## Workflow

1. Use \`feishu_vc_search\` to find the meeting by keywords
2. Use \`feishu_vc_notes\` to get the full notes content
3. Use \`feishu_wiki_create\` to create a wiki document
4. Use \`feishu_doc_write\` to write notes into the document
5. Optionally use \`feishu_task_create\` for action items`,
};

const badDraft: SkillDraft = {
  name: "do-stuff",
  description: "Do stuff",
  triggerPhrases: ["do the thing", "help me"],
  bodyMarkdown: `## Workflow

Just do it. Use tools to accomplish the task. Make sure it's done correctly.`,
};

describe.skipIf(!isLive || !ZAI_API_KEY)(
  "quality gate — real LLM evaluation",
  () => {
    it("evaluates a high-quality draft as passing", async () => {
      const generateText = await createStandaloneGenerateText(
        loadConfig() as never,
        { maxTokens: 1000, timeout: 60_000 },
      );

      const result = await evaluateSkillQuality(goodDraft, { generateText });

      console.log(`  Quality: ${result.score.toFixed(2)}/1.0`);
      console.log(`  Critique: ${result.critique}`);
      console.log(`  Issues: ${JSON.stringify(result.issues)}`);

      expect(result.score).toBeGreaterThan(0);
      expect(result.passed).toBeDefined();
    }, 90_000);

    it("evaluates a low-quality draft as failing", async () => {
      const generateText = await createStandaloneGenerateText(
        loadConfig() as never,
        { maxTokens: 1000, timeout: 60_000 },
      );

      const result = await evaluateSkillQuality(badDraft, { generateText });

      console.log(`  Quality: ${result.score.toFixed(2)}/1.0`);
      console.log(`  Critique: ${result.critique}`);
      console.log(`  Issues: ${JSON.stringify(result.issues)}`);

      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    }, 90_000);

    it("refine loop improves a bad draft", async () => {
      const generateText = await createStandaloneGenerateText(
        loadConfig() as never,
        { maxTokens: 4000, timeout: 60_000 },
      );

      const initial = await evaluateSkillQuality(badDraft, { generateText });
      console.log(`  Initial: ${initial.score.toFixed(2)} — ${initial.critique}`);

      if (!initial.passed) {
        const refined = await refineSkillDraft(badDraft, initial.critique, initial.issues, { generateText });
        const after = await evaluateSkillQuality(refined, { generateText });
        console.log(`  Refined name: ${refined.name}`);
        console.log(`  After: ${after.score.toFixed(2)} — ${after.critique}`);
        console.log(`  Improvement: +${(after.score - initial.score).toFixed(2)}`);
        expect(refined.name).toBeDefined();
        expect(refined.name.length).toBeGreaterThan(0);
      }
    }, 120_000);
  },
);
