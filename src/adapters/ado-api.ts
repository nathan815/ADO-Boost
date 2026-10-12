import { z } from "zod";
import type { ChangedFile, PrRoute, PullRequestContext, PullRequestThread, ReviewDraft, ThreadOverview } from "../core/types";

const identitySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1)
}).passthrough();

const pullRequestSchema = z.object({
  pullRequestId: z.number().int().positive(),
  title: z.string(),
  repository: z.object({ id: z.string().min(1) }).passthrough(),
  createdBy: identitySchema.optional()
}).passthrough();

const iterationSchema = z.object({
  id: z.number().int().positive(),
  sourceRefCommit: z.object({ commitId: z.string().min(1) }).passthrough(),
  targetRefCommit: z.object({ commitId: z.string().min(1) }).passthrough(),
  commonRefCommit: z.object({ commitId: z.string().min(1) }).passthrough()
}).passthrough();

const changeSchema = z.object({
  changeTrackingId: z.number().int().nonnegative(),
  changeType: z.string(),
  originalPath: z.string().optional(),
  item: z.object({
    path: z.string().min(1),
    objectId: z.string().optional(),
    originalObjectId: z.string().optional()
  }).passthrough()
}).passthrough();

const changesPageSchema = z.object({
  changeEntries: z.array(changeSchema),
  nextSkip: z.number().int().nonnegative().optional(),
  nextTop: z.number().int().nonnegative().optional()
}).passthrough();

const threadSchema = z.object({
  id: z.number().int().positive().optional(),
  status: z.string().optional(),
  isDeleted: z.boolean().optional(),
  threadContext: z.object({
    filePath: z.string().optional(),
    leftFileStart: z.object({ line: z.number().int().positive(), offset: z.number().int().nonnegative() }).optional(),
    rightFileStart: z.object({ line: z.number().int().positive(), offset: z.number().int().nonnegative() }).optional()
  }).passthrough().nullish(),
  properties: z.record(z.string(), z.unknown()).optional(),
  comments: z.array(z.object({
    id: z.number().int().positive().optional(),
    content: z.string().optional(),
    author: identitySchema.optional(),
    isDeleted: z.boolean().optional()
  }).passthrough()).optional()
}).passthrough();

const connectionDataSchema = z.object({
  authenticatedUser: z.object({
    id: z.string().min(1),
    displayName: z.string().min(1).optional(),
    customDisplayName: z.string().min(1).optional(),
    providerDisplayName: z.string().min(1).optional()
  }).passthrough().transform((identity) => ({
    id: identity.id,
    displayName: identity.displayName ?? identity.customDisplayName ?? identity.providerDisplayName ?? "Authenticated user"
  }))
}).passthrough();

const createdThreadSchema = z.object({
  id: z.number().int().positive(),
  comments: z.array(z.object({ id: z.number().int().positive() }).passthrough()).min(1)
}).passthrough();

const createdCommentSchema = z.object({ id: z.number().int().positive() }).passthrough();
const reviewerSchema = z.object({ vote: z.number().int() }).passthrough();

export interface HttpClient {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export class FetchHttpClient implements HttpClient {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, { credentials: "include", ...init });
  }
}

export class AdoApi {
  constructor(private readonly http: HttpClient) {}

  async getContext(route: PrRoute, signal?: AbortSignal): Promise<PullRequestContext> {
    const base = this.apiBase(route);
    const pr = await this.json(`${base}/git/repositories/${encodeURIComponent(route.repository)}/pullRequests/${route.pullRequestId}?api-version=7.1`, pullRequestSchema, signal);
    const iterations = await this.json(
      `${base}/git/repositories/${encodeURIComponent(pr.repository.id)}/pullRequests/${route.pullRequestId}/iterations?api-version=7.1`,
      z.object({ value: z.array(iterationSchema) }).passthrough(),
      signal
    );
    const reviewer = await this.json(`${this.organizationApiBase(route)}/connectionData?connectOptions=1&lastChangeId=-1&lastChangeId64=-1`, connectionDataSchema, signal);
    const latest = iterations.value.at(-1);
    if (!latest) throw new Error("Azure DevOps returned no pull request iterations");

    const sourceCommit = latest.sourceRefCommit.commitId;
    const targetCommit = latest.targetRefCommit.commitId;
    const mergeBaseCommit = latest.commonRefCommit.commitId;
    return {
      ...route,
      repositoryId: pr.repository.id,
      title: pr.title,
      sourceCommit,
      targetCommit,
      mergeBaseCommit,
      iterationId: latest.id,
      identity: `${route.origin}/${route.project}/${pr.repository.id}/${route.pullRequestId}/${latest.id}/${sourceCommit}/${mergeBaseCommit}`,
      reviewer: reviewer.authenticatedUser
    };
  }

