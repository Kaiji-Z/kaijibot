import type { MemoryPromptSectionBuilder } from "kaijibot/plugin-sdk/memory-core-host-runtime-core";
import { TOPIC_FILE_FORMAT_SECTION, VERIFICATION_PROMPT_SECTION } from "./memory-types.js";

export const buildPromptSection: MemoryPromptSectionBuilder = ({
  availableTools,
  citationsMode,
}) => {
  const hasMemorySearch = availableTools.has("memory_search");
  const hasMemoryGet = availableTools.has("memory_get");
  const hasMemorySave = availableTools.has("memory_save");
  const hasMemoryTidy = availableTools.has("memory_tidy");

  if (!hasMemorySearch && !hasMemoryGet && !hasMemorySave && !hasMemoryTidy) {
    return [];
  }

  let toolGuidance: string;
  if (hasMemorySearch && hasMemoryGet) {
    toolGuidance =
      "Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search on MEMORY.md + memory/*.md + indexed session transcripts; then use memory_get to pull only the needed lines. If low confidence after search, say you checked.";
  } else if (hasMemorySearch) {
    toolGuidance =
      "Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search on MEMORY.md + memory/*.md + indexed session transcripts and answer from the matching results. If low confidence after search, say you checked.";
  } else {
    toolGuidance =
      "Before answering anything about prior work, decisions, dates, people, preferences, or todos that already point to a specific memory file or note: run memory_get to pull only the needed lines. If low confidence after reading them, say you checked.";
  }

  const lines = ["## Memory Recall", toolGuidance];
  if (citationsMode === "off") {
    lines.push(
      "Citations are disabled: do not mention file paths or line numbers in replies unless the user explicitly asks.",
    );
  } else {
    lines.push(
      "Citations: include Source: <path#line> when it helps the user verify memory snippets.",
    );
  }
  lines.push("");
  lines.push(VERIFICATION_PROMPT_SECTION);
  lines.push("");

  lines.push(
    "MEMORY.md format: hybrid — high-frequency info (user identity, key feedback, active focus) is inline;",
    "low-frequency details are in memory/topics/*.md files, organized by subject (e.g. feishu.md, philosophy.md).",
    "Budget: 4KB. Exceeding this triggers relocation of lower-priority content to topic files.",
  );
  lines.push("");

  if (hasMemorySave) {
    lines.push(
      "Use memory_save to record user preferences, decisions, and reference info.",
      "Requires a `topic` parameter (subject-based, e.g. 'feishu', 'philosophy').",
      "The `type` parameter (user/feedback/project/reference) is optional metadata.",
    );
    lines.push("");
    lines.push(TOPIC_FILE_FORMAT_SECTION);
    lines.push("");
  }

  if (hasMemoryTidy) {
    lines.push(
      "Use memory_tidy to clean up duplicate or stale entries in topic files.",
    );
    lines.push("");
  }

  return lines;
};
