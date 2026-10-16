import { z } from "zod";
import type { AnnouncementCompletion, ChangeEntry, ChangedFile, PrRoute, PullRequestComparison, PullRequestContext, PullRequestThread, ReviewDraft, ReviewVote, ThreadOverview, UnresolvedChange } from "../core/types";
import { legacyAnnouncementBody, readAnnouncementMetadata, readReviewCompletion, reviewCompletionBody } from "../core/announcement-content";
import { createResponseValidation, type ResponseWarning } from "./response-validation";
import { readChangeEntry } from "./change-response";

function createReadSchemas(warn: ResponseWarning) {
  const { optional } = createResponseValidation(warn);
  const identitySchema = z.object({
    id: z.string().min(1),
    imageUrl: optional(z.url({ protocol: /^https?$/ }), "identity.imageUrl"),
    displayName: optional(z.string().min(1), "identity.displayName").transform((name) => name ?? "Unknown reviewer")
  }).passthrough();

  const pullRequestSchema = z.object({
    pullRequestId: z.number().int().positive(),
    title: optional(z.string(), "title").transform((title) => title ?? "Untitled pull request"),
    repository: z.object({ id: z.string().min(1) }).passthrough(),
    createdBy: optional(identitySchema, "createdBy")
  }).passthrough();

  const iterationSchema = z.object({
    id: z.number().int().positive(),
    sourceRefCommit: z.object({ commitId: z.string().min(1) }).passthrough(),
    targetRefCommit: z.object({ commitId: z.string().min(1) }).passthrough(),
    commonRefCommit: z.object({ commitId: z.string().min(1) }).passthrough()
  }).passthrough();

  const changesPageSchema = z.object({
    changeEntries: z.array(z.unknown()),
    nextSkip: z.number().int().nonnegative().nullish(),
    nextTop: z.number().int().nonnegative().nullish()
  }).passthrough();

  const threadSchema = z.object({
    id: z.number().int().positive().nullish(),
    publishedDate: optional(z.iso.datetime({ offset: true }), "thread.publishedDate"),
    status: optional(z.string(), "thread.status"),
    isDeleted: z.boolean().nullish(),
    threadContext: z.object({
      filePath: z.string().nullish(),
      leftFileStart: z.object({ line: z.number().int().positive(), offset: z.number().int().nonnegative() }).nullish(),
      rightFileStart: z.object({ line: z.number().int().positive(), offset: z.number().int().nonnegative() }).nullish()
    }).passthrough().nullish(),
    properties: optional(z.record(z.string(), z.unknown()), "thread.properties"),
    comments: z.array(z.object({
      id: z.number().int().positive().nullish(),
      publishedDate: optional(z.iso.datetime({ offset: true }), "comment.publishedDate"),
      content: optional(z.string(), "comment.content"),
      commentType: optional(z.union([z.string(), z.number().int()]), "comment.commentType"),
      author: optional(identitySchema, "comment.author"),
      isDeleted: z.boolean().nullish()
    }).passthrough()).nullish()
  }).passthrough();

  const connectionDataSchema = z.object({
    authenticatedUser: z.object({
      id: z.string().min(1),
      displayName: optional(z.string().min(1), "authenticatedUser.displayName"),
      customDisplayName: optional(z.string().min(1), "authenticatedUser.customDisplayName"),
      providerDisplayName: optional(z.string().min(1), "authenticatedUser.providerDisplayName")
    }).passthrough().transform((identity) => ({
      id: identity.id,
      displayName: identity.displayName ?? identity.customDisplayName ?? identity.providerDisplayName ?? "Authenticated user"
    }))
  }).passthrough();

  return { pullRequestSchema, iterationSchema, changesPageSchema, threadSchema, connectionDataSchema };
}

