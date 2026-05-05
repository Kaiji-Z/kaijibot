import type { EvolutionCandidate, SkillDraft } from "./types.js";
import { generateSkillDraft, sanitizeSkillName } from "./skill-draft-generator.js";
import { SKILL_CREATOR_SPEC } from "./skill-creator-spec.js";

export type LlmDraftDeps = {
  generateText: (prompt: string) => Promise<string>;
};

function buildPrompt(candidate: EvolutionCandidate): string {
  const sections: string[] = [
    SKILL_CREATOR_SPEC,
    "",
    "---",
    "",
    "## Task to Analyze",
    "",
    "The following is a completed task. Generate a reusable SKILL.md for it.",
    "",
    "### Task Summary",
    candidate.taskSummary,
    "",
    "### Domain",
    candidate.domain,
    "",
    "### Tools Used",
    ...candidate.toolCalls.map((t, i) => `${i + 1}. ${t}`),
    "",
    "### Reasoning Turns",
    String(candidate.reasoningTurns),
    "",
    "### Duration (ms)",
    String(candidate.durationMs),
  ];

  if (candidate.transcript) {
    sections.push(
      "",
      "### Transcript",
      candidate.transcript,
    );
  }

  sections.push(
    "",
    "---",
    "",
    "## Output Instructions",
    "",
    "Based on the skill-creator specification above, generate a complete SKILL.md file for the completed task.",
    "Output ONLY the SKILL.md content starting with `---` frontmatter.",
    "",
    "Requirements:",
    "- YAML frontmatter with `name:` (kebab-case) and `description:` (comprehensive — what the skill does AND when to use it, this is the trigger mechanism)",
    "- A `## Triggers` section with a bulleted list of 3-7 trigger phrases (mix Chinese and English)",
    "- Body follows skill-creator principles: progressive disclosure, appropriate degrees of freedom, concise examples, imperative form",
    "- Body under 200 lines (auto-generated skill)",
    "- Do NOT include Steps 3/5 from skill-creator (init_skill.py, package_skill.py) — those are manual workflow steps",
    "- Use imperative/infinitive form throughout",
    "- Include workflow steps and concise usage guidance",
    "- If the skill needs executable helper scripts, include a ## Scripts section with fenced code blocks tagged with the filename (e.g., ```python:scripts/main.py)",
    "- If the skill needs reference docs, include a ## References section with tagged blocks (e.g., ```markdown:references/api.md)",
    "- If neither is needed, omit them — body-only skills are perfectly valid",
  );

  return sections.join("\n");
}

function validateAndRepair(raw: string, candidate: EvolutionCandidate): SkillDraft {
  let text = raw.trim();

  const fenceMatch = text.match(/^```(?:markdown|md)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  const firstDash = text.indexOf("---");
  if (firstDash === -1) return generateSkillDraft(candidate);

  const afterFirst = text.indexOf("---", firstDash + 3);
  if (afterFirst === -1) return generateSkillDraft(candidate);

  const frontmatter = text.slice(firstDash + 3, afterFirst).trim();
  const body = text.slice(afterFirst + 3).trim();

  if (!body) return generateSkillDraft(candidate);

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

  if (!nameMatch || !descMatch) return generateSkillDraft(candidate);

  const name = sanitizeSkillName(nameMatch[1].trim());
  const rawDesc = descMatch[1].trim();
  let description: string;
  if (rawDesc === ">" || rawDesc === "|") {
    const afterMarker = frontmatter.slice(descMatch.index! + descMatch[0].length);
    const lines = afterMarker.split("\n");
    const folded: string[] = [];
    for (const line of lines.slice(1)) {
      if (!line.startsWith(" ") && !line.startsWith("\t") && line.trim() !== "") break;
      folded.push(line.trim());
    }
    description = folded.filter(Boolean).join(" ");
  } else {
    description = rawDesc.replace(/^["']|["']$/g, "");
  }
  if (!description) return generateSkillDraft(candidate);

  const { phrases: triggerPhrases, stripped: bodyNoTriggers } = extractAndStripTriggers(body);
  if (triggerPhrases.length === 0) return generateSkillDraft(candidate);

  const { body: cleanBody, scripts, references, assets } = extractTaggedBlocks(bodyNoTriggers);

  return { name, description, triggerPhrases, bodyMarkdown: cleanBody, scripts, references, assets };
}

function extractAndStripTriggers(body: string): { phrases: string[]; stripped: string } {
  const triggerHeading = body.match(/^##\s+Triggers\s*$/m);
  if (!triggerHeading || triggerHeading.index === undefined) return { phrases: [], stripped: body };

  const afterHeading = body.slice(triggerHeading.index + triggerHeading[0].length);
  const nextHeading = afterHeading.match(/^##\s/m);
  const section = nextHeading ? afterHeading.slice(0, nextHeading.index) : afterHeading;

  const phrases: string[] = [];
  for (const line of section.split("\n")) {
    const bulletMatch = line.match(/^\s*-\s+(.+)$/);
    if (bulletMatch) {
      phrases.push(bulletMatch[1].trim());
    }
  }

  const sectionEnd = nextHeading?.index ?? section.length;
  const fullSectionLength = triggerHeading[0].length + sectionEnd;
  const stripped =
    body.slice(0, triggerHeading.index) + body.slice(triggerHeading.index + fullSectionLength);
  const normalized = stripped.replace(/\n{3,}/g, "\n\n").trim();

  return { phrases, stripped: normalized };
}

export function extractTaggedBlocks(body: string): {
  body: string;
  scripts?: Record<string, string>;
  references?: Record<string, string>;
  assets?: Record<string, string>;
} {
  const scripts: Record<string, string> = {};
  const references: Record<string, string> = {};
  const assets: Record<string, string> = {};

  const fencedBlockRegex = /^```[\w]*:([\w/.-]+)\s*\n([\s\S]*?)\n\s*```/gm;
  let match: RegExpExecArray | null;
  let cleanBody = body;

  while ((match = fencedBlockRegex.exec(body)) !== null) {
    const filePath = match[1];
    const content = match[2];

    if (filePath.startsWith("scripts/")) {
      scripts[filePath.replace("scripts/", "")] = content;
    } else if (filePath.startsWith("references/")) {
      references[filePath.replace("references/", "")] = content;
    } else if (filePath.startsWith("assets/")) {
      assets[filePath.replace("assets/", "")] = content;
    }

    cleanBody = cleanBody.replace(match[0], "");
  }

  return {
    body: cleanBody.replace(/\n{3,}/g, "\n\n").trim(),
    scripts: Object.keys(scripts).length > 0 ? scripts : undefined,
    references: Object.keys(references).length > 0 ? references : undefined,
    assets: Object.keys(assets).length > 0 ? assets : undefined,
  };
}

export async function generateSkillDraftLLM(
  candidate: EvolutionCandidate,
  deps: LlmDraftDeps,
): Promise<SkillDraft> {
  try {
    const prompt = buildPrompt(candidate);
    const response = await deps.generateText(prompt);
    return validateAndRepair(response, candidate);
  } catch {
    return generateSkillDraft(candidate);
  }
}

export { buildPrompt, validateAndRepair };
