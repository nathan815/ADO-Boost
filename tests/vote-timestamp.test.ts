import { describe, expect, it, vi } from "vitest";
import { AdoApi } from "../src/adapters/ado-api";
import type { PullRequestContext } from "../src/core/types";

const context: PullRequestContext = {
  origin: "https://dev.azure.com", organization: "org", project: "project", repository: "repo",
  repositoryId: "repo-id", pullRequestId: 7, title: "PR", sourceCommit: "source", targetCommit: "target",
  mergeBaseCommit: "base", iterationId: 3, identity: "identity", reviewer: { id: "me", displayName: "Me" }
};
const at = "2026-10-15T22:02:03.456Z";

function voteEvent(id: number, vote: number, publishedDate = at, reviewer = "me") {
  return {
    id, publishedDate, lastUpdatedDate: "2026-10-16T04:00:00Z",
    properties: {
      CodeReviewThreadType: { $type: "System.String", $value: "VoteUpdate" },
      CodeReviewVoteResult: { $type: "System.String", $value: String(vote) },
      CodeReviewVotedByIdentity: { $type: "System.String", $value: "1" },
      CodeReviewVotedByInitiatorIdentity: { $type: "System.String", $value: "2" }
    },
    identities: { "1": { id: reviewer }, "2": { id: "someone-else" } },
    comments: [{ id: 1, commentType: "system", author: { id: "someone-else" }, publishedDate }]
  };
}

function fixture(threads: unknown[]) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ value: threads }), { status: 200 }));
  const warn = vi.fn();
  return { api: new AdoApi({ fetch }, warn), fetch, warn };
}

describe("Server vote timestamps", () => {
  it.each([10, 5, -5, -10] as const)("uses the actual event publication time for vote %s", async (vote) => {
    const { api, fetch } = fixture([voteEvent(1, vote)]);
    expect(await api.getVoteTimestamp(context, vote)).toBe(at);
    expect(fetch.mock.calls[0]![0]).toContain("/pullRequests/7/threads?");
    expect(fetch.mock.calls[0]![1].method).toBeUndefined();
  });

  it("resolves the voter from event identities instead of the author, initiator, display name, or other reviewers", async () => {
    const { api } = fixture([voteEvent(1, 10), voteEvent(2, 10, "2026-10-16T02:00:00Z", "someone-else")]);
    expect(await api.getVoteTimestamp(context, 10)).toBe(at);
  });

  it("uses the latest vote event even if API results are out of order or an earlier event has the same vote", async () => {
    const latest = "2026-10-16T02:30:00Z";
    const { api } = fixture([voteEvent(3, 10, latest), voteEvent(1, 10), voteEvent(2, -5)]);
    expect(await api.getVoteTimestamp(context, 10)).toBe(latest);
  });

  it("does not match ordinary text comments that mention a vote", async () => {
    const { api } = fixture([{ id: 10, publishedDate: at, comments: [{ id: 1, content: "Me voted 10", author: context.reviewer }] }]);
    await expect(api.getVoteTimestamp(context, 10)).rejects.toThrow("timestamp for your current vote");
  });

  it("does not reuse an old timestamp when the latest vote event does not match the current vote", async () => {
    const { api } = fixture([voteEvent(1, 10), voteEvent(2, -5)]);
    await expect(api.getVoteTimestamp(context, 10)).rejects.toThrow("timestamp for your current vote");
  });

  it("does not reuse a vote timestamp after a later reset to no vote", async () => {
    const { api } = fixture([voteEvent(1, 10), voteEvent(2, 0)]);
    await expect(api.getVoteTimestamp(context, 10)).rejects.toThrow("timestamp for your current vote");
  });

  it.each([undefined, "not-a-time"])("refuses to substitute the clock or an earlier event for a missing/invalid timestamp", async (publishedDate) => {
    const latest = { ...voteEvent(2, 10), publishedDate };
    const { api } = fixture([voteEvent(1, 10), latest]);
    await expect(api.getVoteTimestamp(context, 10)).rejects.toThrow("timestamp for your current vote");
  });

  it("requires authoritative voter identity metadata", async () => {
    const { api } = fixture([{ ...voteEvent(1, 10), identities: {} }]);
    await expect(api.getVoteTimestamp(context, 10)).rejects.toThrow("did not identify the reviewer");
  });

  it("propagates API failures instead of inventing a current timestamp", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 }));
    await expect(new AdoApi({ fetch }).getVoteTimestamp(context, 10)).rejects.toThrow("API failed (503)");
  });
});