function isVoteComment(type: string | number | null | undefined, content: string, properties: Record<string, unknown> | null | undefined): boolean {
  if (type !== "system" && type !== 3) return false;
  const threadType = properties?.CodeReviewThreadType;
  const voteThread = typeof threadType === "object" && threadType !== null && "$value" in threadType && threadType.$value === "VoteUpdate";
  return voteThread || /\bvoted\b/i.test(content);
}

const createdThreadSchema = z.object({
  id: z.number().int().positive(),
  comments: z.array(z.object({ id: z.number().int().positive() }).passthrough()).min(1)
}).passthrough();

const createdCommentSchema = z.object({ id: z.number().int().positive() }).passthrough();
const reviewerSchema = z.object({ vote: z.number().int() }).passthrough();
const voteEventSchema = z.object({
  id: z.number().int().positive(),
  publishedDate: z.iso.datetime({ offset: true }).optional(),
  properties: z.object({
    CodeReviewVotedByIdentity: z.object({ $value: z.string() }),
    CodeReviewVoteResult: z.object({ $value: z.union([z.string(), z.number().int()]) })
  }),
  identities: z.record(z.string(), z.object({ id: z.string().min(1) }))
});

export interface HttpClient {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export class FetchHttpClient implements HttpClient {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, { credentials: "include", ...init });
  }
}

export class AdoApi {
  private readonly schemas: ReturnType<typeof createReadSchemas>;

  constructor(private readonly http: HttpClient, private readonly warn: ResponseWarning = (message, details) => console.warn(message, details)) {
    this.schemas = createReadSchemas(warn);
  }

  async getContext(route: PrRoute, signal?: AbortSignal): Promise<PullRequestContext> {
    const { pullRequestSchema, connectionDataSchema } = this.schemas;
    const base = this.apiBase(route);
    const pr = await this.json(`${base}/git/repositories/${encodeURIComponent(route.repository)}/pullRequests/${route.pullRequestId}?api-version=7.1`, pullRequestSchema, signal);
    const [comparison, reviewer] = await Promise.all([
      this.getLatestComparisonForRepository(route, pr.repository.id, signal),
      this.json(`${this.organizationApiBase(route)}/connectionData?connectOptions=1&lastChangeId=-1&lastChangeId64=-1`, connectionDataSchema, signal)
    ]);
    return {
      ...comparison,
      title: pr.title,
      reviewer: reviewer.authenticatedUser
    };
  }

  async getLatestComparison(route: PrRoute, signal?: AbortSignal): Promise<PullRequestComparison> {
    return this.getLatestComparisonForRepository(route, route.repository, signal);
  }

  private async getLatestComparisonForRepository(route: PrRoute, repositoryId: string, signal?: AbortSignal): Promise<PullRequestComparison> {
    const { iterationSchema } = this.schemas;
    const iterations = await this.json(
      `${this.apiBase(route)}/git/repositories/${encodeURIComponent(repositoryId)}/pullRequests/${route.pullRequestId}/iterations?api-version=7.1`,
      z.object({ value: z.array(iterationSchema) }).passthrough(),
      signal
    );
    const latest = iterations.value.at(-1);
    if (!latest) throw new Error("Azure DevOps returned no pull request iterations");
    const sourceCommit = latest.sourceRefCommit.commitId;
    const targetCommit = latest.targetRefCommit.commitId;
    const mergeBaseCommit = latest.commonRefCommit.commitId;
    return {
      ...route,
      repositoryId,
      sourceCommit,
      targetCommit,
      mergeBaseCommit,
      iterationId: latest.id,
      identity: `${route.origin}/${route.project}/${repositoryId}/${route.pullRequestId}/${latest.id}/${sourceCommit}/${mergeBaseCommit}`
    };
  }