  async getChanges(context: PullRequestContext, signal?: AbortSignal): Promise<ChangedFile[]> {
    const all: ChangedFile[] = [];
    let skip = 0;
    let top = 2000;

    do {
      const url = `${this.apiBase(context)}/git/repositories/${encodeURIComponent(context.repositoryId)}/pullRequests/${context.pullRequestId}/iterations/${context.iterationId}/changes?$top=${top}&$skip=${skip}&$compareTo=0&api-version=7.1`;
      const page = await this.json(url, changesPageSchema, signal);
      all.push(...page.changeEntries.map((entry) => ({
        trackingId: entry.changeTrackingId,
        path: entry.item.path,
        ...(entry.originalPath ? { originalPath: entry.originalPath } : {}),
        changeType: entry.changeType,
        ...(entry.item.objectId ? { objectId: entry.item.objectId } : {}),
        ...(entry.item.originalObjectId ? { originalObjectId: entry.item.originalObjectId } : {})
      })));
      skip = page.nextSkip ?? 0;
      top = page.nextTop ?? 0;
    } while (skip > 0 && top > 0);
    return all;
  }

  async getIterations(context: PullRequestContext, signal?: AbortSignal): Promise<Array<{ id: number; sourceCommit: string; mergeBaseCommit: string }>> {
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

  async getFileContent(context: PullRequestContext, path: string, commit: string, signal?: AbortSignal): Promise<{ text: string; size: number }> {
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
      ...(thread.threadContext?.filePath ? { path: thread.threadContext.filePath } : {}),
      ...(thread.threadContext?.rightFileStart?.line ? { line: thread.threadContext.rightFileStart.line } : {}),
      comments: (thread.comments ?? []).filter((comment) => comment.id).map((comment) => ({
        id: comment.id!,
        content: comment.content ?? "",
        author: comment.author?.displayName ?? "Unknown reviewer",
        isDeleted: comment.isDeleted ?? false
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

  async postDraft(context: PullRequestContext, draft: ReviewDraft, signal?: AbortSignal): Promise<{ threadId: number; commentId: number }> {
    if (draft.kind === "reply") {
      if (!draft.threadId) throw new Error("Reply draft is missing its thread");
      const url = `${this.apiBase(context)}/git/repositories/${encodeURIComponent(context.repositoryId)}/pullRequests/${context.pullRequestId}/threads/${draft.threadId}/comments?api-version=7.1`;
      const response = await this.http.fetch(url, {
        method: "POST",
        ...(signal ? { signal } : {}),
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ parentCommentId: 0, content: draft.body, commentType: 1 })
      });
      if (!response.ok) throw new Error(`Reply failed (${response.status})`);
      const comment = createdCommentSchema.parse(await response.json());
      return { threadId: draft.threadId, commentId: comment.id };
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

  async findAnnouncement(context: PullRequestContext, body: string, signal?: AbortSignal): Promise<{ threadId: number; commentId: number } | null> {
    const threads = await this.getThreads(context, signal);
    for (const thread of threads) {
      const comment = thread.comments?.find((candidate) =>
        !candidate.isDeleted
        && candidate.author?.id === context.reviewer.id
        && candidate.content?.trim() === body.trim()
      );
      if (thread.id && comment?.id) return { threadId: thread.id, commentId: comment.id };
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

  private async getThreads(context: PullRequestContext, signal?: AbortSignal) {
    const url = `${this.apiBase(context)}/git/repositories/${encodeURIComponent(context.repositoryId)}/pullRequests/${context.pullRequestId}/threads?api-version=7.1`;
    const response = await this.json(url, z.object({ value: z.array(threadSchema) }).passthrough(), signal);
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
