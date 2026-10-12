import { describe, expect, it } from "vitest";
import { AdoApi, type HttpClient } from "../src/adapters/ado-api";
import type { PullRequestContext } from "../src/core/types";
import type { ReviewDraft } from "../src/core/types";

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

  it("rejects malformed API responses instead of trusting assertions", async () => {
    const http = new QueueHttp([json({ changeEntries: [{ nope: true }] })]);
    await expect(new AdoApi(http).getChanges(context)).rejects.toThrow();
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

  it("treats a not-listed reviewer as no existing vote", async () => {
    const http = new QueueHttp([new Response("not found", { status: 404 })]);
    await expect(new AdoApi(http).getCurrentVote(context)).resolves.toBe(0);
  });

  it("does not swallow other reviewer lookup failures", async () => {
    const http = new QueueHttp([new Response("denied", { status: 403 })]);
    await expect(new AdoApi(http).getCurrentVote(context)).rejects.toThrow("403");
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
});
