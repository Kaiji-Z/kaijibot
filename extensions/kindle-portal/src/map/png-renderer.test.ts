/**
 * Tests for the cognitive map PNG renderer.
 *
 * Mocks `node:child_process` (to control the `dot` probe/render) and
 * `@viz-js/viz` (to control the WASM tier) so the three-tier fallback is
 * deterministic regardless of the host machine. Sharp runs for real — it is
 * a workspace-level dependency and the rasterization + 16-gray quantization
 * is the actual product behaviour we want to validate.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapGraph, MapNode } from "../types.js";

/**
 * Hoisted mock functions. `vi.hoisted` guarantees these exist before the
 * hoisted `vi.mock` factories run, so the factories can reference them.
 */
const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  vizInstance: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: mocks.execFileSync,
}));

vi.mock("@viz-js/viz", () => ({
  instance: mocks.vizInstance,
}));

import {
  __resetDotProbeCacheForTesting,
  buildDotSource,
  buildHandrolledSvg,
  probeDotCapability,
  renderGraphPng,
} from "./png-renderer.js";

/** A minimal valid SVG returned by the (mocked) dot / viz tiers. */
const SAMPLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="758" height="1011">' +
  '<rect width="100%" height="100%" fill="white"/>' +
  '<rect x="100" y="100" width="80" height="40" fill="gray8"/>' +
  '<text x="140" y="125" font-family="serif">node</text>' +
  "</svg>";

function node(id: string, label: string, strength = 0.5): MapNode {
  return { id, label, kind: "domain", strength };
}

/** 3-node fixture with one edge. */
const GRAPH_3: MapGraph = {
  nodes: [node("rust", "Rust", 1.0), node("wasm", "WebAssembly", 0.5), node("rtos", "RTOS", 0.0)],
  edges: [{ from: "rust", to: "wasm", label: "related" }],
};

/** Reset all mocks to "nothing available" (dot throws, viz throws) before
 * each test. Individual tests override to force a specific tier. */
beforeEach(() => {
  mocks.execFileSync.mockReset();
  mocks.vizInstance.mockReset();
  // Default: dot binary not installed → probe throws; viz not installed → rejects.
  mocks.execFileSync.mockImplementation(() => {
    throw new Error("spawn dot ENOENT");
  });
  mocks.vizInstance.mockImplementation(() => {
    throw new Error("viz-js not installed");
  });
  __resetDotProbeCacheForTesting();
});

// ─────────────────────────────────────────────────────────────────────────────
// buildDotSource — pure, no I/O
// ─────────────────────────────────────────────────────────────────────────────

