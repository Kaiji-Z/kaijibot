import { describe, expect, it, vi } from "vitest";
import {
  buildMessageWithAttachments,
  type ChatAttachment,
  parseMessageWithAttachments,
} from "./chat-attachments.js";

vi.mock("../media/store.js", async () => {
  const actual = await vi.importActual<typeof import("../media/store.js")>("../media/store.js");
  return {
    ...actual,
    saveMediaBuffer: vi.fn().mockResolvedValue({
      id: "mock-media-id.png",
      path: "/tmp/mock-media/mock-media-id.png",
      size: 100,
    }),
    deleteMediaBuffer: vi.fn().mockResolvedValue(undefined),
  };
});

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";

async function parseWithWarnings(message: string, attachments: ChatAttachment[]) {
  const logs: string[] = [];
  const parsed = await parseMessageWithAttachments(message, attachments, {
    log: { warn: (warning) => logs.push(warning) },
  });
  return { parsed, logs };
}

describe("buildMessageWithAttachments", () => {
  it("embeds a single image as data URL", () => {
    const msg = buildMessageWithAttachments("see this", [
      {
        type: "image",
        mimeType: "image/png",
        fileName: "dot.png",
        content: PNG_1x1,
      },
    ]);
    expect(msg).toContain("see this");
    expect(msg).toContain(`data:image/png;base64,${PNG_1x1}`);
    expect(msg).toContain("![dot.png]");
  });

  it("rejects non-image mime types", () => {
    const bad: ChatAttachment = {
      type: "file",
      mimeType: "application/pdf",
      fileName: "a.pdf",
      content: "AAA",
    };
    expect(() => buildMessageWithAttachments("x", [bad])).toThrow(/image/);
  });
});

describe("parseMessageWithAttachments", () => {
  it("strips data URL prefix", async () => {
    const parsed = await parseMessageWithAttachments(
      "see this",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "dot.png",
          content: `data:image/png;base64,${PNG_1x1}`,
        },
      ],
      { log: { warn: () => {} } },
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
  });

  it("sniffs mime when missing", async () => {
    const { parsed, logs } = await parseWithWarnings("see this", [
      {
        type: "image",
        fileName: "dot.png",
        content: PNG_1x1,
      },
    ]);
    expect(parsed.message).toBe("see this");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
    expect(logs).toHaveLength(0);
  });

  it("drops non-image payloads and logs", async () => {
    const pdf = Buffer.from("%PDF-1.4\n").toString("base64");
    const { parsed, logs } = await parseWithWarnings("x", [
      {
        type: "file",
        mimeType: "image/png",
        fileName: "not-image.pdf",
        content: pdf,
      },
    ]);
    expect(parsed.images).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/non-image/i);
  });

  it("prefers sniffed mime type and logs mismatch", async () => {
    const { parsed, logs } = await parseWithWarnings("x", [
      {
        type: "image",
        mimeType: "image/jpeg",
        fileName: "dot.png",
        content: PNG_1x1,
      },
    ]);
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/mime mismatch/i);
  });

  it("drops unknown mime when sniff fails and logs", async () => {
    const unknown = Buffer.from("not an image").toString("base64");
    const { parsed, logs } = await parseWithWarnings("x", [
      { type: "file", fileName: "unknown.bin", content: unknown },
    ]);
    expect(parsed.images).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/unable to detect image mime type/i);
  });

  it("keeps valid images and drops invalid ones", async () => {
    const pdf = Buffer.from("%PDF-1.4\n").toString("base64");
    const { parsed, logs } = await parseWithWarnings("x", [
      {
        type: "image",
        mimeType: "image/png",
        fileName: "dot.png",
        content: PNG_1x1,
      },
      {
        type: "file",
        mimeType: "image/png",
        fileName: "not-image.pdf",
        content: pdf,
      },
    ]);
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
    expect(logs.some((l) => /non-image/i.test(l))).toBe(true);
  });
});

