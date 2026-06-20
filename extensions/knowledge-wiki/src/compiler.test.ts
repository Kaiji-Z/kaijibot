import { describe, expect, it } from "vitest";
import { extractFromSource, type GenerateTextFn } from "./compiler.js";

const sourceMeta = { path: "notes/test.md", filename: "test.md" };

function mockGenerateText(response: string): GenerateTextFn {
  return async () => response;
}

describe("compiler", () => {
  describe("parseExtractionResult (via extractFromSource)", () => {
    it("parses a clean JSON response", async () => {
      const mock = mockGenerateText(
        JSON.stringify({
          summary: "Mock summary",
          claims: [{ text: "Mock claim", confidence: 0.8, category: "test" }],
          entities: [],
          concepts: [],
          topics: [],
          relationships: [],
        }),
      );

      const result = await extractFromSource(mock, "content", sourceMeta);

      expect(result.summary).toBe("Mock summary");
      expect(result.claims).toHaveLength(1);
      expect(result.claims[0]?.text).toBe("Mock claim");
      expect(result.claims[0]?.confidence).toBe(0.8);
      expect(result.claims[0]?.category).toBe("test");
    });

    it("unwraps JSON wrapped in a markdown code fence", async () => {
      const json = JSON.stringify({
        summary: "Fenced summary",
        claims: [{ text: "Fenced claim", confidence: 0.7, category: "domain_knowledge" }],
        entities: [],
        concepts: [],
        topics: [],
        relationships: [],
      });
      const mock = mockGenerateText("```json\n" + json + "\n```");

      const result = await extractFromSource(mock, "content", sourceMeta);

      expect(result.summary).toBe("Fenced summary");
      expect(result.claims[0]?.text).toBe("Fenced claim");
      expect(result.claims[0]?.confidence).toBe(0.7);
    });

    it("unwraps JSON wrapped in an untagged code fence", async () => {
      const json = JSON.stringify({
        summary: "Plain fence summary",
        claims: [],
        entities: [],
        concepts: [],
        topics: [],
        relationships: [],
      });
      const mock = mockGenerateText("```\n" + json + "\n```");

      const result = await extractFromSource(mock, "content", sourceMeta);

      expect(result.summary).toBe("Plain fence summary");
    });

    it("extracts JSON surrounded by prose", async () => {
      const json = JSON.stringify({
        summary: "Embedded summary",
        claims: [],
        entities: [],
        concepts: [],
        topics: [],
        relationships: [],
      });
      const mock = mockGenerateText("Here is the extraction:\n" + json + "\nThanks!");

      const result = await extractFromSource(mock, "content", sourceMeta);

      expect(result.summary).toBe("Embedded summary");
    });

    it("returns an empty extraction for invalid JSON", async () => {
      const mock = mockGenerateText("{ this is not valid json");

      const result = await extractFromSource(mock, "content", sourceMeta);

      expect(result.summary).toBe("");
      expect(result.claims).toEqual([]);
      expect(result.entities).toEqual([]);
      expect(result.concepts).toEqual([]);
      expect(result.topics).toEqual([]);
      expect(result.relationships).toEqual([]);
    });

    it("returns an empty extraction for an empty response", async () => {
      const mock = mockGenerateText("");

      const result = await extractFromSource(mock, "content", sourceMeta);

      expect(result.summary).toBe("");
      expect(result.claims).toEqual([]);
      expect(result.entities).toEqual([]);
      expect(result.concepts).toEqual([]);
    });

    it("clamps confidence values to [0, 1]", async () => {
      const mock = mockGenerateText(
        JSON.stringify({
          summary: "",
          claims: [
            { text: "high", confidence: 5, category: "c" },
            { text: "low", confidence: -2, category: "c" },
            { text: "normal", confidence: 0.5, category: "c" },
          ],
          entities: [],
          concepts: [],
          topics: [],
          relationships: [],
        }),
      );

      const result = await extractFromSource(mock, "content", sourceMeta);

      expect(result.claims).toHaveLength(3);
      expect(result.claims[0]?.confidence).toBe(1);
      expect(result.claims[1]?.confidence).toBe(0);
      expect(result.claims[2]?.confidence).toBe(0.5);
    });

    it("defaults confidence to 0.5 when missing or non-numeric", async () => {
      const mock = mockGenerateText(
        JSON.stringify({
          summary: "",
          claims: [
            { text: "no confidence", category: "c" },
            { text: "bad confidence", confidence: "high", category: "c" },
          ],
          entities: [],
          concepts: [],
          topics: [],
          relationships: [],
        }),
      );

      const result = await extractFromSource(mock, "content", sourceMeta);

      expect(result.claims).toHaveLength(2);
      expect(result.claims[0]?.confidence).toBe(0.5);
      expect(result.claims[1]?.confidence).toBe(0.5);
    });

    it("filters out claims with empty text", async () => {
      const mock = mockGenerateText(
        JSON.stringify({
          summary: "",
          claims: [
            { text: "valid claim", confidence: 0.5, category: "c" },
            { text: "   ", confidence: 0.5, category: "c" },
            { text: "", confidence: 0.5, category: "c" },
          ],
          entities: [],
          concepts: [],
          topics: [],
          relationships: [],
        }),
      );

      const result = await extractFromSource(mock, "content", sourceMeta);

      expect(result.claims).toHaveLength(1);
      expect(result.claims[0]?.text).toBe("valid claim");
    });

    it("filters out entities with empty name", async () => {
      const mock = mockGenerateText(
        JSON.stringify({
          summary: "",
          claims: [],
          entities: [
            { name: "Valid", type: "tool", description: "ok" },
            { name: "  ", type: "tool", description: "blank name" },
            { name: "", type: "tool", description: "empty name" },
          ],
          concepts: [],
          topics: [],
          relationships: [],
        }),
      );

      const result = await extractFromSource(mock, "content", sourceMeta);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]?.name).toBe("Valid");
    });

    it("preserves entity type and description on valid entities", async () => {
      const mock = mockGenerateText(
        JSON.stringify({
          summary: "",
          claims: [],
          entities: [
            { name: "Rust", type: "technology", description: "Systems programming language" },
          ],
          concepts: [],
          topics: [],
          relationships: [],
        }),
      );

      const result = await extractFromSource(mock, "content", sourceMeta);

      expect(result.entities[0]?.type).toBe("technology");
      expect(result.entities[0]?.description).toBe("Systems programming language");
    });

    it("defaults entity type to 'concept' when missing", async () => {
      const mock = mockGenerateText(
        JSON.stringify({
          summary: "",
          claims: [],
          entities: [{ name: "Untyped", description: "no type field" }],
          concepts: [],
          topics: [],
          relationships: [],
        }),
      );

      const result = await extractFromSource(mock, "content", sourceMeta);

      expect(result.entities[0]?.type).toBe("concept");
    });
  });

  describe("extractFromSource", () => {
    it("calls generateText with a prompt containing source metadata and content, then returns the parsed result", async () => {
      let receivedPrompt = "";
      const mock: GenerateTextFn = async (prompt: string): Promise<string> => {
        receivedPrompt = prompt;
        return JSON.stringify({
          summary: "Mock summary",
          claims: [{ text: "Mock claim", confidence: 0.8, category: "test" }],
          entities: [],
          concepts: [],
          topics: [],
          relationships: [],
        });
      };

      const result = await extractFromSource(mock, "some original content", sourceMeta);

      // Prompt includes source metadata and the verbatim content.
      expect(receivedPrompt).toContain("test.md");
      expect(receivedPrompt).toContain("notes/test.md");
      expect(receivedPrompt).toContain("some original content");
      // Parsed result reflects the mock response.
      expect(result.summary).toBe("Mock summary");
      expect(result.claims[0]?.text).toBe("Mock claim");
    });

    it("truncates content longer than 12000 characters", async () => {
      let receivedPrompt = "";
      const longContent = "x".repeat(20000);
      const mock: GenerateTextFn = async (prompt: string): Promise<string> => {
        receivedPrompt = prompt;
        return JSON.stringify({
          summary: "",
          claims: [],
          entities: [],
          concepts: [],
          topics: [],
          relationships: [],
        });
      };

      await extractFromSource(mock, longContent, sourceMeta);

      // The truncation marker is present, referencing the original total length.
      expect(receivedPrompt).toContain("[... truncated, 20000 total chars ...]");
      // Exactly the first 12000 chars of content are kept; the full run of 20000 is not.
      expect(receivedPrompt.includes("x".repeat(12000))).toBe(true);
      expect(receivedPrompt.includes("x".repeat(12001))).toBe(false);
    });

    it("does not truncate content at or under 12000 characters", async () => {
      let receivedPrompt = "";
      const exactContent = "y".repeat(12000);
      const mock: GenerateTextFn = async (prompt: string): Promise<string> => {
        receivedPrompt = prompt;
        return "{}";
      };

      await extractFromSource(mock, exactContent, sourceMeta);

      expect(receivedPrompt).not.toContain("[... truncated");
      expect(receivedPrompt.includes("y".repeat(12000))).toBe(true);
    });
  });
});
