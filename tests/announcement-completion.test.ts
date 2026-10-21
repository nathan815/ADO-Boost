import { describe, expect, it, vi } from "vitest";
import { AdoApi } from "../src/adapters/ado-api";
import { MemoryBrowserStore } from "../src/adapters/browser";
import { AnnouncementService } from "../src/core/announcement";
import { announcementBody, readReviewCompletion, reviewCompletionBody } from "../src/core/announcement-content";
import type { AnnouncementCompletion, PullRequestContext, ReviewVote } from "../src/core/types";

const context: PullRequestContext = {
  origin: "https://dev.azure.com", organization: "org", project: "project", repository: "repo",
  repositoryId: "repo-id", pullRequestId: 7, title: "PR", sourceCommit: "source", targetCommit: "target",
  mergeBaseCommit: "base", iterationId: 3, identity: "identity", reviewer: { id: "me", displayName: "Me" }
};
const at = "2026-10-16T04:10:00.000Z";
const voteAt = "2026-10-16T04:02:03.456Z";
const body = announcementBody(context, "2026-10-16T04:00:00.000Z");

async function fixture() {
  const store = new MemoryBrowserStore();
  const api = new AdoApi({ fetch: vi.fn() });
  const service = new AnnouncementService(api, store, () => new Date(at));
  const state: { closed: boolean; completions: AnnouncementCompletion[] } = { closed: false, completions: [] };
  const find = vi.spyOn(api, "findAnnouncement").mockResolvedValue({ threadId: 8, commentId: 1, body });
  const vote = vi.spyOn(api, "getCurrentVote").mockResolvedValue(0);
  const timestamp = vi.spyOn(api, "getVoteTimestamp").mockResolvedValue(voteAt);
  const read = vi.spyOn(api, "getAnnouncementState").mockImplementation(async () => structuredClone(state));
  const post = vi.spyOn(api, "postAnnouncementCompletion").mockImplementation(async (_context, _threadId, _parentId, completion) => {
    const commentId = state.completions.length + 2;
    state.completions.push({ ...completion, status: "posted", commentId });
    return { threadId: 8, commentId };
  });
  const close = vi.spyOn(api, "setThreadStatus").mockImplementation(async () => { state.closed = true; });
  await store.saveAnnouncement({ key: service.key(context), status: "posted", threadId: 8, commentId: 1, body });
  return { store, api, service, state, find, vote, timestamp, read, post, close };
}

