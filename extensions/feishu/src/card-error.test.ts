import { describe, expect, it } from "vitest";
import {
  CARD_ERROR,
  CARD_CONTENT_SUB_ERROR,
  CardKitApiError,
  FEISHU_CARD_TABLE_LIMIT,
  extractLarkApiCode,
  extractSubCode,
  findMarkdownTablesOutsideCodeBlocks,
  isCardRateLimitError,
  isCardTableLimitError,
  parseCardApiError,
  sanitizeTextForCard,
  sanitizeTextSegmentsForCard,
} from "./card-error.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("CARD_ERROR constants", () => {
  it("has RATE_LIMITED = 230020", () => {
    expect(CARD_ERROR.RATE_LIMITED).toBe(230020);
  });

  it("has CARD_CONTENT_FAILED = 230099", () => {
    expect(CARD_ERROR.CARD_CONTENT_FAILED).toBe(230099);
  });
});

describe("CARD_CONTENT_SUB_ERROR constants", () => {
  it("has ELEMENT_LIMIT = 11310", () => {
    expect(CARD_CONTENT_SUB_ERROR.ELEMENT_LIMIT).toBe(11310);
  });
});

describe("FEISHU_CARD_TABLE_LIMIT", () => {
  it("defaults to 3", () => {
    expect(FEISHU_CARD_TABLE_LIMIT).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// CardKitApiError
// ---------------------------------------------------------------------------

describe("CardKitApiError", () => {
  it("stores code and msg", () => {
    const err = new CardKitApiError({
      api: "create",
      code: 230099,
      msg: "bad card",
      context: "test",
    });
    expect(err.name).toBe("CardKitApiError");
    expect(err.code).toBe(230099);
    expect(err.msg).toBe("bad card");
    expect(err.message).toContain("code=230099");
    expect(err.message).toContain("msg=bad card");
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// extractLarkApiCode
// ---------------------------------------------------------------------------

describe("extractLarkApiCode", () => {
  it("extracts from top-level code", () => {
    expect(extractLarkApiCode({ code: 230099 })).toBe(230099);
  });

  it("extracts from nested data.code", () => {
    expect(extractLarkApiCode({ data: { code: 230020 } })).toBe(230020);
  });

  it("extracts from Axios-style response.data.code", () => {
    expect(extractLarkApiCode({ response: { data: { code: 230099 } } })).toBe(230099);
  });

  it("returns undefined for null", () => {
    expect(extractLarkApiCode(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(extractLarkApiCode(undefined)).toBeUndefined();
  });

  it("returns undefined for string", () => {
    expect(extractLarkApiCode("error")).toBeUndefined();
  });

  it("returns undefined for number", () => {
    expect(extractLarkApiCode(42)).toBeUndefined();
  });

  it("returns undefined when code is a string", () => {
    expect(extractLarkApiCode({ code: "230099" })).toBeUndefined();
  });

  it("returns undefined for empty object", () => {
    expect(extractLarkApiCode({})).toBeUndefined();
  });

  it("prefers top-level code over data.code", () => {
    expect(extractLarkApiCode({ code: 1, data: { code: 2 } })).toBe(1);
  });

  it("prefers data.code over response.data.code", () => {
    expect(extractLarkApiCode({ data: { code: 1 }, response: { data: { code: 2 } } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// extractSubCode
// ---------------------------------------------------------------------------

describe("extractSubCode", () => {
  it("extracts ErrCode from msg string", () => {
    const msg =
      "Failed to create card content, ext=ErrCode: 11310; ErrMsg: element exceeds the limit; code:230099";
    expect(extractSubCode(msg)).toBe(11310);
  });

  it("returns null when no ErrCode present", () => {
    expect(extractSubCode("some error without sub code")).toBeNull();
  });

  it("handles whitespace around code", () => {
    expect(extractSubCode("ErrCode:  11310")).toBe(11310);
  });

  it("returns null for empty string", () => {
    expect(extractSubCode("")).toBeNull();
  });

  it("extracts different sub codes", () => {
    expect(extractSubCode("ErrCode: 99999")).toBe(99999);
  });
});

// ---------------------------------------------------------------------------
// parseCardApiError
// ---------------------------------------------------------------------------

describe("parseCardApiError", () => {
  it("parses { code, msg } shape", () => {
    const result = parseCardApiError({ code: 230099, msg: "card failed" });
    expect(result).toEqual({ code: 230099, subCode: null, errMsg: "card failed" });
  });

  it("parses { code, msg } with sub code", () => {
    const msg = "ext=ErrCode: 11310; ErrMsg: card table number over limit";
    const result = parseCardApiError({ code: 230099, msg });
    expect(result).toEqual({ code: 230099, subCode: 11310, errMsg: msg });
  });

  it("parses { response: { data: { code, msg } } } Axios shape", () => {
    const msg = "ErrCode: 11310; ErrMsg: element exceeds the limit";
    const result = parseCardApiError({ response: { data: { code: 230099, msg } } });
    expect(result).toEqual({ code: 230099, subCode: 11310, errMsg: msg });
  });

  it("uses msg field from CardKitApiError (msg takes priority over message)", () => {
    const err = new CardKitApiError({ api: "create", code: 230099, msg: "detail", context: "ctx" });
    const result = parseCardApiError(err);
    expect(result?.code).toBe(230099);
    expect(result?.errMsg).toBe("detail");
    expect(result?.subCode).toBeNull();
  });

  it("returns null for null", () => {
    expect(parseCardApiError(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseCardApiError(undefined)).toBeNull();
  });

  it("returns null for string", () => {
    expect(parseCardApiError("error")).toBeNull();
  });

  it("returns null for object without code", () => {
    expect(parseCardApiError({ message: "oops" })).toBeNull();
  });

  it("prefers msg over response.data.msg over message", () => {
    const err = {
      code: 230099,
      msg: "top-level msg",
      message: "fallback message",
      response: { data: { msg: "axios msg" } },
    };
    const result = parseCardApiError(err);
    expect(result?.errMsg).toBe("top-level msg");
  });

  it("uses response.data.msg when msg is absent", () => {
    const err = {
      code: 230099,
      response: { data: { msg: "axios msg" } },
    };
    const result = parseCardApiError(err);
    expect(result?.errMsg).toBe("axios msg");
  });

  it("uses message as last resort", () => {
    const err = { code: 230099, message: "fallback" };
    const result = parseCardApiError(err);
    expect(result?.errMsg).toBe("fallback");
  });
});

// ---------------------------------------------------------------------------
// isCardTableLimitError
// ---------------------------------------------------------------------------

describe("isCardTableLimitError", () => {
  it("matches production error format", () => {
    const err = {
      code: 230099,
      msg: "Failed to create card content, ext=ErrCode: 11310; ErrMsg: card table number over limit; ErrorValue: table; ",
    };
    expect(isCardTableLimitError(err)).toBe(true);
  });

  it('matches with different casing of "table number over limit"', () => {
    const err = {
      code: 230099,
      msg: "ErrCode: 11310; ErrMsg: Table Number Over Limit",
    };
    expect(isCardTableLimitError(err)).toBe(true);
  });

  it("rejects wrong code", () => {
    const err = {
      code: 230020,
      msg: "ErrCode: 11310; ErrMsg: table number over limit",
    };
    expect(isCardTableLimitError(err)).toBe(false);
  });

  it("rejects wrong sub code", () => {
    const err = {
      code: 230099,
      msg: "ErrCode: 99999; ErrMsg: table number over limit",
    };
    expect(isCardTableLimitError(err)).toBe(false);
  });

  it("rejects missing table number over limit phrase", () => {
    const err = {
      code: 230099,
      msg: "ErrCode: 11310; ErrMsg: element exceeds the limit",
    };
    expect(isCardTableLimitError(err)).toBe(false);
  });

  it("rejects null", () => {
    expect(isCardTableLimitError(null)).toBe(false);
  });

  it("rejects object without code", () => {
    expect(isCardTableLimitError({ msg: "table number over limit" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isCardRateLimitError
// ---------------------------------------------------------------------------

describe("isCardRateLimitError", () => {
  it("matches 230020", () => {
    expect(isCardRateLimitError({ code: 230020, msg: "rate limited" })).toBe(true);
  });

  it("rejects other codes", () => {
    expect(isCardRateLimitError({ code: 230099, msg: "content failed" })).toBe(false);
  });

  it("rejects null", () => {
    expect(isCardRateLimitError(null)).toBe(false);
  });

  it("works with Axios shape", () => {
    expect(
      isCardRateLimitError({ response: { data: { code: 230020, msg: "rate limited" } } }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findMarkdownTablesOutsideCodeBlocks
// ---------------------------------------------------------------------------

describe("findMarkdownTablesOutsideCodeBlocks", () => {
  const simpleTable = `| A | B |
|---|---|
| 1 | 2 |`;

  it("finds a single table", () => {
    const matches = findMarkdownTablesOutsideCodeBlocks(simpleTable);
    expect(matches).toHaveLength(1);
    expect(matches[0].raw).toContain("| A | B |");
  });

  it("finds multiple tables", () => {
    const text = `Before

| A | B |
|---|---|
| 1 | 2 |

Middle text

| C | D |
|---|---|
| 3 | 4 |

After`;
    const matches = findMarkdownTablesOutsideCodeBlocks(text);
    expect(matches).toHaveLength(2);
  });

  it("excludes tables inside code blocks", () => {
    const text = `\`\`\`
| A | B |
|---|---|
| 1 | 2 |
\`\`\``;
    const matches = findMarkdownTablesOutsideCodeBlocks(text);
    expect(matches).toHaveLength(0);
  });

  it("includes tables outside code blocks but excludes those inside", () => {
    const text = `${simpleTable}

\`\`\`
| X | Y |
|---|---|
| 5 | 6 |
\`\`\`

${simpleTable}`;
    const matches = findMarkdownTablesOutsideCodeBlocks(text);
    expect(matches).toHaveLength(2);
  });

  it("returns empty array for text with no tables", () => {
    expect(findMarkdownTablesOutsideCodeBlocks("just text")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(findMarkdownTablesOutsideCodeBlocks("")).toEqual([]);
  });

  it("handles nested backticks in code block", () => {
    const text = `\`\`\`markdown
| Inside | Block |
|--------|-------|
| a      | b     |
\`\`\``;
    const matches = findMarkdownTablesOutsideCodeBlocks(text);
    expect(matches).toHaveLength(0);
  });

  it("captures index and length correctly", () => {
    const text = `Hello

| A |
|---|
| 1 |

World`;
    const matches = findMarkdownTablesOutsideCodeBlocks(text);
    expect(matches).toHaveLength(1);
    expect(text.slice(matches[0].index, matches[0].index + matches[0].length)).toBe(matches[0].raw);
  });
});

// ---------------------------------------------------------------------------
// sanitizeTextForCard / sanitizeTextSegmentsForCard
// ---------------------------------------------------------------------------

describe("sanitizeTextForCard", () => {
  const makeTable = (label: string) => `| ${label} |\n|---|\n| val |`;

  it("returns text unchanged when table count is within limit", () => {
    const text = `${makeTable("A")}\n\n${makeTable("B")}`;
    expect(sanitizeTextForCard(text, 3)).toBe(text);
  });

  it("wraps excess tables in code blocks", () => {
    const text = `${makeTable("A")}\n\n${makeTable("B")}\n\n${makeTable("C")}\n\n${makeTable("D")}`;
    const result = sanitizeTextForCard(text, 2);
    // First 2 tables should remain as-is
    expect(result).toContain("| A |");
    expect(result).toContain("| B |");
    // Last 2 tables should be wrapped
    expect(result).toContain("```\n| C |");
    expect(result).toContain("```\n| D |");
  });

  it("uses FEISHU_CARD_TABLE_LIMIT as default limit", () => {
    const tables = Array.from({ length: FEISHU_CARD_TABLE_LIMIT + 1 }, (_, i) =>
      makeTable(`T${i}`),
    ).join("\n\n");
    const result = sanitizeTextForCard(tables);
    // The last table (T3) should be wrapped
    expect(result).toContain("```\n| T3 |");
  });

  it("wraps all tables when limit is 0", () => {
    const text = makeTable("A");
    const result = sanitizeTextForCard(text, 0);
    expect(result).toContain("```\n| A |");
  });

  it("returns text unchanged when no tables present", () => {
    expect(sanitizeTextForCard("no tables here", 3)).toBe("no tables here");
  });
});

describe("sanitizeTextSegmentsForCard", () => {
  const makeTable = (label: string) => `| ${label} |\n|---|\n| val |`;

  it("shares table budget across segments", () => {
    const texts = [makeTable("A"), `${makeTable("B")}\n\n${makeTable("C")}`];
    // Limit 2: first segment takes 1, second takes 1 → last table in segment 2 wrapped
    const result = sanitizeTextSegmentsForCard(texts, 2);
    expect(result[0]).toBe(texts[0]); // unchanged
    expect(result[1]).toContain("```\n| C |"); // excess wrapped
  });

  it("exhausts budget on first segment", () => {
    const texts = [`${makeTable("A")}\n\n${makeTable("B")}\n\n${makeTable("C")}`, makeTable("D")];
    // Limit 2: first segment uses 2, third wrapped. Second segment has 0 budget → D wrapped
    const result = sanitizeTextSegmentsForCard(texts, 2);
    expect(result[0]).toContain("```\n| C |");
    expect(result[1]).toContain("```\n| D |");
  });

  it("handles empty array", () => {
    expect(sanitizeTextSegmentsForCard([], 3)).toEqual([]);
  });

  it("handles segments without tables", () => {
    const texts = ["plain text", "more text"];
    expect(sanitizeTextSegmentsForCard(texts, 3)).toEqual(texts);
  });

  it("all tables within budget across segments", () => {
    const texts = [makeTable("A"), makeTable("B")];
    const result = sanitizeTextSegmentsForCard(texts, 3);
    expect(result).toEqual(texts);
  });
});

// ---------------------------------------------------------------------------
// wrapTablesBeyondLimit (indirect via sanitizeTextForCard)
// ---------------------------------------------------------------------------

describe("wrapTablesBeyondLimit (back-to-front replacement)", () => {
  const makeTable = (label: string) => `| ${label} |\n|---|\n| val |`;

  it("replaces from the end, keeping indices stable", () => {
    const text = `${makeTable("T1")}\n\n${makeTable("T2")}\n\n${makeTable("T3")}\n\n${makeTable("T4")}`;
    const result = sanitizeTextForCard(text, 2);
    // T1 and T2 kept, T3 and T4 wrapped
    const t1Index = result.indexOf("| T1 |");
    const t2Index = result.indexOf("| T2 |");
    const t3Index = result.indexOf("| T3 |");
    const t4Index = result.indexOf("| T4 |");
    // Order preserved
    expect(t1Index).toBeLessThan(t2Index);
    expect(t2Index).toBeLessThan(t3Index);
    expect(t3Index).toBeLessThan(t4Index);
  });
});
