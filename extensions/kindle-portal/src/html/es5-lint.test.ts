import { describe, it, expect } from "vitest";
import { lintKindleHtml } from "./es5-lint.js";

describe("lintKindleHtml", () => {
  // --- Individual token tests (16 forbidden tokens) ---

  it("flags fetch(", () => {
    const html = "<script>fetch('/api')</script>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(1);
    expect(issues[0].token).toBe("fetch(");
    expect(issues[0].message).toContain("fetch(");
  });

  it("flags WebSocket", () => {
    const html = "<script>new WebSocket('ws://x')</script>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].token).toBe("WebSocket");
  });

  it("flags EventSource", () => {
    const html = "<script>new EventSource('/sse')</script>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].token).toBe("EventSource");
  });

  it("flags => arrow functions", () => {
    const html = "<script>var f = (x) => x + 1;</script>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].token).toBe("=>");
  });

  it("flags template literals (backtick)", () => {
    const html = "<script>var s = `hello ${name}`;</script>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].token).toBe("`");
  });

  it("flags const ", () => {
    const html = "<script>const x = 1;</script>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].token).toBe("const ");
  });

  it("does not flag 'constant' when checking const ", () => {
    const html = "<script>var constant = 5;</script>";
    const issues = lintKindleHtml(html);
    expect(issues).toEqual([]);
  });

  it("flags let ", () => {
    const html = "<script>let x = 1;</script>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].token).toBe("let ");
  });

  it("flags async ", () => {
    const html = "<script>async function f() {}</script>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].token).toBe("async ");
  });

  it("flags await ", () => {
    const html = "<script>var x = await fn();</script>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].token).toBe("await ");
  });

  it("flags display: flex", () => {
    const html = "<div style='display: flex'>ok</div>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].token).toBe("display: flex");
  });

  it("flags display:grid", () => {
    const html = "<div style='display:grid'>ok</div>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].token).toBe("display:grid");
  });

  it("flags display:inline-flex", () => {
    const html = "<div style='display:inline-flex'>ok</div>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].token).toBe("display:inline-flex");
  });

  it("flags var(-- CSS variables", () => {
    const html = "<div style='color: var(--main)'>ok</div>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].token).toBe("var(--");
  });

  it("flags position:fixed", () => {
    const html = "<div style='position:fixed'>ok</div>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].token).toBe("position:fixed");
  });

  it("flags position: sticky", () => {
    const html = "<div style='position: sticky'>ok</div>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].token).toBe("position: sticky");
  });

  it("flags @font-face", () => {
    const html = "<style>@font-face { font-family: x; }</style>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].token).toBe("@font-face");
  });

  // --- Clean HTML tests ---

  it("passes clean float HTML", () => {
    const html = "<div style='float:left'>ok</div>";
    expect(lintKindleHtml(html)).toEqual([]);
  });

  it("passes clean ES5 HTML", () => {
    const html = [
      "<!DOCTYPE html>",
      "<html><head>",
      "<script>var x = 1; function add(a, b) { return a + b; }</script>",
      "<style>.box { float: left; margin: 10px; }</style>",
      "</head><body><div>ok</div></body></html>",
    ].join("\n");
    expect(lintKindleHtml(html)).toEqual([]);
  });

  // --- Allowlist tests ---

  it("allowlist suppresses const for 5 lines", () => {
    const html = [
      "<!-- kindle-allow: const  -->",        // line 1 (marker, sets suppress=5)
      "var x = 1;",                            // line 2 (suppress=4)
      "const y = 2;",                          // line 3 (suppress=3, so suppressed)
      "var a = 3;",                            // line 4 (suppress=2)
      "var b = 4;",                            // line 5 (suppress=1)
      "var c = 5;",                            // line 6 (suppress=0)
      "",                                      // line 7 (suppress=0)
      "const z = 3;",                          // line 8 (suppress=0, flagged)
    ].join("\n");
    const issues = lintKindleHtml(html);
    // line 3 suppressed, line 8 flagged
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(8);
    expect(issues[0].token).toBe("const ");
  });

  it("allowlist only suppresses specified token", () => {
    const html = [
      "<!-- kindle-allow: const  -->",         // line 1
      "const x = 1;",                          // line 2 (suppressed)
      "let y = 2;",                             // line 3 (NOT suppressed — different token)
    ].join("\n");
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(3);
    expect(issues[0].token).toBe("let ");
  });

  // --- Sorting test ---

  it("returns issues sorted by line then token", () => {
    const html = [
      "let a = 1;",                             // line 1
      "const b = 2;",                           // line 2
      "fetch('/x');",                           // line 3
    ].join("\n");
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(3);
    // All on different lines, sort by line
    expect(issues[0].line).toBe(1);
    expect(issues[1].line).toBe(2);
    expect(issues[2].line).toBe(3);
    // Same line case: two tokens on same line → sort alphabetically by token
    const html2 = "let x = 1; const y = 2;";
    const issues2 = lintKindleHtml(html2);
    expect(issues2).toHaveLength(2);
    expect(issues2[0].token).toBe("const ");
    expect(issues2[1].token).toBe("let ");
  });

  // --- Case sensitivity tests ---

  it("case-insensitive for CSS tokens", () => {
    const html = "<div style='DISPLAY: FLEX'>ok</div>";
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].token).toBe("display: flex");
  });

  it("case-sensitive for JS tokens", () => {
    // "Const x" should NOT match "const " (case-sensitive)
    const html = "<script>Const x = 1;</script>";
    const issues = lintKindleHtml(html);
    expect(issues).toEqual([]);
  });

  // --- Multi-line mixed issues ---

  it("multi-line HTML with mixed issues", () => {
    const html = [
      "<div style='float:left'>ok</div>",       // line 1: clean
      "<script>let x = 1;</script>",             // line 2: let
      "<div style='display:flex'>ok</div>",       // line 3: display:flex (no matching token — clean)
      "<script>const y = 2;</script>",           // line 4: const
      "<script>fetch('/api');</script>",         // line 5: fetch(
    ].join("\n");
    const issues = lintKindleHtml(html);
    expect(issues.length).toBeGreaterThanOrEqual(3);
    // Check specific tokens
    const tokens = issues.map((i) => i.token);
    expect(tokens).toContain("let ");
    expect(tokens).toContain("const ");
    expect(tokens).toContain("fetch(");
  });
});
