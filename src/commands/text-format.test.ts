import { describe, expect, it } from "vitest";
import { shortenText } from "./text-format.js";

describe("shortenText", () => {
  it("returns original text when it fits", () => {
    expect(shortenText("kaijibot", 16)).toBe("kaijibot");
  });

  it("truncates and appends ellipsis when over limit", () => {
    expect(shortenText("kaijibot-status-output", 10)).toBe("kaijibot-…");
  });

  it("counts multi-byte characters correctly", () => {
    expect(shortenText("hello🙂world", 7)).toBe("hello🙂…");
  });
});
