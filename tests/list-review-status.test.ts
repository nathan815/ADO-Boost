// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://dev.azure.com/org/project/_git/repo/pullrequests"}

import { afterEach, describe, expect, it, vi } from "vitest";
import { PullRequestListReviewStatus } from "../src/content/list-review-status";
import { recentPrUrl } from "../src/core/recent-prs";
import type { ReviewActivity } from "../src/core/review-activity";

let status: PullRequestListReviewStatus | undefined;
afterEach(() => {
  status?.stop();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("PR list review status", () => {
  it("highlights reviews, updates completion, handles recycled rows, and cleans up", async () => {
    document.body.innerHTML = '<a href="/org/project/_git/repo/pullrequest/42"><div class="bolt-table-two-line-cell"><div class="bolt-table-two-line-cell-item">PR title</div></div></a>';
    const entry: ReviewActivity = {
      organization: "org", project: "project", repository: "repo", repositoryId: "repo-id",
      pullRequestId: 42, title: "Title", viewedAt: 100, reviewStatus: "reviewing",
      url: recentPrUrl({ organization: "org", project: "project", repository: "repo", pullRequestId: 42 })
    };
    let changed!: () => void;
    const unsubscribe = vi.fn();
    status = new PullRequestListReviewStatus({
      list: async () => [entry],
      subscribe: (listener) => { changed = listener; return unsubscribe; }
    });
    status.start();
    const link = document.querySelector("a")!;
    await vi.waitFor(() => expect(link.dataset.adoppReviewStatus).toBe("reviewing"));
    expect(link.querySelector(".adopp-list-review-status")?.textContent).toBe("Reviewing");
    entry.reviewStatus = "reviewed";
    changed();
    await vi.waitFor(() => expect(link.dataset.adoppReviewStatus).toBe("reviewed"));
    expect(link.querySelectorAll(".adopp-list-review-status")).toHaveLength(1);
    expect(link.querySelector(".adopp-list-review-status")?.textContent).toBe("Review complete");
    link.querySelector(".bolt-table-two-line-cell-item")!.innerHTML = "Remounted title";
    await vi.waitFor(() => expect(link.querySelector(".adopp-list-review-status")?.textContent).toBe("Review complete"));
    link.href = "/org/project/_git/repo/pullrequest/43";
    await vi.waitFor(() => expect(link.hasAttribute("data-adopp-review-status")).toBe(false));
    expect(link.querySelector(".adopp-list-review-status")).toBeNull();
    link.href = "/org/project/_git/repo/pullrequest/42";
    await vi.waitFor(() => expect(link.dataset.adoppReviewStatus).toBe("reviewed"));
    status.stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-adopp-review-status], .adopp-list-review-status")).toBeNull();
  });

  it("reports storage failures", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    status = new PullRequestListReviewStatus({
      list: async () => { throw new Error("Storage unavailable"); },
      subscribe: () => () => undefined
    });
    status.start();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("ADO Boost could not load PR review status", expect.any(Error)));
  });
});
