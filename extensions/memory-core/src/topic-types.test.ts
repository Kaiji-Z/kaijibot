import { describe, it, expect } from "vitest";
import {
  type TopicFile,
  type TopicEntry,
  parseTopicFile,
  parseTopicEntry,
  parseTopicEntryHeading,
  serializeTopicFile,
  serializeTopicEntry,
  createEmptyTopicFile,
  formatEntryHeading,
} from "./topic-types.js";

const SAMPLE_TOPIC_MD = `---
subject: user-profile
created: 2026-04-20
updated: 2026-04-24
entries: 2
---

## Prefers concise replies (2026-04-20)

User explicitly asked for shorter responses without unnecessary filler.

## Works in distributed systems (2026-04-22)

User's primary domain is distributed tracing and observability.
`;

describe("parseTopicEntryHeading", () => {
  it("parses a valid heading", () => {
    const result = parseTopicEntryHeading("## My Title (2026-04-24)");
    expect(result).toEqual({ title: "My Title", date: "2026-04-24" });
  });

  it("returns null for non-heading text", () => {
    expect(parseTopicEntryHeading("Just some text")).toBeNull();
  });

  it("returns null for h1 heading", () => {
    expect(parseTopicEntryHeading("# Title (2026-04-24)")).toBeNull();
  });

  it("returns null for heading without date", () => {
    expect(parseTopicEntryHeading("## Title without date")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseTopicEntryHeading("")).toBeNull();
  });
});

describe("parseTopicEntry", () => {
  it("parses a complete entry section", () => {
    const md = "## My Entry (2026-04-20)\n\nSome content here.\nAnother line.";
    const entry = parseTopicEntry(md);
    expect(entry.title).toBe("My Entry");
    expect(entry.date).toBe("2026-04-20");
    expect(entry.content).toBe("Some content here.\nAnother line.");
  });

  it("handles entry with no content", () => {
    const entry = parseTopicEntry("## Empty (2026-04-20)");
    expect(entry.title).toBe("Empty");
    expect(entry.content).toBe("");
  });

  it("handles invalid heading gracefully", () => {
    const entry = parseTopicEntry("Not a heading\nSome content");
    expect(entry.title).toBe("Untitled");
    expect(entry.content).toBe("Some content");
  });
});

describe("parseTopicFile", () => {
  it("parses a complete topic file with entries", () => {
    const topic = parseTopicFile(SAMPLE_TOPIC_MD);
    expect(topic.frontmatter.subject).toBe("user-profile");
    expect(topic.frontmatter.created).toBe("2026-04-20");
    expect(topic.frontmatter.updated).toBe("2026-04-24");
    expect(topic.entries).toHaveLength(2);
    expect(topic.entries[0]!.title).toBe("Prefers concise replies");
    expect(topic.entries[1]!.title).toBe("Works in distributed systems");
  });

  it("handles file with no entries", () => {
    const md = "---\nsubject: reference\ncreated: 2026-04-24\nupdated: 2026-04-24\nentries: 0\n---\n";
    const topic = parseTopicFile(md);
    expect(topic.frontmatter.subject).toBe("reference");
    expect(topic.entries).toHaveLength(0);
  });

  it("defaults subject to empty for missing frontmatter field", () => {
    const md = "---\ncreated: 2026-04-24\nupdated: 2026-04-24\nentries: 0\n---\n";
    const topic = parseTopicFile(md);
    expect(topic.frontmatter.subject).toBe("");
  });

  it("handles file with no frontmatter", () => {
    const md = "## Some Entry (2026-04-24)\n\nContent here.\n";
    const topic = parseTopicFile(md);
    expect(topic.frontmatter.subject).toBe("");
    expect(topic.entries).toHaveLength(1);
    expect(topic.entries[0]!.title).toBe("Some Entry");
  });

  it("preserves raw markdown", () => {
    const topic = parseTopicFile(SAMPLE_TOPIC_MD);
    expect(topic.raw).toBe(SAMPLE_TOPIC_MD);
  });
});

describe("serializeTopicEntry", () => {
  it("serializes entry with content", () => {
    const entry: TopicEntry = {
      title: "Test Entry",
      date: "2026-04-24",
      content: "Some content",
    };
    expect(serializeTopicEntry(entry)).toBe("## Test Entry (2026-04-24)\n\nSome content");
  });

  it("serializes entry without content", () => {
    const entry: TopicEntry = { title: "Empty", date: "2026-04-24", content: "" };
    expect(serializeTopicEntry(entry)).toBe("## Empty (2026-04-24)");
  });
});

describe("serializeTopicFile", () => {
  it("round-trips a parsed topic file", () => {
    const topic = parseTopicFile(SAMPLE_TOPIC_MD);
    const serialized = serializeTopicFile(topic);
    const reParsed = parseTopicFile(serialized);
    expect(reParsed.frontmatter.subject).toBe(topic.frontmatter.subject);
    expect(reParsed.entries).toHaveLength(topic.entries.length);
    expect(reParsed.entries[0]!.title).toBe(topic.entries[0]!.title);
    expect(reParsed.entries[1]!.title).toBe(topic.entries[1]!.title);
  });

  it("serializes empty topic file", () => {
    const empty = createEmptyTopicFile("feedback", "feedback");
    const serialized = serializeTopicFile(empty);
    expect(serialized).toContain("subject: feedback");
    expect(serialized).toContain("entries: 0");
    expect(serialized).not.toContain("## ");
  });
});

describe("createEmptyTopicFile", () => {
  it("creates file with correct subject", () => {
    const topic = createEmptyTopicFile("user", "user-profile");
    expect(topic.frontmatter.subject).toBe("user");
    expect(topic.entries).toHaveLength(0);
    expect(topic.frontmatter.entries).toBe(0);
  });

  it("sets created and updated to today", () => {
    const topic = createEmptyTopicFile("project", "project-decisions");
    const today = new Date().toISOString().slice(0, 10);
    expect(topic.frontmatter.created).toBe(today);
    expect(topic.frontmatter.updated).toBe(today);
  });

  it("raw content contains frontmatter", () => {
    const topic = createEmptyTopicFile("reference", "reference");
    expect(topic.raw).toContain("---");
    expect(topic.raw).toContain("subject: reference");
  });
});

describe("formatEntryHeading", () => {
  it("formats heading correctly", () => {
    const entry: TopicEntry = { title: "Test", date: "2026-04-24", content: "" };
    expect(formatEntryHeading(entry)).toBe("## Test (2026-04-24)");
  });
});
