import { z } from "zod";

z.config({ jitless: true });

export const DISCUSSION_CHANNEL = "adopp-native-discussions-v1";

const draftSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["general", "inline", "reply"]),
  source: z.enum(["manual", "copilot"]),
  body: z.string().max(150000),
  path: z.string().max(8192).optional(),
  line: z.number().int().positive().optional(),
  side: z.enum(["left", "right"]).optional(),
  trackingId: z.number().int().optional(),
  threadId: z.number().int().positive().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  delivery: z.enum(["pending", "sending", "posted", "ambiguous", "failed"]),
  error: z.string().max(2000).optional()
}).strict();

export const discussionConfigurationSchema = z.object({
  channel: z.literal(DISCUSSION_CHANNEL),
  kind: z.literal("configure"),
  session: z.string().uuid(),
  page: z.string().url().max(8192),
  reviewer: z.object({
    id: z.string().min(1).max(500),
    displayName: z.string().min(1).max(500)
  }).strict(),
  drafts: z.array(draftSchema).max(2000),
  enabled: z.boolean()
}).strict();

export const discussionCommandSchema = z.discriminatedUnion("kind", [
  discussionConfigurationSchema,
  z.object({
    channel: z.literal(DISCUSSION_CHANNEL),
    kind: z.literal("dispose"),
    session: z.string().uuid()
  }).strict()
]);

export const discussionActionSchema = z.discriminatedUnion("action", [
  z.object({
    channel: z.literal(DISCUSSION_CHANNEL),
    kind: z.literal("action"),
    session: z.string().uuid(),
    action: z.literal("add"),
    draft: z.object({
      kind: z.enum(["general", "inline", "reply"]),
      body: z.string().trim().min(1).max(150000),
      path: z.string().max(8192).optional(),
      line: z.number().int().positive().optional(),
      side: z.enum(["left", "right"]).optional(),
      threadId: z.number().int().positive().optional()
    }).strict()
  }).strict(),
  z.object({
    channel: z.literal(DISCUSSION_CHANNEL),
    kind: z.literal("action"),
    session: z.string().uuid(),
    action: z.literal("update"),
    id: z.string().uuid(),
    body: z.string().trim().min(1).max(150000)
  }).strict(),
  z.object({
    channel: z.literal(DISCUSSION_CHANNEL),
    kind: z.literal("action"),
    session: z.string().uuid(),
    action: z.literal("remove"),
    id: z.string().uuid()
  }).strict()
]);

export const discussionStatusSchema = z.object({
  channel: z.literal(DISCUSSION_CHANNEL),
  kind: z.literal("status"),
  session: z.string().uuid(),
  state: z.enum(["waiting", "active", "unavailable"]),
  detail: z.string().max(1000)
}).strict();

export type DiscussionConfiguration = z.infer<typeof discussionConfigurationSchema>;
export type DiscussionAction = z.infer<typeof discussionActionSchema>;
export type DiscussionStatus = z.infer<typeof discussionStatusSchema>;