  async getChanges(context: PullRequestComparison, signal?: AbortSignal): Promise<ChangeEntry[]> {
    const all: ChangeEntry[] = [];
    let skip = 0;
    let top = 2000;

    do {
      const url = `${this.apiBase(context)}/git/repositories/${encodeURIComponent(context.repositoryId)}/pullRequests/${context.pullRequestId}/iterations/${context.iterationId}/changes?$top=${top}&$skip=${skip}&$compareTo=0&api-version=7.1`;
      const page = await this.json(url, this.schemas.changesPageSchema, signal);
      const offset = all.length;
      all.push(...page.changeEntries.map((entry, index) => readChangeEntry(entry, offset + index, this.warn)));
      skip = page.nextSkip ?? 0;
      top = page.nextTop ?? 0;
    } while (skip > 0 && top > 0);
    return all;
  }

  async getChangesWithDiagnostics(context: PullRequestComparison, signal?: AbortSignal): Promise<{ files: ChangedFile[]; unresolvedChanges: UnresolvedChange[] }> {
    const entries = await this.getChanges(context, signal);
    return {
      files: entries.filter((entry) => entry.unresolved !== true),
      unresolvedChanges: entries.filter((entry) => entry.unresolved === true)
    };
  }

  async getIterations(context: PullRequestContext, signal?: AbortSignal): Promise<Array<{ id: number; sourceCommit: string; mergeBaseCommit: string }>> {
    const { iterationSchema } = this.schemas;
    const response = await this.json(
      `${this.apiBase(context)}/git/repositories/${encodeURIComponent(context.repositoryId)}/pullRequests/${context.pullRequestId}/iterations?api-version=7.1`,
      z.object({ value: z.array(iterationSchema) }).passthrough(),
      signal
    );
    return response.value.map((iteration) => ({
      id: iteration.id,
      sourceCommit: iteration.sourceRefCommit.commitId,
      mergeBaseCommit: iteration.commonRefCommit.commitId
    }));
  }

  async getFileContent(context: PullRequestComparison, path: string, commit: string, signal?: AbortSignal): Promise<{ text: string; size: number }> {
    const query = new URLSearchParams({
      path,
      "versionDescriptor.version": commit,
      "versionDescriptor.versionType": "commit",
      includeContent: "true",
      "api-version": "7.1"
    });
    const response = await this.http.fetch(`${this.apiBase(context)}/git/repositories/${encodeURIComponent(context.repositoryId)}/items?${query}`, {
      ...(signal ? { signal } : {}),
      headers: { Accept: "text/plain" }
    });
    if (!response.ok) throw new Error(`File fetch failed (${response.status})`);
    const text = await response.text();
    return { text, size: new TextEncoder().encode(text).byteLength };
  }

  async getThreadOverview(context: PullRequestContext, signal?: AbortSignal): Promise<ThreadOverview> {
    try {
      const threads = await this.getThreads(context, signal);
      const active = threads.filter((thread) => !["fixed", "closed", "wontfix", "bydesign"].includes((thread.status ?? "active").toLowerCase())).length;
      return { state: "available", active, resolved: threads.length - active, total: threads.length };
    } catch (error) {
      return { state: "error", active: 0, resolved: 0, total: 0, detail: error instanceof Error ? error.message : "Thread loading failed" };
    }
  }

  async listThreads(context: PullRequestContext, signal?: AbortSignal): Promise<PullRequestThread[]> {
    const threads = await this.getThreads(context, signal);
    return threads.filter((thread) => thread.id).map((thread) => ({
      id: thread.id!,
      status: thread.status ?? "active",
      ...(thread.publishedDate ? { publishedDate: thread.publishedDate } : {}),
      ...(thread.threadContext?.filePath ? { path: thread.threadContext.filePath } : {}),
      ...(thread.threadContext?.rightFileStart ? { line: thread.threadContext.rightFileStart.line }
        : thread.threadContext?.leftFileStart ? { line: thread.threadContext.leftFileStart.line } : {}),
      comments: (thread.comments ?? []).filter((comment) => comment.id).map((comment) => ({
        id: comment.id!,
        content: comment.content ?? "",
        author: comment.author?.displayName ?? "Unknown reviewer",
        ...(comment.author?.imageUrl ? { authorImageUrl: comment.author.imageUrl } : {}),
        ...(isVoteComment(comment.commentType, comment.content ?? "", thread.properties) ? { isVoteUpdate: true } : {}),
        isDeleted: comment.isDeleted ?? false,
        ...(comment.publishedDate ? { publishedDate: comment.publishedDate } : {})
      }))
    }));
  }

