import { z } from "zod";
import type { PullRequestContext } from "./types";

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
  const json = JSON.stringify(metadata).replace(/[<>&]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
  const name = context.reviewer.displayName.replace(/[\r\n]+/g, " ")
    .replace(/[\\`*_{}[\]()#+.!|~:<>&-]/g, (character) => `&#${character.charCodeAt(0)};`);
  return `**${name}** has started reviewing this PR.\n\n_Started on iteration **${context.iterationId}**. Posted via the [ADO Boost](https://github.com/nathan815/ADO-Boost) browser extension._\n\n<!-- ado-boost:${json} -->`;
}

export function readAnnouncementMetadata(content: string): AnnouncementMetadata | null {
  const match = /<!-- ado-boost:(\{[^\r\n]*\}) -->\s*$/.exec(content);
  if (!match) return null;
  let value: unknown;
  try {
    value = JSON.parse(match[1]!);
  } catch {
    return null;
  }
  const parsed = metadataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
