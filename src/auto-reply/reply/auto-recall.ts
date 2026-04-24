import type { PersonaTree } from "../../cognitive/types.js";
import type { MemorySearchResult } from "../../memory-host-sdk/host/types.js";
import type { KaijiBotConfig } from "../../config/config.js";

export interface AutoRecallOptions {
  cfg: KaijiBotConfig;
  agentId: string;
  persona: PersonaTree | undefined;
  maxTopics?: number;
  maxResults?: number;
  maxChars?: number;
}

export interface AutoRecallSearchFn {
  (query: string, opts: {
    maxResults?: number;
    minScore?: number;
  }): Promise<MemorySearchResult[]>;
}

export interface AutoRecallDeps {
  loadPersona?: () => Promise<PersonaTree | undefined>;
  searchMemory?: AutoRecallSearchFn;
}

const DEFAULT_MAX_TOPICS = 3;
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MAX_CHARS = 3000;
const DEFAULT_MIN_SCORE = 0.4;

/**
 * Format a single search result into a snippet line.
 */
function formatSnippet(result: MemorySearchResult): string {
  const lines: string[] = [];
  if (result.snippet) {
    lines.push(result.snippet);
  }
  const source = result.path;
  const lineRange =
    result.startLine && result.endLine
      ? `:${result.startLine}-${result.endLine}`
      : "";
  lines.push(`Source: ${source}${lineRange}`);
  return lines.join("\n");
}

/**
 * Format search results for a single topic.
 */
function formatTopicResults(
  topic: string,
  results: MemorySearchResult[],
): string {
  if (results.length === 0) return "";
  const snippets = results.map((r) => formatSnippet(r)).join("\n\n");
  return `### ${topic}\n${snippets}`;
}

/**
 * Build auto-recall context by searching memory for the user's recent focus topics.
 *
 * This is called during session reset (`/new` or `/reset`) to proactively inject
 * relevant past context into the system prompt, so the agent doesn't need to
 * wait for the user to ask about prior topics.
 *
 * All failures are caught and result in an empty string — auto-recall must never
 * block session startup.
 */
export async function buildAutoRecallContext(
  opts: AutoRecallOptions,
  deps?: AutoRecallDeps,
): Promise<string> {
  const maxTopics = opts.maxTopics ?? DEFAULT_MAX_TOPICS;
  const maxResults = opts.maxResults ?? DEFAULT_MAX_RESULTS;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;

  const persona = deps?.loadPersona
    ? await deps.loadPersona()
    : opts.persona;

  if (!persona?.recentFocus?.length) return "";

  const topics = persona.recentFocus.slice(0, maxTopics);
  if (topics.length === 0) return "";

  // Resolve the search function — either injected for testing or loaded lazily.
  let searchFn: AutoRecallSearchFn;
  if (deps?.searchMemory) {
    searchFn = deps.searchMemory;
  } else {
    try {
      const { getActiveMemorySearchManager } = await import(
        "../../plugins/memory-runtime.js"
      );
      const { manager } = await getActiveMemorySearchManager({
        cfg: opts.cfg,
        agentId: opts.agentId,
      });
      if (!manager) return "";
      searchFn = (query, searchOpts) =>
        manager.search(query, {
          maxResults: searchOpts.maxResults,
          minScore: searchOpts.minScore,
        });
    } catch {
      return "";
    }
  }

  const topicBlocks: string[] = [];

  for (const topic of topics) {
    try {
      const results = await searchFn(topic, {
        maxResults,
        minScore: DEFAULT_MIN_SCORE,
      });
      if (results.length > 0) {
        topicBlocks.push(formatTopicResults(topic, results));
      }
    } catch {
      // Skip this topic on failure, continue with others.
    }
  }

  if (topicBlocks.length === 0) return "";

  const header = "## Recalled Context";
  let body = topicBlocks.join("\n\n");
  const fullText = `${header}\n${body}\n---`;

  if (fullText.length > maxChars) {
    // Truncate body to fit within budget.
    const budget = maxChars - header.length - "\n".length - "\n---".length;
    body = body.slice(0, Math.max(0, budget));
    return `${header}\n${body}\n---`;
  }

  return fullText;
}
