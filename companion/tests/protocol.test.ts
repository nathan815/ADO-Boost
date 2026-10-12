import { describe, expect, it } from "vitest";
import { FrameDecoder, MAX_MESSAGE_BYTES, encodeFrame, requestSchema } from "../src/protocol.js";

describe("native messaging protocol", () => {
  it("decodes fragmented and multiplexed frames", () => {
    const first = encodeFrame({ id: "1", type: "health" });
    const second = encodeFrame({ id: "2", type: "cancel", requestId: "1" });
    const decoder = new FrameDecoder();
    expect(decoder.push(first.subarray(0, 3))).toEqual([]);
    expect(decoder.push(Buffer.concat([first.subarray(3), second]))).toEqual([
      { id: "1", type: "health" },
      { id: "2", type: "cancel", requestId: "1" }
    ]);
    decoder.finish();
  });

  it("rejects oversized frames before allocation", () => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(MAX_MESSAGE_BYTES + 1);
    expect(() => new FrameDecoder().push(header)).toThrow("Invalid native message length");
  });

  it("validates protocol versions and bounded request shapes", () => {
    expect(requestSchema.safeParse({ id: "1", type: "hello", version: 1, origin: "chrome-extension://oldakfajnbllipnfdaghapeiofnciopo/" }).success).toBe(true);
    expect(requestSchema.safeParse({ id: "1", type: "chat", question: "x".repeat(12001), title: "", comparisonIdentity: "id", files: [], excerpts: [] }).success).toBe(false);
  });
});