describe("buildDotSource", () => {
  it("includes node declarations", () => {
    const src = buildDotSource(GRAPH_3);
    expect(src).toContain('"rust" [label="Rust"');
    expect(src).toContain('"wasm" [label="WebAssembly"');
    expect(src).toContain("digraph kindle_map {");
    expect(src).toContain("rankdir=LR;");
  });

  it("includes edge declarations", () => {
    const src = buildDotSource(GRAPH_3);
    expect(src).toContain('"rust" -> "wasm"');
  });

  it("escapes quotes in labels", () => {
    const graph: MapGraph = {
      nodes: [node('a"b', 'x"y', 0.5)],
      edges: [],
    };
    const src = buildDotSource(graph);
    // " in id/label becomes \"
    expect(src).toContain('a\\"b');
    expect(src).toContain('x\\"y');
    expect(src).not.toContain('a"b'); // raw unescaped pair must not survive
  });

  it("maps strength to gray fillcolor", () => {
    const full: MapGraph = { nodes: [node("a", "A", 1.0)], edges: [] };
    const zero: MapGraph = { nodes: [node("b", "B", 0.0)], edges: [] };
    expect(buildDotSource(full)).toContain('fillcolor="gray0"');
    expect(buildDotSource(zero)).toContain('fillcolor="gray15"');
  });

  it("empty graph → minimal valid DOT", () => {
    const src = buildDotSource({ nodes: [], edges: [] });
    // Still a valid (empty) digraph that graphviz would accept.
    expect(src).toContain("digraph kindle_map {");
    expect(src.trim().endsWith("}")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildHandrolledSvg — pure SVG string
// ─────────────────────────────────────────────────────────────────────────────

describe("buildHandrolledSvg", () => {
  it("emits a valid svg root with Kindle aspect dimensions", () => {
    const svg = buildHandrolledSvg(GRAPH_3, 758);
    expect(svg).toContain("<svg ");
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    // height ≈ width * 1.334
    expect(svg).toContain('width="758"');
    expect(svg).toContain('height="1011"');
  });

  it("onboarding svg when graph has no nodes", () => {
    const svg = buildHandrolledSvg({ nodes: [], edges: [] }, 758);
    expect(svg).toContain("No persona yet.");
    expect(svg).toContain("Chat with KaijiBot to build your cognitive map.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// probeDotCapability — cached
// ─────────────────────────────────────────────────────────────────────────────

describe("probeDotCapability", () => {
  it("caches the first probe result", () => {
    mocks.execFileSync.mockImplementation((_cmd: string, args: readonly string[]) => {
      if (args[0] === "-V") {
        return "";
      }
      throw new Error("unexpected");
    });
    expect(probeDotCapability()).toBe(true);
    // Mutate the mock: a second probe should still return cached true.
    mocks.execFileSync.mockImplementation(() => {
      throw new Error("now broken");
    });
    expect(probeDotCapability()).toBe(true);
  });

  it("returns false when dot is unavailable", () => {
    mocks.execFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(probeDotCapability()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renderGraphPng — end-to-end with real sharp
// ─────────────────────────────────────────────────────────────────────────────

describe("renderGraphPng", () => {
  it("returns Buffer starting with PNG magic bytes", async () => {
    const { buffer } = await renderGraphPng(GRAPH_3);
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50); // 'P'
    expect(buffer[2]).toBe(0x4e); // 'N'
    expect(buffer[3]).toBe(0x47); // 'G'
  });

  it("returns a valid capability value", async () => {
    const { capability } = await renderGraphPng(GRAPH_3);
    expect(["graphviz-dot", "viz-js-wasm", "handrolled-svg"]).toContain(capability);
  });

  it("uses graphviz-dot tier when dot binary is available", async () => {
    mocks.execFileSync.mockImplementation((_cmd: string, args: readonly string[]) => {
      if (args[0] === "-V") {
        return "";
      } // probe success
      if (args[0] === "-Tsvg") {
        return Buffer.from(SAMPLE_SVG, "utf-8");
      }
      throw new Error("unexpected dot invocation");
    });
    const { capability } = await renderGraphPng(GRAPH_3);
    expect(capability).toBe("graphviz-dot");
  });

  it("falls back to viz-js when dot unavailable", async () => {
    // dot probe/render both throw.
    mocks.execFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    // viz-js returns an SVG string via renderString.
    mocks.vizInstance.mockResolvedValue({
      renderString: () => SAMPLE_SVG,
    });
    const { capability } = await renderGraphPng(GRAPH_3);
    expect(capability).toBe("viz-js-wasm");
  });

  it("falls back to handrolled when dot and viz both fail", async () => {
    mocks.execFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mocks.vizInstance.mockRejectedValue(new Error("viz wasm broken"));
    const { capability } = await renderGraphPng(GRAPH_3);
    expect(capability).toBe("handrolled-svg");
  });

  it("empty graph → onboarding PNG with handrolled-svg capability", async () => {
    const { capability, buffer } = await renderGraphPng({ nodes: [], edges: [] });
    expect(capability).toBe("handrolled-svg");
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50);
  });

  it("never throws on malformed graph", async () => {
    // Malformed shape: nodes is a string, edges is null. Cast through
    // unknown — this is a deliberate runtime-guard test, not a type hole.
    const malformed = {
      nodes: "not-array",
      edges: null,
    } as unknown as MapGraph;
    const result = await renderGraphPng(malformed);
    expect(result.capability).toBe("handrolled-svg");
    expect(result.buffer[0]).toBe(0x89);
  });

  it("3-node graph produces a non-trivial PNG (>1KB)", async () => {
    const { buffer } = await renderGraphPng(GRAPH_3);
    expect(buffer.length).toBeGreaterThan(1024);
  });

  it("respects pngWidth option (IHDR width === requested)", async () => {
    const { buffer } = await renderGraphPng(GRAPH_3, { pngWidth: 400 });
    // PNG IHDR: bytes 16-19 are width (big-endian uint32).
    expect(buffer.readUInt32BE(16)).toBe(400);
  });

  it("uses default width 758 when pngWidth omitted", async () => {
    const { buffer } = await renderGraphPng(GRAPH_3);
    expect(buffer.readUInt32BE(16)).toBe(758);
  });
});
