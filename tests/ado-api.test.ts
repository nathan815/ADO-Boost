import { describe, expect, it, vi } from "vitest";
import { AdoApi, type HttpClient } from "../src/adapters/ado-api";
import type { PullRequestContext } from "../src/core/types";
import type { ReviewDraft } from "../src/core/types";
import { announcementBody, legacyAnnouncementBody } from "../src/core/announcement-content";

class QueueHttp implements HttpClient {
  readonly urls: string[] = [];
  constructor(private readonly responses: Response[]) {}
  async fetch(input: RequestInfo | URL): Promise<Response> {
    this.urls.push(String(input));
    const response = this.responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  }
}

const context: PullRequestContext = {
  origin: "https://dev.azure.com",
  organization: "org",
  project: "project",
  repository: "repo",
  repositoryId: "repo-id",
  pullRequestId: 7,
  title: "PR",
  sourceCommit: "source",
  targetCommit: "target",
  mergeBaseCommit: "base",
  iterationId: 3,
  identity: "identity",
  reviewer: { id: "me", displayName: "Me" }
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("AdoApi", () => {
  it("scopes connection data to the dev.azure.com organization", async () => {
    const http = new QueueHttp([
      json({ pullRequestId: 7, title: "PR", repository: { id: "repo-id" } }),
      json({ value: [{ id: 3, sourceRefCommit: { commitId: "source" }, targetRefCommit: { commitId: "target" }, commonRefCommit: { commitId: "base" } }] }),
      json({ authenticatedUser: { id: "me", displayName: "Me" } })
    ]);
    await new AdoApi(http).getContext({
      origin: "https://dev.azure.com",
      organization: "my org",
      project: "project",
      repository: "repo",
      pullRequestId: 7
    });
    expect(http.urls[2]).toBe("https://dev.azure.com/my%20org/_apis/connectionData?connectOptions=1&lastChangeId=-1&lastChangeId64=-1");
  });

  it("accepts the connectionData provider display-name shape", async () => {
    const http = new QueueHttp([
      json({ pullRequestId: 7, title: "PR", repository: { id: "repo-id" } }),
      json({ value: [{ id: 3, sourceRefCommit: { commitId: "source" }, targetRefCommit: { commitId: "target" }, commonRefCommit: { commitId: "base" } }] }),
      json({ authenticatedUser: { id: "me", providerDisplayName: "Provider Name" } })
    ]);
    const result = await new AdoApi(http).getContext({
      origin: "https://dev.azure.com",
      organization: "org",
      project: "project",
      repository: "repo",
      pullRequestId: 7
    });
    expect(result.reviewer).toEqual({ id: "me", displayName: "Provider Name" });
  });

  it("paginates iteration changes against the common commit", async () => {
    const http = new QueueHttp([
      json({ changeEntries: [{ changeTrackingId: 1, changeType: "edit", item: { path: "/a.ts", objectId: "1" } }], nextSkip: 1, nextTop: 2 }),
      json({ changeEntries: [{ changeTrackingId: 2, changeType: "add", item: { path: "/b.ts", objectId: "2" } }], nextSkip: 0, nextTop: 0 })
    ]);
    const changes = await new AdoApi(http).getChanges(context);
    expect(changes).toHaveLength(2);
    expect(http.urls.every((url) => url.includes("%24compareTo=0") || url.includes("$compareTo=0"))).toBe(true);
  });

  it("retains unresolved changes with warnings and continues pagination", async () => {
    const warn = vi.fn();
    const http = new QueueHttp([
      json({
        changeEntries: [
          { changeTrackingId: 1, changeType: "edit", item: { path: "/a.ts" } },
          { changeTrackingId: 2, changeType: "edit", item: { path: null } },
          { nope: true }
        ],
        nextSkip: 3,
        nextTop: 2
      }),
      json({ changeEntries: [{ changeTrackingId: 3, changeType: "add", item: { path: "/b.ts" } }], nextSkip: null, nextTop: null })
    ]);
    await expect(new AdoApi(http, warn).getChangesWithDiagnostics(context)).resolves.toEqual({
      files: [
        { trackingId: 1, changeType: "edit", path: "/a.ts" },
        { trackingId: 3, changeType: "add", path: "/b.ts" }
      ],
      unresolvedChanges: [
        {
          unresolved: true,
          trackingId: 2,
          changeType: "edit",
          detail: "No usable file path",
          raw: { changeTrackingId: 2, changeType: "edit", item: { path: null } }
        },
        {
          unresolved: true,
          detail: "No usable change tracking ID; No usable change type; No usable file path",
          raw: { nope: true }
        }
      ]
    });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toContain("changeEntries[1]");
    expect(http.urls[1]).toContain("$skip=3");
  });

  it.each([null, undefined])("recovers a deleted file's null or missing path from originalPath: %s", async (path) => {
    const warn = vi.fn();
    const http = new QueueHttp([json({ changeEntries: [{ changeTrackingId: 1, changeType: "delete", originalPath: "/old.ts", item: { path } }] })]);
    await expect(new AdoApi(http, warn).getChanges(context)).resolves.toEqual([{ trackingId: 1, changeType: "delete", path: "/old.ts", originalPath: "/old.ts" }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([null, "", 42])("retains a record whose path cannot be recovered without inventing one: %s", async (path) => {
    const warn = vi.fn();
    const raw = { changeTrackingId: 1, changeType: "rename", originalPath: "/old.ts", item: { path } };
    const api = new AdoApi(new QueueHttp([json({ changeEntries: [raw] })]), warn);
    await expect(api.getChanges(context)).resolves.toEqual([{
      unresolved: true, trackingId: 1, changeType: "rename", detail: "No usable file path", raw
    }]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("retained unresolved"), raw);
    expect(warn.mock.calls[0]?.[0]).not.toContain("expected string");
  });

  it("does not discard any entries because of schema mismatches", async () => {
    const rawEntries = [null, 42, [], { unexpected: true }, { changeTrackingId: 1, changeType: "edit", item: { path: null } }];
    const warn = vi.fn();
    const api = new AdoApi(new QueueHttp([json({ changeEntries: rawEntries })]), warn);
    const changes = await api.getChanges(context);
    expect(changes).toHaveLength(rawEntries.length);
    expect(changes.map((entry) => entry.unresolved === true ? entry.raw : entry.rawEntry)).toEqual(rawEntries);
    expect(warn).toHaveBeenCalledTimes(rawEntries.length);
  });

  it("normalizes numeric-string tracking IDs without discarding the change", async () => {
    const warn = vi.fn();
    const api = new AdoApi(new QueueHttp([json({
      changeEntries: [{ changeTrackingId: "42", changeType: "edit", item: { path: "/a.ts" } }]
    })]), warn);
    await expect(api.getChanges(context)).resolves.toEqual([{ trackingId: 42, changeType: "edit", path: "/a.ts" }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts nullable optional change metadata and unknown fields", async () => {
    const warn = vi.fn();
    const http = new QueueHttp([json({
      changeEntries: [{ changeTrackingId: 1, changeType: "edit", originalPath: null, item: { path: "/a.ts", objectId: null, originalObjectId: null, futureField: {} } }],
      futureField: true
    })]);
    await expect(new AdoApi(http, warn).getChanges(context)).resolves.toEqual([{ trackingId: 1, changeType: "edit", path: "/a.ts" }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("makes schema mismatches advisory while retaining the file and raw metadata", async () => {
    const warn = vi.fn();
    const raw = { changeTrackingId: 1, changeType: "edit", item: { path: "/a.ts", objectId: {}, originalObjectId: 42 } };
    const http = new QueueHttp([json({ changeEntries: [raw] })]);
    await expect(new AdoApi(http, warn).getChanges(context)).resolves.toEqual([{ trackingId: 1, changeType: "edit", path: "/a.ts", rawEntry: raw }]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("the change was retained"), raw);
  });

  it("retains a rename with an invalid original path as unresolved rather than fetching the wrong base file", async () => {
    const warn = vi.fn();
    const raw = { changeTrackingId: 1, changeType: "rename", originalPath: {}, item: { path: "/a.ts" } };
    const api = new AdoApi(new QueueHttp([json({
      changeEntries: [raw]
    })]), warn);
    await expect(api.getChangesWithDiagnostics(context)).resolves.toEqual({
      files: [],
      unresolvedChanges: [{ unresolved: true, trackingId: 1, changeType: "rename", path: "/a.ts", detail: "No usable original path for the rename", raw }]
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each([{ changeEntries: null }, { changeEntries: [], nextSkip: "2000" }])("rejects unusable envelopes or pagination: %j", async (payload) => {
    const api = new AdoApi(new QueueHttp([json(payload)]));
    await expect(api.getChanges(context)).rejects.toThrow("Azure DevOps response validation failed");
  });

  it("returns an explicit thread error state", async () => {
    const http = new QueueHttp([new Response("denied", { status: 403 })]);
    await expect(new AdoApi(http).getThreadOverview(context)).resolves.toMatchObject({ state: "error", total: 0 });
  });

  it("accepts general threads with a null thread context", async () => {
    const http = new QueueHttp([json({
      value: [{
        id: 10,
        status: "active",
        threadContext: null,
        comments: [{ id: 2, content: "General feedback", author: { id: "me", displayName: "Me" } }]
      }]
    })]);
    await expect(new AdoApi(http).listThreads(context)).resolves.toEqual([{
      id: 10,
      status: "active",
      comments: [{ id: 2, content: "General feedback", author: "Me", isDeleted: false }]
    }]);
  });

  it.each([null, undefined, {}])("accepts threads with absent or empty properties: %s", async (properties) => {
    const payload = {
      value: [{
        id: 10,
        status: "active",
        properties,
        comments: [{ id: 2, content: "General feedback", author: { id: "me", displayName: "Me" } }]
      }]
    };
    const api = new AdoApi(new QueueHttp([json(payload), json(payload)]));
    await expect(api.listThreads(context)).resolves.toEqual([{
      id: 10,
      status: "active",
      comments: [{ id: 2, content: "General feedback", author: "Me", isDeleted: false }]
    }]);
    await expect(api.getThreadOverview(context)).resolves.toEqual({ state: "available", active: 1, resolved: 0, total: 1 });
  });

  it.each(["invalid", 1, []])("warns about malformed optional thread properties: %s", async (properties) => {
    const warn = vi.fn();
    const api = new AdoApi(new QueueHttp([json({ value: [{ id: 10, properties }] })]), warn);
    await expect(api.listThreads(context)).resolves.toEqual([{ id: 10, status: "active", comments: [] }]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("accepts nullable thread and comment metadata", async () => {
    const api = new AdoApi(new QueueHttp([json({
      value: [{ id: 10, status: null, isDeleted: null, threadContext: { filePath: null, leftFileStart: null, rightFileStart: null }, comments: [{ id: 2, content: null, author: null, isDeleted: null }] }]
    })]));
    await expect(api.listThreads(context)).resolves.toEqual([{ id: 10, status: "active", comments: [{ id: 2, content: "", author: "Unknown reviewer", isDeleted: false }] }]);
  });

  it("retains thread and comment publication dates for chronological sorting", async () => {
    const publishedDate = "2026-10-15T18:30:00Z";
    const replyDate = "2026-10-15T18:45:00Z";
    const api = new AdoApi(new QueueHttp([json({ value: [{
      id: 10, publishedDate,
      comments: [{ id: 2, content: "Reply", publishedDate: replyDate }]
    }] })]));
    await expect(api.listThreads(context)).resolves.toEqual([{
      id: 10, status: "active", publishedDate,
      comments: [{ id: 2, content: "Reply", author: "Unknown reviewer", isDeleted: false, publishedDate: replyDate }]
    }]);
  });

  it.each([
    { leftFileStart: { line: 12, offset: 1 }, rightFileStart: null, expectedLine: 12 },
    { leftFileStart: null, rightFileStart: { line: 24, offset: 1 }, expectedLine: 24 },
    { leftFileStart: { line: 12, offset: 1 }, rightFileStart: { line: 24, offset: 1 }, expectedLine: 24 }
  ])("retains the file anchor for old-side and new-side comments: %j", async ({ expectedLine, ...positions }) => {
    const api = new AdoApi(new QueueHttp([json({ value: [{
      id: 10, threadContext: { filePath: "/file.ts", ...positions }
    }] })]));
    await expect(api.listThreads(context)).resolves.toEqual([{
      id: 10, status: "active", path: "/file.ts", line: expectedLine, comments: []
    }]);
  });

  it("retains comment author photos", async () => {
    const imageUrl = "https://dev.azure.com/org/_apis/GraphProfile/MemberAvatars/reviewer";
    const api = new AdoApi(new QueueHttp([json({ value: [{
      id: 10, comments: [{ id: 2, author: { id: "me", displayName: "Me", imageUrl } }]
    }] })]));
    await expect(api.listThreads(context)).resolves.toMatchObject([{
      comments: [{ author: "Me", authorImageUrl: imageUrl }]
    }]);
  });

  it.each(["system", 3])("identifies voted system comments of type %s without hiding normal voting discussions", async (commentType) => {
    const api = new AdoApi(new QueueHttp([json({ value: [{
      id: 10, comments: [
        { id: 1, content: "Alice voted 10", commentType },
        { id: 2, content: "I voted after reviewing this.", commentType: "text" },
        { id: 3, content: "Other system message", commentType }
      ]
    }] })]));
    const [thread] = await api.listThreads(context);
    expect(thread!.comments[0]!.isVoteUpdate).toBe(true);
    expect(thread!.comments[1]).not.toHaveProperty("isVoteUpdate");
    expect(thread!.comments[2]).not.toHaveProperty("isVoteUpdate");
  });

  it("identifies localized vote events by metadata and preserves reviewer replies in the same thread", async () => {
    const api = new AdoApi(new QueueHttp([json({ value: [{
      id: 10,
      properties: { CodeReviewThreadType: { $type: "System.String", $value: "VoteUpdate" } },
      comments: [
        { id: 1, content: "Localized vote notification", commentType: "system" },
        { id: 2, content: "Reviewer reply", commentType: "text" }
      ]
    }] })]));
    const [thread] = await api.listThreads(context);
    expect(thread!.comments[0]!.isVoteUpdate).toBe(true);
    expect(thread!.comments[1]).not.toHaveProperty("isVoteUpdate");
  });

  it.each(["javascript:alert(1)", "data:image/svg+xml,photo", "invalid", 123])("warns and omits invalid avatar URLs: %s", async (imageUrl) => {
    const warn = vi.fn();
    const api = new AdoApi(new QueueHttp([json({ value: [{
      id: 10, comments: [{ id: 2, author: { id: "me", displayName: "Me", imageUrl } }]
    }] })]), warn);
    const result = await api.listThreads(context);
    expect(result[0]!.comments[0]).toMatchObject({ author: "Me" });
    expect(result[0]!.comments[0]).not.toHaveProperty("authorImageUrl");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("warns and omits malformed publication dates without dropping discussions", async () => {
    const warn = vi.fn();
    const api = new AdoApi(new QueueHttp([json({ value: [{
      id: 10, publishedDate: "bad date",
      comments: [{ id: 2, content: "Feedback", publishedDate: 123 }]
    }] })]), warn);
    await expect(api.listThreads(context)).resolves.toEqual([{
      id: 10, status: "active",
      comments: [{ id: 2, content: "Feedback", author: "Unknown reviewer", isDeleted: false }]
    }]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("treats a not-listed reviewer as no existing vote", async () => {
    const http = new QueueHttp([new Response("not found", { status: 404 })]);
    await expect(new AdoApi(http).getCurrentVote(context)).resolves.toBe(0);
  });

  it("does not swallow other reviewer lookup failures", async () => {
    const http = new QueueHttp([new Response("denied", { status: 403 })]);
    await expect(new AdoApi(http).getCurrentVote(context)).rejects.toThrow("403");
  });

  it("does not turn missing repository IDs or write confirmations into warnings", async () => {
    const warn = vi.fn();
    const api = new AdoApi(new QueueHttp([
      json({ pullRequestId: 7, title: null, repository: { id: null } }),
      json({ id: null, comments: [{ id: null }] })
    ]), warn);
    await expect(api.getContext(context)).rejects.toThrow("Azure DevOps response validation failed");
    await expect(api.postAnnouncement(context, "Starting review")).rejects.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("requires exact operation and inline target evidence when reconciling feedback", async () => {
    const http = new QueueHttp([json({
      value: [{
        id: 10,
        status: "active",
        properties: { "AzureDevOps++.OperationId": { $value: "operation" } },
        threadContext: { filePath: "/wrong.ts", rightFileStart: { line: 4, offset: 1 } },
        comments: [{ id: 2, content: "Same body", author: { id: "me", displayName: "Me" } }]
      }]
    })]);
    const draft: ReviewDraft = {
      id: "draft",
      operationId: "operation",
      kind: "inline",
      body: "Same body",
      path: "/expected.ts",
      line: 4,
      side: "right",
      trackingId: 1,
      comparisonIdentity: "identity",
      createdAt: "",
      updatedAt: "",
      delivery: "ambiguous"
    };
    await expect(new AdoApi(http).findDraftDelivery(context, draft)).resolves.toBeNull();
  });

  it("never guesses reply delivery from matching historical text", async () => {
    const draft: ReviewDraft = {
      id: "draft",
      operationId: "operation",
      kind: "reply",
      body: "Same body",
      threadId: 22,
      comparisonIdentity: "identity",
      createdAt: "",
      updatedAt: "",
      delivery: "ambiguous"
    };
    const http = new QueueHttp([]);
    await expect(new AdoApi(http).findDraftDelivery(context, draft)).resolves.toBeNull();
    expect(http.urls).toEqual([]);
  });

  it("finds review-start metadata after a new iteration and display name change", async () => {
    const body = announcementBody(context, "2026-10-14T04:00:00.000Z");
    const http = new QueueHttp([json({
      value: [{
        id: 10,
        comments: [{ id: 2, content: body.replace("has started reviewing this PR.", "is reviewing this PR."), author: { id: "me", displayName: "Me" } }]
      }]
    })]);
    const updatedContext = { ...context, iterationId: 4, sourceCommit: "updated", reviewer: { id: "me", displayName: "Renamed" } };
    await expect(new AdoApi(http).findAnnouncement(updatedContext, announcementBody(updatedContext))).resolves.toMatchObject({
      threadId: 10, commentId: 2, postedAt: "2026-10-14T04:00:00.000Z"
    });
  });

  it("recognizes legacy announcements from another browser", async () => {
    const body = legacyAnnouncementBody(context);
    const http = new QueueHttp([json({
      value: [{ id: 10, comments: [{ id: 2, content: body, author: { id: "me", displayName: "Me" } }] }]
    })]);
    await expect(new AdoApi(http).findAnnouncement(context, announcementBody(context))).resolves.toEqual({
      threadId: 10, commentId: 2, body
    });
  });

  it.each(["author", "reviewer", "repository", "pr", "deleted-comment", "deleted-thread", "inline", "version", "malformed"])(
    "does not restore unrelated or invalid announcements: %s",
    async (mismatch) => {
      let body = announcementBody(context);
      if (mismatch === "reviewer") body = body.replace('"reviewerId":"me"', '"reviewerId":"someone-else"');
      if (mismatch === "repository") body = body.replace('"repositoryId":"repo-id"', '"repositoryId":"other"');
      if (mismatch === "pr") body = body.replace('"pullRequestId":7', '"pullRequestId":8');
      if (mismatch === "version") body = body.replace('"version":1', '"version":2');
      if (mismatch === "malformed") body = body.replace('"version":1', '"version":');
      const http = new QueueHttp([json({
        value: [{
          id: 10,
          isDeleted: mismatch === "deleted-thread",
          ...(mismatch === "inline" ? { threadContext: { filePath: "/file.ts" } } : {}),
          comments: [{
            id: 2, content: body, isDeleted: mismatch === "deleted-comment",
            author: { id: mismatch === "author" ? "someone-else" : "me", displayName: "Me" }
          }]
        }]
      })]);
      await expect(new AdoApi(http).findAnnouncement(context, "unmatched body")).resolves.toBeNull();
    }
  );
});
