import { describe, expect, it } from "vitest";
import { reviewActivity, reviewStatusFor } from "../src/core/review-activity";
import { recentPrUrl, type RecentPr } from "../src/core/recent-prs";
import type { AnnouncementRecord } from "../src/core/types";

const pr: RecentPr = {
  organization: "org", project: "project", repository: "repo", repositoryId: "repo-id",
  pullRequestId: 42, title: "A PR", viewedAt: 100,
  url: recentPrUrl({ organization: "org", project: "project", repository: "repo", pullRequestId: 42 })
};
const record: AnnouncementRecord = {
  key: "https://dev.azure.com/repo-id/42/reviewer", status: "posted", body: "Review started",
  pullRequest: pr
};

describe("review activity", () => {
  it("tracks posted announcements independently of recent history", () => {
    expect(reviewActivity([record], [])).toEqual([{ ...pr, reviewStatus: "reviewing" }]);
    expect(reviewActivity([{ ...record, status: "posting" }, { ...record, status: "ambiguous" }], [pr])).toEqual([]);
  });

  it.each(["posting", "posted", "ambiguous", "closed"] as const)("only marks closed completions as reviewed (%s)", (status) => {
    const updated: AnnouncementRecord = {
      ...record, completions: [{ id: "completion", kind: "vote", vote: 10, at: "2026-10-20T12:00:00Z", status }]
    };
    expect(reviewActivity([updated], [pr])[0]?.reviewStatus).toBe(status === "closed" ? "reviewed" : "reviewing");
  });

  it("joins legacy announcements with history and preserves author and renamed metadata", () => {
    const legacy = { ...record };
    delete legacy.pullRequest;
    const recent = { ...pr, author: "Author", title: "Updated title" };
    expect(reviewActivity([legacy], [recent])).toEqual([{ ...recent, reviewStatus: "reviewing" }]);
    expect(reviewActivity([{ ...legacy, key: "https://ORG.visualstudio.com/repo-id/42/reviewer" }], [recent])).toHaveLength(1);
    expect(reviewActivity([{ ...legacy, key: "https://other.visualstudio.com/repo-id/42/reviewer" }], [recent])).toEqual([]);
  });

  it("matches both host formats without confusing different organizations or repositories", () => {
    const entries = reviewActivity([record], []);
    const route = { ...pr, origin: "https://org.visualstudio.com" };
    expect(reviewStatusFor(route, entries)).toBe("reviewing");
    expect(reviewStatusFor({ ...route, organization: "other" }, entries)).toBeUndefined();
    expect(reviewStatusFor({ ...route, repository: "other" }, entries)).toBeUndefined();
    expect(reviewStatusFor({ ...route, pullRequestId: 43 }, entries)).toBeUndefined();
  });

  it("deduplicates shared reviewers while retaining an ongoing review", () => {
    const closed: AnnouncementRecord = {
      ...record, key: record.key + "2",
      completions: [{ id: "done", kind: "submission", commentCount: 1, at: "2026-10-20T12:00:00Z", status: "closed" }]
    };
    expect(reviewActivity([closed, record], [])).toEqual([{ ...pr, reviewStatus: "reviewing" }]);
    expect(reviewActivity([record, closed], [])).toEqual([{ ...pr, reviewStatus: "reviewing" }]);
  });
});
