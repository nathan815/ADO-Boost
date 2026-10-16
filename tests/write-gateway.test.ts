import { afterEach, describe, expect, it, vi } from "vitest";
import type { PullRequestContext } from "../src/core/types";
import { RuntimeWriteGateway } from "../src/core/write-gateway";

const context: PullRequestContext = {
  origin: "https://dev.azure.com", organization: "org", project: "project", repository: "repo",
  repositoryId: "repo-id", pullRequestId: 7, title: "PR", sourceCommit: "source", targetCommit: "target",
  mergeBaseCommit: "base", iterationId: 3, identity: "identity", reviewer: { id: "me", displayName: "Me" }
};

afterEach(() => vi.unstubAllGlobals());

describe("Review write gateway", () => {
  function fixture() {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: null });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    return { gateway: new RuntimeWriteGateway(), sendMessage };
  }

  it("distinguishes immediate Post from confirmed Submit Review", async () => {
    const { gateway, sendMessage } = fixture();
    await gateway.submitReview(context, ["reply"], "comment");
    await gateway.submitReview(context, ["review"], "approve", true);
    expect(sendMessage.mock.calls.map((call) => call[0].payload)).toEqual([
      { route: context, draftIds: ["reply"], decision: "comment", finishAnnouncement: false, expectedIdentity: context.identity },
      { route: context, draftIds: ["review"], decision: "approve", finishAnnouncement: true, expectedIdentity: context.identity }
    ]);
  });

  it("checks server votes by default and preserves submission correlation for retries", async () => {
    const { gateway, sendMessage } = fixture();
    await gateway.finishReview(context);
    const trigger = { kind: "submission", submissionId: "receipt-1", commentCount: 3 } as const;
    await gateway.finishReview(context, trigger);
    expect(sendMessage.mock.calls.map((call) => call[0])).toEqual([
      { channel: "adopp-write", kind: "finish-review", payload: { route: context, trigger: { kind: "vote" } } },
      { channel: "adopp-write", kind: "finish-review", payload: { route: context, trigger } }
    ]);
  });

  it("surfaces background completion errors instead of reporting success", async () => {
    const { gateway, sendMessage } = fixture();
    sendMessage.mockResolvedValue({ ok: false, error: "Could not close announcement" });
    await expect(gateway.finishReview(context)).rejects.toThrow("Could not close announcement");
  });
});
