/**
 * Topic Router — classifies content into existing or new topics via LLM.
 *
 * Pure function with injectable deps. No direct LLM imports.
 * The caller injects the `generateText` callback.
 */

// Types

export interface TopicCandidate {
  name: string;
  description: string;
}

export interface RouteResult {
  topicName: string;
  isNew: boolean;
  description?: string;
}

export interface RouteToTopicParams {
  /** LLM-generated summary of the conversation/session content */
  summary: string;
  /** Existing topics with name + description from registry */
  existingTopics: TopicCandidate[];
  /** Injectable LLM call: takes prompt, returns raw text */
  generateText: (prompt: string) => Promise<string>;
}

// Helpers

export function kebabMatch(a: string, b: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  return normalize(a) === normalize(b);
}

function buildPrompt(summary: string, existingTopics: TopicCandidate[]): string {
  const topicList = existingTopics.map((t) => `- "${t.name}": ${t.description}`).join("\n");

  const manyTopicsNote =
    existingTopics.length >= 30
      ? "\nNote: There are many existing topics. Strongly prefer routing to an existing topic unless the content is genuinely about a completely new domain.\n"
      : "";

  return `You are a topic classifier. Given a conversation summary and a list of existing topics, decide whether the content fits an existing topic or needs a new one.

## Conversation Summary
${summary}

## Existing Topics
${topicList}
${manyTopicsNote}
## Instructions
1. If the summary matches an existing topic's scope, route to it.
2. If no existing topic fits, propose a new topic with a short kebab-case name and a one-sentence description.

Reply with ONLY a JSON object:
{ "action": "existing", "topicName": "exact-name-from-list" }
or
{ "action": "new", "topicName": "new-topic-name", "description": "One sentence describing what this topic covers" }

Do not include markdown fences or commentary.`;
}

function parseResponse(raw: string): {
  action: "existing" | "new";
  topicName: string;
  description?: string;
} | null {
  const trimmed = raw.trim();
  // Strip markdown code fences if present
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  const jsonText = fenceMatch ? fenceMatch[1]! : trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action : "";
  const topicName = typeof record.topicName === "string" ? record.topicName.trim() : "";

  if (topicName.length === 0) {
    return null;
  }

  if (action !== "existing" && action !== "new") {
    return null;
  }

  const description =
    typeof record.description === "string" && record.description.trim().length > 0
      ? record.description.trim()
      : undefined;

  return {
    action: action as "existing" | "new",
    topicName,
    description,
  };
}

function keywordFallback(summary: string, existingTopics: TopicCandidate[]): RouteResult {
  const tokens = new Set(summary.toLowerCase().split(/\s+/));
  for (const topic of existingTopics) {
    const nameTokens = topic.name.toLowerCase().split(/[-_\s]+/);
    if (nameTokens.some((token) => tokens.has(token))) {
      return { topicName: topic.name, isNew: false };
    }
  }
  return { topicName: "session", isNew: false };
}

// Main function

export async function routeToTopic(params: RouteToTopicParams): Promise<RouteResult> {
  const { summary, existingTopics, generateText } = params;

  // Even with no existing topics, try LLM to generate a good name
  const prompt = buildPrompt(summary, existingTopics);

  let parsed: ReturnType<typeof parseResponse>;
  try {
    const raw = await generateText(prompt);
    parsed = parseResponse(raw);
  } catch {
    return keywordFallback(summary, existingTopics);
  }

  if (parsed === null) {
    return keywordFallback(summary, existingTopics);
  }

  if (parsed.action === "existing") {
    const match = existingTopics.find((t) => kebabMatch(t.name, parsed!.topicName));
    if (match) {
      return { topicName: match.name, isNew: false };
    }
    // LLM says "existing" but name not in list — treat as new
    return {
      topicName: parsed.topicName,
      isNew: true,
      description: parsed.description ?? `Topic about ${parsed.topicName}`,
    };
  }

  // action === "new"
  return {
    topicName: parsed.topicName,
    isNew: true,
    description: parsed.description ?? `Topic about ${parsed.topicName}`,
  };
}
