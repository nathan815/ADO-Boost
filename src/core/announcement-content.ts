import { z } from "zod";
import type { AnnouncementCompletion, PullRequestContext, ReviewVote } from "./types";

const metadataSchema = z.object({
  version: z.literal(1),
  kind: z.literal("review-start"),
  repositoryId: z.string().min(1),
  pullRequestId: z.number().int().positive(),
  reviewerId: z.string().min(1),
  startedAt: z.iso.datetime(),
  iterationId: z.number().int().positive(),
  sourceCommit: z.string().min(1),
  targetCommit: z.string().min(1),
  mergeBaseCommit: z.string().min(1)
});

export type AnnouncementMetadata = z.infer<typeof metadataSchema>;

const completionSchema = z.discriminatedUnion("kind", [
  z.object({ version: z.literal(1), id: z.string().min(1), at: z.iso.datetime({ offset: true }), kind: z.literal("vote"), vote: z.union([z.literal(10), z.literal(5), z.literal(-5), z.literal(-10)]) }),
  z.object({ version: z.literal(1), id: z.string().min(1), at: z.iso.datetime({ offset: true }), kind: z.literal("submission"), commentCount: z.number().int().nonnegative() })
]);

export function reviewCompletionBody(completion: AnnouncementCompletion): string {
  const labels: Record<ReviewVote, string> = { 10: "approve", 5: "approve with suggestions", "-5": "wait for author", "-10": "reject" };
  const text = completion.kind === "vote"
    ? `Finished reviewing with vote ${labels[completion.vote]} at ${completion.at}`
    : `Submitted ${completion.commentCount} review comments at ${completion.at}`;
  const metadata = completionSchema.parse({ ...completion, version: 1 });
  return `${text}\n\n<!-- ado-boost-completion:${encodeMetadata(metadata)} -->`;
}

export function readReviewCompletion(content: string, commentId: number): AnnouncementCompletion | null {
  const parsed = completionSchema.safeParse(readMetadata(content, "ado-boost-completion"));
  if (!parsed.success) return null;
  const { id, at } = parsed.data;
  const common = { id, at, status: "posted" as const, commentId };
  return parsed.data.kind === "vote"
    ? { ...common, kind: "vote", vote: parsed.data.vote }
    : { ...common, kind: "submission", commentCount: parsed.data.commentCount };
}

export function legacyAnnouncementBody(context: PullRequestContext): string {
  return `${context.reviewer.displayName} has started reviewing this PR.\n\nPosted via ADO Boost Browser Extension`;
}

export function announcementBody(context: PullRequestContext, startedAt = new Date().toISOString()): string {
  const metadata: AnnouncementMetadata = {
    version: 1,
    kind: "review-start",
    repositoryId: context.repositoryId,
    pullRequestId: context.pullRequestId,
    reviewerId: context.reviewer.id,
    startedAt,
    iterationId: context.iterationId,
    sourceCommit: context.sourceCommit,
    targetCommit: context.targetCommit,
    mergeBaseCommit: context.mergeBaseCommit
  };
  // Keep arbitrary context strings from closing the hidden HTML comment.
  const json = encodeMetadata(metadata);
  const name = context.reviewer.displayName.replace(/[\r\n]+/g, " ")
    .replace(/[\\`*_{}[\]()#+.!|~:<>&-]/g, (character) => `&#${character.charCodeAt(0)};`);
  return `**${name}** has started reviewing this PR.\n\n_Started on iteration **${context.iterationId}**. Posted via the [ADO Boost](https://github.com/nathan815/ADO-Boost) browser extension._\n\n<!-- ado-boost:${json} -->`;
}

export function readAnnouncementMetadata(content: string): AnnouncementMetadata | null {
  const parsed = metadataSchema.safeParse(readMetadata(content, "ado-boost"));
  return parsed.success ? parsed.data : null;
}

function encodeMetadata(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function readMetadata(content: string, marker: string): unknown {
  const match = new RegExp(`<!-- ${marker}:(\\{[^\\r\\n]*\\}) -->\\s*$`).exec(content);
  if (!match) return null;
  try {
    return JSON.parse(match[1]!);
  } catch {
    return null;
  }
}
