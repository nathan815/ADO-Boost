import { z } from "zod";

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 1024 * 1024;

const fileSchema = z.object({
  path: z.string().min(1).max(2048),
  changeType: z.string().max(40),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable()
});

const excerptSchema = z.object({
  path: z.string().min(1).max(2048),
  comparison: z.string().min(1).max(4096),
  omitted: z.boolean(),
  text: z.string().max(32_000)
});

export const requestSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1).max(100), type: z.literal("hello"), version: z.number().int(), origin: z.string().url() }),
  z.object({ id: z.string().min(1).max(100), type: z.literal("health") }),
  z.object({
    id: z.string().min(1).max(100),
    type: z.literal("semantic-groups"),
    title: z.string().max(1000),
    comparisonIdentity: z.string().min(1).max(4096),
    files: z.array(fileSchema).min(1).max(4000),
    excerpts: z.array(excerptSchema).max(20)
  }),
  z.object({
    id: z.string().min(1).max(100),
    type: z.literal("chat"),
    question: z.string().min(1).max(12000),
    title: z.string().max(1000),
    comparisonIdentity: z.string().min(1).max(4096),
    files: z.array(fileSchema).max(4000),
    excerpts: z.array(excerptSchema).max(20)
  }),
  z.object({ id: z.string().min(1).max(100), type: z.literal("cancel"), requestId: z.string().min(1).max(100) })
]);

export type NativeRequest = z.infer<typeof requestSchema>;

export type NativeResponse =
  | { id: string; ok: true; type: string; data: unknown }
  | { id: string; ok: false; type: "error"; error: { code: string; message: string } };

export function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  if (body.length > MAX_MESSAGE_BYTES) throw new Error(`Response exceeds ${MAX_MESSAGE_BYTES} bytes`);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export class FrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length <= 0 || length > MAX_MESSAGE_BYTES) throw new Error(`Invalid native message length ${length}`);
      if (this.buffer.length < length + 4) break;
      const body = this.buffer.subarray(4, length + 4);
      this.buffer = this.buffer.subarray(length + 4);
      messages.push(JSON.parse(body.toString("utf8")));
    }
    return messages;
  }

  finish(): void {
    if (this.buffer.length !== 0) throw new Error("Native message stream ended with an incomplete frame");
  }
}