  async getCurrentVote(context: PullRequestContext, signal?: AbortSignal): Promise<number> {
    const url = `${this.apiBase(context)}/git/repositories/${encodeURIComponent(context.repositoryId)}/pullRequests/${context.pullRequestId}/reviewers/${encodeURIComponent(context.reviewer.id)}?api-version=7.1`;
    const response = await this.http.fetch(url, { ...(signal ? { signal } : {}), headers: { Accept: "application/json" } });
    if (response.status === 404) return 0;
    if (!response.ok) throw new Error(`Reviewer lookup failed (${response.status})`);
    return reviewerSchema.parse(await response.json()).vote;
  }

  async getVoteTimestamp(context: PullRequestContext, vote: ReviewVote, signal?: AbortSignal): Promise<string> {
    const events = (await this.getThreads(context, signal)).flatMap((thread) => {
      const type = thread.properties?.CodeReviewThreadType;
      if (!type || typeof type !== "object" || !("$value" in type) || type.$value !== "VoteUpdate") return [];
      const parsed = voteEventSchema.safeParse(thread);
      if (!parsed.success) {
        throw new Error(`Azure DevOps vote event validation failed: ${z.prettifyError(parsed.error)}`);
      }
      const voter = parsed.data.identities[parsed.data.properties.CodeReviewVotedByIdentity.$value];
      if (!voter) throw new Error("Azure DevOps did not identify the reviewer for a vote event");
      return voter.id.toLowerCase() === context.reviewer.id.toLowerCase() ? [parsed.data] : [];
    });
    // Event order must not fall back to an older vote when the latest event has no timestamp.
    const latest = events.sort((left, right) => right.id - left.id)[0];
    if (!latest?.publishedDate || String(latest.properties.CodeReviewVoteResult.$value) !== String(vote)) {
      throw new Error("Azure DevOps has not provided a timestamp for your current vote. Return to the tab or reload to check again.");
    }
    return latest.publishedDate;
  }

