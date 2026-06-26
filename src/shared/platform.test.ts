import { describe, it, expect, afterEach } from "vitest";
import { isLinuxLikePlatform, isAndroidTermux, getTermuxPrefix } from "./platform.ts";

const origPlatform = process.platform;

describe("isLinuxLikePlatform", () => {
  it('returns true for "linux"', () => {
    expect(isLinuxLikePlatform("linux")).toBe(true);
  });

  it('returns true for "android"', () => {
    expect(isLinuxLikePlatform("android")).toBe(true);
  });

  it('returns false for "darwin"', () => {
    expect(isLinuxLikePlatform("darwin")).toBe(false);
  });

  it('returns false for "win32"', () => {
    expect(isLinuxLikePlatform("win32")).toBe(false);
  });

  it('returns false for "aix"', () => {
    expect(isLinuxLikePlatform("aix")).toBe(false);
  });
});

describe("isAndroidTermux", () => {
  it('returns true for "android"', () => {
    expect(isAndroidTermux("android")).toBe(true);
  });

  it('returns false for "linux"', () => {
    expect(isAndroidTermux("linux")).toBe(false);
  });

  it('returns false for "darwin"', () => {
    expect(isAndroidTermux("darwin")).toBe(false);
  });
});

describe("getTermuxPrefix", () => {
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: origPlatform });
  });

  it("returns PREFIX env value when on android", () => {
    Object.defineProperty(process, "platform", { value: "android" });
    expect(getTermuxPrefix({ PREFIX: "/custom/prefix" })).toBe("/custom/prefix");
  });

  it("returns default path when android and no PREFIX env", () => {
    Object.defineProperty(process, "platform", { value: "android" });
    expect(getTermuxPrefix({})).toBe("/data/data/com.termux/files/usr");
  });

  it("returns null when not on android", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(getTermuxPrefix({})).toBeNull();
  });
});