describe("shared attachment validation", () => {
  it("rejects invalid base64 content for both builder and parser", async () => {
    const bad: ChatAttachment = {
      type: "image",
      mimeType: "image/png",
      fileName: "dot.png",
      content: "%not-base64%",
    };

    expect(() => buildMessageWithAttachments("x", [bad])).toThrow(/base64/i);
    await expect(
      parseMessageWithAttachments("x", [bad], { log: { warn: () => {} } }),
    ).rejects.toThrow(/base64/i);
  });

  it("rejects images over limit for both builder and parser without decoding base64", async () => {
    const big = "A".repeat(10_000);
    const att: ChatAttachment = {
      type: "image",
      mimeType: "image/png",
      fileName: "big.png",
      content: big,
    };

    const fromSpy = vi.spyOn(Buffer, "from");
    try {
      expect(() => buildMessageWithAttachments("x", [att], { maxBytes: 16 })).toThrow(
        /exceeds size limit/i,
      );
      await expect(
        parseMessageWithAttachments("x", [att], { maxBytes: 16, log: { warn: () => {} } }),
      ).rejects.toThrow(/exceeds size limit/i);
      const base64Calls = fromSpy.mock.calls.filter((args) => (args as unknown[])[1] === "base64");
      expect(base64Calls).toHaveLength(0);
    } finally {
      fromSpy.mockRestore();
    }
  });
});

describe("parseMessageWithAttachments — text-only model (supportsImages: false)", () => {
  it("saves images to disk and adds [image attached: path] marker", async () => {
    const logs: string[] = [];
    const parsed = await parseMessageWithAttachments(
      "what is this",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "screenshot.png",
          content: PNG_1x1,
        },
      ],
      {
        supportsImages: false,
        log: { warn: (m) => logs.push(m) },
      },
    );

    expect(parsed.images).toHaveLength(0);
    expect(parsed.imageOrder).toEqual(["offloaded"]);
    expect(parsed.offloadedRefs).toHaveLength(1);
    expect(parsed.offloadedRefs[0]?.path).toBe("/tmp/mock-media/mock-media-id.png");
    expect(parsed.message).toContain("[image attached: /tmp/mock-media/mock-media-id.png]");
    expect(parsed.message).toContain("what is this");
    expect(logs.some((l) => /saved to disk/i.test(l))).toBe(true);
  });

  it("returns empty when no valid images", async () => {
    const parsed = await parseMessageWithAttachments(
      "hello",
      [
        {
          type: "file",
          mimeType: "application/pdf",
          fileName: "doc.pdf",
          content: Buffer.from("%PDF-1.4\n").toString("base64"),
        },
      ],
      {
        supportsImages: false,
        log: { warn: () => {} },
      },
    );

    expect(parsed.images).toHaveLength(0);
    expect(parsed.offloadedRefs).toHaveLength(0);
    expect(parsed.message).toBe("hello");
  });

  it("saves multiple images and adds marker for each", async () => {
    const parsed = await parseMessageWithAttachments(
      "compare these",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "a.png",
          content: PNG_1x1,
        },
        {
          type: "image",
          mimeType: "image/png",
          fileName: "b.png",
          content: PNG_1x1,
        },
      ],
      { supportsImages: false, log: { warn: () => {} } },
    );

    expect(parsed.images).toHaveLength(0);
    expect(parsed.offloadedRefs).toHaveLength(2);
    expect(parsed.message).toContain("[image attached: /tmp/mock-media/mock-media-id.png]");
    const markers = parsed.message.match(/\[image attached:/g);
    expect(markers).toHaveLength(2);
  });

  it("cleans up saved files on failure", async () => {
    const { saveMediaBuffer, deleteMediaBuffer } = await import("../media/store.js");
    vi.mocked(saveMediaBuffer)
      .mockResolvedValueOnce({ id: "first.png", path: "/tmp/first.png", size: 100 })
      .mockRejectedValueOnce(new Error("disk full"));

    await expect(
      parseMessageWithAttachments(
        "x",
        [
          { type: "image", mimeType: "image/png", fileName: "a.png", content: PNG_1x1 },
          { type: "image", mimeType: "image/png", fileName: "b.png", content: PNG_1x1 },
        ],
        { supportsImages: false, log: { warn: () => {} } },
      ),
    ).rejects.toThrow(/disk full/);

    expect(vi.mocked(deleteMediaBuffer)).toHaveBeenCalledWith("first.png", "inbound");
  });
});
