import { describe, expect, it, vi } from "vitest";
import { AdoApi } from "../src/adapters/ado-api";
import { MemoryBrowserStore } from "../src/adapters/browser";
import { DraftQueue } from "../src/core/drafts";
import { DECISION_VOTES, SubmissionCoordinator } from "../src/core/submission";
import type { PullRequestContext, SubmissionReceipt } from "../src/core/types";

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
  identity: "comparison",
  reviewer: { id: "me", displayName: "Me" }
};

describe("SubmissionCoordinator", () => {
  it("retains unresolved changes but does not use them to authorize an inline write", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      changeEntries: [{ changeTrackingId: 1, changeType: "rename", originalPath: {}, item: { path: "/a.ts" } }]
    })));
    const api = new AdoApi({ fetch }, vi.fn());
    const store = new MemoryBrowserStore();
    const queue = new DraftQueue(store, context);
    const draft = await queue.add({ kind: "inline", body: "Feedback", path: "/a.ts", trackingId: 1, line: 1, side: "right" });
    await expect(new SubmissionCoordinator(api, store, queue, context).submit([draft.id], "approve")).rejects.toThrow("must be reanchored");
    expect(fetch).toHaveBeenCalledOnce();
    expect((await queue.list())[0]?.delivery).toBe("pending");
  });

  describe("Submission announcement completion", () => {
    async function fixture() {
      const api = new AdoApi({ fetch: vi.fn() });
      vi.spyOn(api, "getChanges").mockResolvedValue([]);
      vi.spyOn(api, "getCurrentVote").mockResolvedValue(0);
      vi.spyOn(api, "findDraftDelivery").mockResolvedValue(null);
      const post = vi.spyOn(api, "postDraft").mockResolvedValue({ threadId: 1, commentId: 1 });
      const vote = vi.spyOn(api, "setVote").mockResolvedValue(undefined);
      const finish = vi.fn<(receipt: SubmissionReceipt) => Promise<void>>().mockResolvedValue(undefined);
      const store = new MemoryBrowserStore();
      const queue = new DraftQueue(store, context);
      const first = await queue.add({ kind: "general", body: "First" });
      const second = await queue.add({ kind: "general", body: "Second" });
      const coordinator = new SubmissionCoordinator(api, store, queue, context, undefined, finish);
      return { api, store, queue, post, vote, finish, first, second, coordinator };
    }

    it("finishes only after all selected comments and the requested vote succeed", async () => {
      const { coordinator, first, second, finish, post, vote } = await fixture();
      const result = await coordinator.submit([first.id, second.id], "approve");
      expect(finish).toHaveBeenCalledExactlyOnceWith(result.receipt);
      expect(result.receipt.postedDraftIds).toEqual([first.id, second.id]);
      expect(post.mock.invocationCallOrder[1]).toBeLessThan(vote.mock.invocationCallOrder[0]!);
      expect(vote.mock.invocationCallOrder[0]).toBeLessThan(finish.mock.invocationCallOrder[0]!);
    });

    it("passes only successfully posted selected comments to a comment-only completion", async () => {
      const { coordinator, first, second, finish, vote, queue } = await fixture();
      const result = await coordinator.submit([first.id], "comment");
      expect(finish).toHaveBeenCalledExactlyOnceWith(result.receipt);
      expect(result.receipt).toMatchObject({ decision: "comment", postedDraftIds: [first.id] });
      expect((await queue.list()).find((draft) => draft.id === second.id)?.delivery).toBe("pending");
      expect(vote).not.toHaveBeenCalled();
    });

    it("does not announce completion when comment delivery fails", async () => {
      const { coordinator, first, second, finish, post, vote } = await fixture();
      post.mockRejectedValueOnce(new Error("Posting failed"));
      const result = await coordinator.submit([first.id, second.id], "reject");
      expect(result.receipt.failedDraftIds).toEqual([first.id]);
      expect(finish).not.toHaveBeenCalled();
      expect(vote).not.toHaveBeenCalled();
    });

    it("finishes after a successful decision-only retry without replaying comments", async () => {
      const { coordinator, first, finish, post, vote } = await fixture();
      vote.mockRejectedValueOnce(new Error("Vote failed"));
      const result = await coordinator.submit([first.id], "wait-author");
      expect(finish).not.toHaveBeenCalled();
      const retried = await coordinator.retryVote(result.receipt);
      expect(finish).toHaveBeenCalledExactlyOnceWith(retried);
      expect(retried.voteApplied).toBe(true);
      expect(post).toHaveBeenCalledOnce();
    });

    it("records announcement failures separately from successful comment and vote delivery", async () => {
      const { coordinator, first, finish, queue, store } = await fixture();
      finish.mockRejectedValueOnce(new Error("Announcement close failed"));
      const result = await coordinator.submit([first.id], "approve");
      expect(result.receipt).toMatchObject({
        voteApplied: true, postedDraftIds: [first.id], failedDraftIds: [], announcementError: "Announcement close failed"
      });
      expect(result.receipt.completedAt).toBeDefined();
      expect(await store.getReceipts(queue.key())).toEqual([result.receipt]);
      expect((await queue.list())[0]?.delivery).toBe("posted");
    });
  });

  it("posts feedback before applying the vote", async () => {
    const calls: string[] = [];
    const api = {
      getChanges: async () => [],
      getCurrentVote: async () => 0,
      postDraft: async () => { calls.push("comment"); return { threadId: 1, commentId: 1 }; },
      findDraftDelivery: async () => null,
      setVote: async (_context: PullRequestContext, vote: number) => { calls.push(`vote:${vote}`); }
    } as unknown as AdoApi;
    const store = new MemoryBrowserStore();
    const queue = new DraftQueue(store, context);
    const draft = await queue.add({ kind: "general", body: "Looks good" });
    const result = await new SubmissionCoordinator(api, store, queue, context).submit([draft.id], "approve");
    expect(calls).toEqual(["comment", `vote:${DECISION_VOTES.approve}`]);
    expect(result.receipt.voteApplied).toBe(true);
  });

  it("stops on a mid-batch failure and does not vote", async () => {
    let posts = 0;
    let votes = 0;
    const api = {
      getChanges: async () => [],
      getCurrentVote: async () => 5,
      postDraft: async () => {
        posts += 1;
        if (posts === 2) throw new Error("permission denied");
        return { threadId: posts, commentId: 1 };
      },
      findDraftDelivery: async () => null,
      setVote: async () => { votes += 1; }
    } as unknown as AdoApi;
    const store = new MemoryBrowserStore();
    const queue = new DraftQueue(store, context);
    const first = await queue.add({ kind: "general", body: "First" });
    const second = await queue.add({ kind: "general", body: "Second" });
    const result = await new SubmissionCoordinator(api, store, queue, context).submit([first.id, second.id], "reject");
    expect(result.receipt.postedDraftIds).toEqual([first.id]);
    expect(result.receipt.failedDraftIds).toEqual([second.id]);
    expect(votes).toBe(0);
  });

  it("preserves the current vote for comment-only submissions", async () => {
    let votes = 0;
    const api = {
      getChanges: async () => [],
      getCurrentVote: async () => 10,
      postDraft: async () => ({ threadId: 1, commentId: 1 }),
      findDraftDelivery: async () => null,
      setVote: async () => { votes += 1; }
    } as unknown as AdoApi;
    const store = new MemoryBrowserStore();
    const queue = new DraftQueue(store, context);
    const draft = await queue.add({ kind: "general", body: "Comment" });
    const result = await new SubmissionCoordinator(api, store, queue, context).submit([draft.id], "comment");
    expect(result.receipt.existingVote).toBe(10);
    expect(votes).toBe(0);
  });

  it("offers a decision-only retry after feedback succeeds", async () => {
    let attempts = 0;
    const api = {
      getChanges: async () => [],
      getCurrentVote: async () => 0,
      postDraft: async () => ({ threadId: 1, commentId: 1 }),
      findDraftDelivery: async () => null,
      setVote: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("vote failed");
      }
    } as unknown as AdoApi;
    const store = new MemoryBrowserStore();
    const queue = new DraftQueue(store, context);
    const draft = await queue.add({ kind: "general", body: "Feedback" });
    const coordinator = new SubmissionCoordinator(api, store, queue, context);
    const result = await coordinator.submit([draft.id], "wait-author");
    expect(result.receipt.voteError).toBe("vote failed");
    const retried = await coordinator.retryVote(result.receipt);
    expect(retried.voteApplied).toBe(true);
    expect(attempts).toBe(2);
  });

  it("reconciles an unknown network outcome before declaring failure", async () => {
    const api = {
      getChanges: async () => [],
      getCurrentVote: async () => 0,
      postDraft: async () => { throw new TypeError("network lost"); },
      findDraftDelivery: async () => ({ threadId: 9, commentId: 2 }),
      setVote: async () => undefined
    } as unknown as AdoApi;
    const store = new MemoryBrowserStore();
    const queue = new DraftQueue(store, context);
    const draft = await queue.add({ kind: "general", body: "Feedback" });
    const result = await new SubmissionCoordinator(api, store, queue, context).submit([draft.id], "comment");
    expect(result.receipt.postedDraftIds).toEqual([draft.id]);
    expect(result.receipt.failedDraftIds).toEqual([]);
  });

  it("refuses a submission when the preview references a missing draft", async () => {
    const api = { getChanges: async () => [] } as unknown as AdoApi;
    const store = new MemoryBrowserStore();
    const queue = new DraftQueue(store, context);
    await expect(new SubmissionCoordinator(api, store, queue, context).submit(["missing"], "approve")).rejects.toThrow("queue changed");
  });

  it.each(["posted", "ambiguous"] as const)("refuses to replay a %s comment before any API calls", async (delivery) => {
    const getChanges = vi.fn();
    const api = { getChanges } as unknown as AdoApi;
    const store = new MemoryBrowserStore();
    const queue = new DraftQueue(store, context);
    const draft = await queue.add({ kind: "reply", threadId: 1, body: "Do not duplicate" });
    await queue.replace([{ ...draft, delivery }]);
    await expect(new SubmissionCoordinator(api, store, queue, context).submit([draft.id], "comment")).rejects.toThrow("already");
    expect(getChanges).not.toHaveBeenCalled();
    expect((await queue.list())[0]?.delivery).toBe(delivery);
  });

  it("stops before the next write when the feature is disabled during submission", async () => {
    let checks = 0;
    let posts = 0;
    const api = {
      getChanges: async () => [],
      getCurrentVote: async () => 0,
      postDraft: async () => { posts += 1; return { threadId: posts, commentId: 1 }; },
      findDraftDelivery: async () => null,
      setVote: async () => undefined
    } as unknown as AdoApi;
    const store = new MemoryBrowserStore();
    const queue = new DraftQueue(store, context);
    const first = await queue.add({ kind: "general", body: "First" });
    const second = await queue.add({ kind: "general", body: "Second" });
    const preflight = async () => {
      checks += 1;
      if (checks >= 3) throw new Error("Feature is disabled");
    };
    await expect(new SubmissionCoordinator(api, store, queue, context, preflight).submit([first.id, second.id], "approve")).rejects.toThrow("disabled");
    expect(posts).toBe(1);
    expect((await queue.list()).find((draft) => draft.id === first.id)?.delivery).toBe("posted");
    expect((await queue.list()).find((draft) => draft.id === second.id)?.delivery).toBe("pending");
  });
});