  async postDraft(context: PullRequestContext, draft: ReviewDraft, signal?: AbortSignal): Promise<{ threadId: number; commentId: number }> {
    if (draft.kind === "reply") {
      if (!draft.threadId) throw new Error("Reply draft is missing its thread");
      return this.postReply(context, draft.threadId, 0, draft.body, signal);
    }

    const payload: Record<string, unknown> = {
      comments: [{ parentCommentId: 0, content: draft.body, commentType: 1 }],
      status: 1,
      properties: { "AzureDevOps++.OperationId": { $type: "System.String", $value: draft.operationId } }
    };
    if (draft.kind === "inline") {
      if (!draft.path || !draft.line) throw new Error("Inline draft is missing a file and line");
      const position = { line: draft.line, offset: 1 };
      payload.threadContext = draft.side === "left"
        ? { filePath: draft.path, leftFileStart: position, leftFileEnd: position }
        : { filePath: draft.path, rightFileStart: position, rightFileEnd: position };
      payload.pullRequestThreadContext = {
        ...(draft.trackingId !== undefined ? { changeTrackingId: draft.trackingId } : {}),
        iterationContext: {
          firstComparingIteration: context.iterationId,
          secondComparingIteration: context.iterationId
        }
      };
    }
    const url = `${this.apiBase(context)}/git/repositories/${encodeURIComponent(context.repositoryId)}/pullRequests/${context.pullRequestId}/threads?api-version=7.1`;
    const response = await this.http.fetch(url, {
      method: "POST",
      ...(signal ? { signal } : {}),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Feedback post failed (${response.status})`);
    const created = createdThreadSchema.parse(await response.json());
    return { threadId: created.id, commentId: created.comments[0]!.id };
  }

  async findDraftDelivery(context: PullRequestContext, draft: ReviewDraft, signal?: AbortSignal): Promise<{ threadId: number; commentId: number } | null> {
    if (draft.kind === "reply") return null;
    const threads = await this.getThreads(context, signal);
    for (const thread of threads) {
      const property = thread.properties?.["AzureDevOps++.OperationId"] as { $value?: unknown } | string | undefined;
      const operationId = typeof property === "string" ? property : property?.$value;
      const comment = thread.comments?.find((candidate) =>
        !candidate.isDeleted
        && candidate.author?.id === context.reviewer.id
        && candidate.content?.trim() === draft.body.trim()
      );
      const line = draft.side === "left" ? thread.threadContext?.leftFileStart?.line : thread.threadContext?.rightFileStart?.line;
      const targetMatches = draft.kind !== "inline" || (thread.threadContext?.filePath === draft.path && line === draft.line);
      if (thread.id && comment?.id && operationId === draft.operationId && targetMatches) {
        return { threadId: thread.id, commentId: comment.id };
      }
    }
    return null;
  }

  async setVote(context: PullRequestContext, vote: number, signal?: AbortSignal): Promise<void> {
    const url = `${this.apiBase(context)}/git/repositories/${encodeURIComponent(context.repositoryId)}/pullRequests/${context.pullRequestId}/reviewers/${encodeURIComponent(context.reviewer.id)}?api-version=7.1`;
    const response = await this.http.fetch(url, {
      method: "PUT",
      ...(signal ? { signal } : {}),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ id: context.reviewer.id, vote })
    });
    if (!response.ok) throw new Error(`Review decision failed (${response.status})`);
  }

  async setThreadStatus(context: PullRequestContext, threadId: number, status: number, signal?: AbortSignal): Promise<void> {
    const url = `${this.apiBase(context)}/git/repositories/${encodeURIComponent(context.repositoryId)}/pullRequests/${context.pullRequestId}/threads/${threadId}?api-version=7.1`;
    const response = await this.http.fetch(url, {
      method: "PATCH",
      ...(signal ? { signal } : {}),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    if (!response.ok) throw new Error(`Thread status update failed (${response.status})`);
  }

  async findAnnouncement(context: PullRequestContext, body: string, signal?: AbortSignal): Promise<{ threadId: number; commentId: number; body: string; postedAt?: string } | null> {
    const threads = await this.getThreads(context, signal);
    for (const thread of threads) {
      if (thread.threadContext) continue;
      for (const comment of thread.comments ?? []) {
        if (!thread.id || !comment.id || comment.isDeleted || comment.author?.id !== context.reviewer.id || !comment.content) continue;
        const metadata = readAnnouncementMetadata(comment.content);
        if (matchesAnnouncement(context, comment.content, body)) return {
          threadId: thread.id,
          commentId: comment.id,
          body: comment.content,
          ...(metadata ? { postedAt: metadata.startedAt } : {})
        };
      }
    }
    return null;
  }

  async postAnnouncement(context: PullRequestContext, body: string, signal?: AbortSignal): Promise<{ threadId: number; commentId: number }> {
    const url = `${this.apiBase(context)}/git/repositories/${encodeURIComponent(context.repositoryId)}/pullRequests/${context.pullRequestId}/threads?api-version=7.1`;
    const response = await this.http.fetch(url, {
      method: "POST",
      ...(signal ? { signal } : {}),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ comments: [{ parentCommentId: 0, content: body, commentType: 1 }], status: 1 })
    });
    if (!response.ok) throw new Error(`Announcement failed (${response.status})`);
    const created = createdThreadSchema.parse(await response.json());
    return { threadId: created.id, commentId: created.comments[0]!.id };
  }

  async getAnnouncementState(context: PullRequestContext, threadId: number, commentId: number, body: string, signal?: AbortSignal): Promise<{ closed: boolean; completions: AnnouncementCompletion[] }> {
    const url = `${this.apiBase(context)}/git/repositories/${encodeURIComponent(context.repositoryId)}/pullRequests/${context.pullRequestId}/threads/${threadId}?api-version=7.1`;
    const thread = await this.json(url, this.schemas.threadSchema, signal);
    const original = thread.comments?.find((comment) => comment.id === commentId && !comment.isDeleted);
    if (thread.id !== threadId || thread.isDeleted || thread.threadContext || original?.author?.id !== context.reviewer.id || !original.content || !matchesAnnouncement(context, original.content, body)) {
      throw new Error("The review-start announcement could not be verified for the current reviewer");
    }
    const completions = (thread.comments ?? [])
      .filter((comment) => comment.id && comment.id !== commentId && !comment.isDeleted && comment.author?.id === context.reviewer.id)
      .sort((left, right) => left.id! - right.id!)
      .flatMap((comment) => {
        const completion = readReviewCompletion(comment.content ?? "", comment.id!);
        return completion ? [completion] : [];
      });
    return {
      closed: thread.status?.toLowerCase() === "closed",
      completions
    };
  }

  async postAnnouncementCompletion(context: PullRequestContext, threadId: number, commentId: number, completion: AnnouncementCompletion, signal?: AbortSignal): Promise<{ threadId: number; commentId: number }> {
    return this.postReply(context, threadId, commentId, reviewCompletionBody(completion), signal);
  }

  private async postReply(context: PullRequestContext, threadId: number, parentCommentId: number, body: string, signal?: AbortSignal): Promise<{ threadId: number; commentId: number }> {
    const url = `${this.apiBase(context)}/git/repositories/${encodeURIComponent(context.repositoryId)}/pullRequests/${context.pullRequestId}/threads/${threadId}/comments?api-version=7.1`;
    const response = await this.http.fetch(url, {
      method: "POST",
      ...(signal ? { signal } : {}),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ parentCommentId, content: body, commentType: 1 })
    });
    if (!response.ok) throw new Error(`Reply failed (${response.status})`);
    const comment = createdCommentSchema.parse(await response.json());
    return { threadId, commentId: comment.id };
  }

  private async getThreads(context: PullRequestContext, signal?: AbortSignal) {
    const url = `${this.apiBase(context)}/git/repositories/${encodeURIComponent(context.repositoryId)}/pullRequests/${context.pullRequestId}/threads?api-version=7.1`;
    const response = await this.json(url, z.object({ value: z.array(this.schemas.threadSchema) }).passthrough(), signal);
    return response.value.filter((thread) => !thread.isDeleted);
  }

  private apiBase(route: PrRoute): string {
    return new URL(route.origin).hostname === "dev.azure.com"
      ? `${route.origin}/${encodeURIComponent(route.organization)}/${encodeURIComponent(route.project)}/_apis`
      : `${route.origin}/${encodeURIComponent(route.project)}/_apis`;
  }

  private organizationApiBase(route: PrRoute): string {
    return new URL(route.origin).hostname === "dev.azure.com"
      ? `${route.origin}/${encodeURIComponent(route.organization)}/_apis`
      : `${route.origin}/_apis`;
  }

  private async json<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    const response = await this.http.fetch(url, { ...(signal ? { signal } : {}), headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Azure DevOps API failed (${response.status})`);
    const payload: unknown = await response.json();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const endpoint = new URL(url).pathname;
      throw new Error(`Azure DevOps response validation failed for ${endpoint}: ${z.prettifyError(parsed.error)}`);
    }
    return parsed.data;
  }
}

function matchesAnnouncement(context: PullRequestContext, content: string, body: string): boolean {
  const metadata = readAnnouncementMetadata(content);
  return metadata
    ? metadata.repositoryId === context.repositoryId
      && metadata.pullRequestId === context.pullRequestId
      && metadata.reviewerId === context.reviewer.id
    : content.trim() === body.trim() || content.trim() === legacyAnnouncementBody(context);
}
