import { describe, expect, it } from "vitest";
import {
  compareKaijiBotVersions,
  isSameKaijiBotStableFamily,
  parseKaijiBotVersion,
  shouldWarnOnTouchedVersion,
} from "./version.js";

describe("parseKaijiBotVersion", () => {
  it("parses stable, correction, and beta forms", () => {
    expect(parseKaijiBotVersion("2026.3.23")).toEqual({
      major: 2026,
      minor: 3,
      patch: 23,
      revision: null,
      prerelease: null,
    });
    expect(parseKaijiBotVersion("2026.3.23-1")).toEqual({
      major: 2026,
      minor: 3,
      patch: 23,
      revision: 1,
      prerelease: null,
    });
    expect(parseKaijiBotVersion("2026.3.23-beta.1")).toEqual({
      major: 2026,
      minor: 3,
      patch: 23,
      revision: null,
      prerelease: ["beta", "1"],
    });
    expect(parseKaijiBotVersion("v2026.3.23.beta.2")).toEqual({
      major: 2026,
      minor: 3,
      patch: 23,
      revision: null,
      prerelease: ["beta", "2"],
    });
  });

  it("rejects invalid versions", () => {
    expect(parseKaijiBotVersion("2026.3")).toBeNull();
    expect(parseKaijiBotVersion("latest")).toBeNull();
  });
});

describe("compareKaijiBotVersions", () => {
  it("treats correction publishes as newer than the base stable release", () => {
    expect(compareKaijiBotVersions("2026.3.23", "2026.3.23-1")).toBe(-1);
    expect(compareKaijiBotVersions("2026.3.23-1", "2026.3.23")).toBe(1);
    expect(compareKaijiBotVersions("2026.3.23-2", "2026.3.23-1")).toBe(1);
  });

  it("treats stable as newer than beta and compares beta identifiers", () => {
    expect(compareKaijiBotVersions("2026.3.23", "2026.3.23-beta.1")).toBe(1);
    expect(compareKaijiBotVersions("2026.3.23-beta.2", "2026.3.23-beta.1")).toBe(1);
    expect(compareKaijiBotVersions("2026.3.23.beta.1", "2026.3.23-beta.2")).toBe(-1);
  });
});

describe("isSameKaijiBotStableFamily", () => {
  it("treats same-base stable and correction versions as one family", () => {
    expect(isSameKaijiBotStableFamily("2026.3.23", "2026.3.23-1")).toBe(true);
    expect(isSameKaijiBotStableFamily("2026.3.23-1", "2026.3.23-2")).toBe(true);
    expect(isSameKaijiBotStableFamily("2026.3.23", "2026.3.24")).toBe(false);
    expect(isSameKaijiBotStableFamily("2026.3.23-beta.1", "2026.3.23")).toBe(false);
  });
});

describe("shouldWarnOnTouchedVersion", () => {
  it("skips same-base stable families", () => {
    expect(shouldWarnOnTouchedVersion("2026.3.23", "2026.3.23-1")).toBe(false);
    expect(shouldWarnOnTouchedVersion("2026.3.23-1", "2026.3.23-2")).toBe(false);
  });

  it("skips same-base correction publishes even when current is a prerelease", () => {
    expect(shouldWarnOnTouchedVersion("2026.3.23-beta.1", "2026.3.23-1")).toBe(false);
  });

  it("skips same-base prerelease configs when current is newer", () => {
    expect(shouldWarnOnTouchedVersion("2026.3.23", "2026.3.23-beta.1")).toBe(false);
  });

  it("warns when the touched config is newer", () => {
    expect(shouldWarnOnTouchedVersion("2026.3.23-beta.1", "2026.3.23")).toBe(true);
    expect(shouldWarnOnTouchedVersion("2026.3.23", "2026.3.24")).toBe(true);
    expect(shouldWarnOnTouchedVersion("2026.3.23", "2027.1.1")).toBe(true);
  });
});