describe("Review announcement completion", () => {
  it.each([
    [10, "approve"], [5, "approve with suggestions"], [-5, "wait for author"], [-10, "reject"]
  ] as const)("announces server vote %s with its actual timestamp rather than the detection time", async (value, label) => {
    const { service, vote, timestamp, post, close } = await fixture();
    vote.mockResolvedValue(value);
    const record = await service.finish(context, { kind: "vote" });
    expect(vote).toHaveBeenCalledWith(context, undefined);
    expect(post).toHaveBeenCalledOnce();
    const completion = post.mock.calls[0]![3];
    expect(timestamp).toHaveBeenCalledExactlyOnceWith(context, value, undefined);
    expect(reviewCompletionBody(completion)).toContain(`Finished reviewing with vote ${label} at ${voteAt}`);
    expect(close).toHaveBeenCalledExactlyOnceWith(context, 8, 4, undefined);
    expect(record?.completions).toMatchObject([{ kind: "vote", vote: value, at: voteAt, status: "closed" }]);
  });

  it("counts a comment-only submission and does not require or change the vote", async () => {
    const { service, vote, timestamp, post } = await fixture();
    const record = await service.finish(context, { kind: "submission", submissionId: "review-1", commentCount: 3 });
    expect(vote).not.toHaveBeenCalled();
    expect(timestamp).not.toHaveBeenCalled();
    expect(reviewCompletionBody(post.mock.calls[0]![3])).toContain(`Submitted 3 review comments at ${at}`);
    expect(record?.completions).toMatchObject([{ id: "review-1", kind: "submission", commentCount: 3, status: "closed" }]);
  });

  it("adds a later vote reply even after a submitted-comments reply closed the thread", async () => {
    const { service, vote, post, state, close } = await fixture();
    await service.finish(context, { kind: "submission", submissionId: "review-1", commentCount: 2 });
    expect(state.closed).toBe(true);
    vote.mockResolvedValue(10);
    await service.finish(context, { kind: "vote" });
    await service.finish(context, { kind: "vote" });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls.map((call) => call[3].kind)).toEqual(["submission", "vote"]);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("posts a vote reply when the announcement was already manually closed", async () => {
    const { service, state, vote, post } = await fixture();
    state.closed = true;
    vote.mockResolvedValue(-5);
    await service.finish(context, { kind: "vote" });
    expect(post).toHaveBeenCalledOnce();
    expect(post.mock.calls[0]![3]).toMatchObject({ kind: "vote", vote: -5 });
  });

  it("does not invent a vote time or close the announcement if the vote event is unavailable", async () => {
    const { service, vote, timestamp, post, close } = await fixture();
    vote.mockResolvedValue(10);
    timestamp.mockRejectedValueOnce(new Error("Vote timestamp unavailable"));
    await expect(service.finish(context, { kind: "vote" })).rejects.toThrow("Vote timestamp unavailable");
    expect(post).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    await service.finish(context, { kind: "vote" });
    expect(post.mock.calls[0]![3].at).toBe(voteAt);
  });

  it("announces observed vote changes, including returning to an earlier decision, without repeating unchanged votes", async () => {
    const { service, vote, post } = await fixture();
    for (const value of [10, 10, -5, -5, -10, 10] satisfies ReviewVote[]) {
      vote.mockResolvedValue(value);
      await service.finish(context, { kind: "vote" });
    }
    expect(post.mock.calls.map((call) => call[3])).toMatchObject([
      { kind: "vote", vote: 10 }, { kind: "vote", vote: -5 }, { kind: "vote", vote: -10 }, { kind: "vote", vote: 10 }
    ]);
  });

  it("deduplicates submission retries but allows a new comment-only submission", async () => {
    const { service, post } = await fixture();
    await service.finish(context, { kind: "submission", submissionId: "review-1", commentCount: 2 });
    await service.finish(context, { kind: "submission", submissionId: "review-1", commentCount: 2 });
    await service.finish(context, { kind: "submission", submissionId: "review-2", commentCount: 1 });
    expect(post.mock.calls.map((call) => call[3].id)).toEqual(["review-1", "review-2"]);
  });

  it("does nothing while the authenticated reviewer has not voted", async () => {
    const { service, post, read, vote, close } = await fixture();
    const record = await service.finish(context, { kind: "vote" });
    expect(vote).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(record?.completions ?? []).toEqual([]);
  });

  it("leaves the announcement unchanged when the reviewer lookup fails", async () => {
    const { service, store, vote, read, post, close } = await fixture();
    const before = await service.status(context);
    vote.mockRejectedValue(new Error("Reviewer lookup failed (400)"));
    await expect(service.finish(context, { kind: "vote" })).rejects.toThrow("Reviewer lookup failed (400)");
    expect(read).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(await store.getAnnouncement(service.key(context))).toEqual(before);
  });

  it("does not create an announcement just because the user voted", async () => {
    const { api, post, vote, find } = await fixture();
    find.mockResolvedValue(null);
    const service = new AnnouncementService(api, new MemoryBrowserStore());
    expect(await service.finish(context, { kind: "vote" })).toBeNull();
    expect(post).not.toHaveBeenCalled();
    expect(vote).not.toHaveBeenCalled();
  });

  it("detects an external vote after loading an announcement in a fresh browser and reconciles replies across browsers", async () => {
    const { api, service, vote, post } = await fixture();
    vote.mockResolvedValue(10);
    await service.finish(context, { kind: "vote" });
    const otherBrowser = new AnnouncementService(api, new MemoryBrowserStore());
    const record = await otherBrowser.finish(context, { kind: "vote" });
    expect(record?.completions).toMatchObject([{ kind: "vote", vote: 10, status: "closed" }]);
    expect(post).toHaveBeenCalledOnce();
    vote.mockResolvedValue(-10);
    await otherBrowser.finish(context, { kind: "vote" });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("retries closing the thread without reposting a successful completion reply", async () => {
    const { service, close, post } = await fixture();
    close.mockRejectedValueOnce(new Error("Close failed"));
    const trigger = { kind: "submission", submissionId: "review-1", commentCount: 2 } as const;
    await expect(service.finish(context, trigger)).rejects.toThrow("Close failed");
    await service.finish(context, trigger);
    expect(post).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("does not blindly retry an uncertain reply, but can reconcile later server evidence", async () => {
    const { service, post, state } = await fixture();
    post.mockRejectedValueOnce(new TypeError("Connection lost"));
    const trigger = { kind: "submission", submissionId: "review-1", commentCount: 2 } as const;
    await expect(service.finish(context, trigger)).rejects.toThrow("Connection lost");
    await expect(service.finish(context, trigger)).rejects.toThrow("may already have posted");
    expect(post).toHaveBeenCalledOnce();
    state.completions.push({ ...post.mock.calls[0]![3], status: "posted", commentId: 2 });
    await expect(service.finish(context, trigger)).resolves.toMatchObject({ completions: [{ status: "closed" }] });
    expect(post).toHaveBeenCalledOnce();
  });
});

describe("Completion API and metadata", () => {
  const completion: AnnouncementCompletion = { id: "review-1", at, status: "posting", kind: "submission", commentCount: 4 };

  it("posts the completion as a reply to the original announcement comment", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 9 }), { status: 200 }));
    await new AdoApi({ fetch }).postAnnouncementCompletion(context, 8, 1, completion);
    expect(fetch.mock.calls[0]![0]).toContain("/threads/8/comments?");
    const request = fetch.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({ parentCommentId: 1, commentType: 1, content: reviewCompletionBody(completion) });
    expect(readReviewCompletion(reviewCompletionBody(completion), 9)).toEqual({ ...completion, status: "posted", commentId: 9 });
  });

  it("reads only the authenticated reviewer's completion replies, in comment order", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 8, status: "closed", comments: [
        { id: 1, content: body, author: context.reviewer },
        { id: 4, content: reviewCompletionBody({ ...completion, id: "later" }), author: context.reviewer },
        { id: 2, content: reviewCompletionBody(completion), author: context.reviewer },
        { id: 3, content: reviewCompletionBody({ ...completion, id: "other" }), author: { id: "other" } },
        { id: 5, content: reviewCompletionBody({ ...completion, id: "deleted" }), author: context.reviewer, isDeleted: true }
      ]
    }), { status: 200 }));
    const state = await new AdoApi({ fetch }).getAnnouncementState(context, 8, 1, body);
    expect(state.closed).toBe(true);
    expect(state.completions.map((entry) => entry.id)).toEqual(["review-1", "later"]);
  });

  it("refuses to complete another user's announcement even if its body or metadata match", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 8, status: "active", comments: [{ id: 1, content: body, author: { id: "someone-else" } }]
    }), { status: 200 }));
    await expect(new AdoApi({ fetch }).getAnnouncementState(context, 8, 1, body)).rejects.toThrow("could not be verified");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps correlation metadata from closing its HTML comment and ignores malformed metadata", () => {
    const content = reviewCompletionBody({ ...completion, id: "--><script>bad</script>" });
    expect(content).not.toContain("<script>");
    expect(readReviewCompletion(content, 2)?.id).toBe("--><script>bad</script>");
    expect(readReviewCompletion("Submitted 4 review comments at bad-time", 2)).toBeNull();
    expect(readReviewCompletion(content.replace('"version":1', '"version":2'), 2)).toBeNull();
  });
});
