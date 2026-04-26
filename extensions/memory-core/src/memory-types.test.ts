import { describe, it, expect } from "vitest";
import {
  isExcludedMemoryContent,
  EXCLUSION_PROMPT_SECTION,
  WRITE_QUALITY_PROMPT_SECTION,
  CLASSIFICATION_PROMPT_SECTION,
  VERIFICATION_PROMPT_SECTION,
} from "./memory-types.js";

describe("isExcludedMemoryContent", () => {
  describe("code patterns → excluded", () => {
    it("function declaration", () => {
      expect(isExcludedMemoryContent("function hello() {}")).toBe(true);
    });

    it("import statement", () => {
      expect(isExcludedMemoryContent("import { foo } from 'bar'")).toBe(true);
    });

    it("class definition", () => {
      expect(isExcludedMemoryContent("class Foo { run() {} }")).toBe(true);
    });

    it("variable assignment with object", () => {
      expect(isExcludedMemoryContent("const config = { key: 'value' }")).toBe(true);
    });

    it("export statement", () => {
      expect(isExcludedMemoryContent("export function foo() {}")).toBe(true);
    });
  });

  describe("file paths → excluded", () => {
    it("absolute src path", () => {
      expect(isExcludedMemoryContent("Look at /src/utils/parser.ts")).toBe(true);
    });

    it("relative path with ./", () => {
      expect(isExcludedMemoryContent("See ./config.json for details")).toBe(true);
    });

    it("parent path with ../", () => {
      expect(isExcludedMemoryContent("Go to ../README.md")).toBe(true);
    });

    it("file extension .py", () => {
      expect(isExcludedMemoryContent("script.py was updated")).toBe(true);
    });
  });

  describe("git info → excluded", () => {
    it("commit mention", () => {
      expect(isExcludedMemoryContent("The last commit fixed the bug")).toBe(true);
    });

    it("branch mention", () => {
      expect(isExcludedMemoryContent("Switch to main branch")).toBe(true);
    });

    it("PR mention", () => {
      expect(isExcludedMemoryContent("PR #123 was merged")).toBe(true);
    });

    it("blame mention", () => {
      expect(isExcludedMemoryContent("git blame shows this was changed")).toBe(true);
    });
  });

  describe("derivable info → excluded", () => {
    it("the file exists", () => {
      expect(isExcludedMemoryContent("The file exists at that path")).toBe(true);
    });

    it("you can see", () => {
      expect(isExcludedMemoryContent("You can see the result above")).toBe(true);
    });

    it("as shown in", () => {
      expect(isExcludedMemoryContent("As shown in the output above")).toBe(true);
    });
  });

  describe("ephemeral state → excluded", () => {
    it("currently running", () => {
      expect(isExcludedMemoryContent("The server is currently running")).toBe(true);
    });

    it("in progress", () => {
      expect(isExcludedMemoryContent("Migration is in progress")).toBe(true);
    });

    it("todo:", () => {
      expect(isExcludedMemoryContent("TODO: fix the edge case")).toBe(true);
    });

    it("FIXME", () => {
      expect(isExcludedMemoryContent("FIXME: handle null input")).toBe(true);
    });
  });

  describe("dreaming metadata → excluded", () => {
    it("confidence:", () => {
      expect(isExcludedMemoryContent("confidence: 0.85")).toBe(true);
    });

    it("evidence:", () => {
      expect(isExcludedMemoryContent("evidence: [3 sources]")).toBe(true);
    });

    it("status: staged", () => {
      expect(isExcludedMemoryContent("status: staged")).toBe(true);
    });

    it("recalls:", () => {
      expect(isExcludedMemoryContent("recalls: 5 sessions")).toBe(true);
    });
  });

  describe("legitimate memories → NOT excluded", () => {
    it("user preference", () => {
      expect(isExcludedMemoryContent("User prefers dark mode and compact layout")).toBe(false);
    });

    it("feedback confirmation", () => {
      expect(isExcludedMemoryContent("User confirmed that checking docs first is the right approach")).toBe(false);
    });

    it("project decision", () => {
      expect(isExcludedMemoryContent("Team decided to migrate to PostgreSQL on 2026-03-15")).toBe(false);
    });

    it("reference pointer", () => {
      expect(isExcludedMemoryContent("Production API endpoint is api.example.com v2.1")).toBe(false);
    });

    it("Chinese user context", () => {
      expect(isExcludedMemoryContent("用户习惯用中文交流，喜欢简洁的回复风格")).toBe(false);
    });

    it("personal relationship", () => {
      expect(isExcludedMemoryContent("User has a dog named Max and works from home on Fridays")).toBe(false);
    });
  });
});

describe("prompt section constants", () => {
  it("EXCLUSION_PROMPT_SECTION is a non-empty string", () => {
    expect(typeof EXCLUSION_PROMPT_SECTION).toBe("string");
    expect(EXCLUSION_PROMPT_SECTION.length).toBeGreaterThan(0);
  });

  it("WRITE_QUALITY_PROMPT_SECTION is a non-empty string", () => {
    expect(typeof WRITE_QUALITY_PROMPT_SECTION).toBe("string");
    expect(WRITE_QUALITY_PROMPT_SECTION.length).toBeGreaterThan(0);
  });

  it("CLASSIFICATION_PROMPT_SECTION is a non-empty string", () => {
    expect(typeof CLASSIFICATION_PROMPT_SECTION).toBe("string");
    expect(CLASSIFICATION_PROMPT_SECTION.length).toBeGreaterThan(0);
  });

  it("VERIFICATION_PROMPT_SECTION is a non-empty string", () => {
    expect(typeof VERIFICATION_PROMPT_SECTION).toBe("string");
    expect(VERIFICATION_PROMPT_SECTION.length).toBeGreaterThan(0);
  });

  it("exclusion section mentions dreaming", () => {
    expect(EXCLUSION_PROMPT_SECTION).toContain("Dreaming");
  });

  it("verification section mentions file path check", () => {
    expect(VERIFICATION_PROMPT_SECTION).toContain("file path");
  });
});
