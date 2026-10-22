import { describe, expect, it } from "vitest";
import { authoredEvents, contributionDays, mergeEvents, reviewEvents } from "../src/workspace/activity";
import { organizationContext, prKey, prSchema, prUrl, requestSchema } from "../src/workspace/protocol";

export const samplePr = () => prSchema.parse({
  pullRequestId: 1, title: "Fix routing", status: "active", creationDate: "2026-01-01T00:00:00Z",
  repository: { id: "repo", name: "Repo", project: { id: "project", name: "Project" } },
  createdBy: { id: "author", displayName: "Author" }, reviewers: [{ id: "reviewer", displayName: "Reviewer", vote: 0 }]
});

describe("workspace activity semantics", () => {
  it("uses actual comment and vote timestamps, retaining comment-only reviewers", () => {
    const pr = samplePr();
    const date = "2026-02-01T14:30:00Z";
    const events = reviewEvents(pr, [{
      id: 2, publishedDate: date,
      properties: { CodeReviewVotedByIdentity: { $value: "reviewer" }, CodeReviewVoteResult: { $value: 10 } },
      comments: [
        { id: 1, author: pr.reviewers[0]!, content: "Test the boundary", publishedDate: date, commentType: "text" },
        { id: 2, author: pr.reviewers[0]!, content: "Deleted", publishedDate: date, commentType: 1, isDeleted: true },
        { id: 3, author: pr.reviewers[0]!, content: "System", publishedDate: date, commentType: 3 }
      ]
    }]);
    expect(events.map((event) => event.kind)).toEqual(["commented", "voted"]);
    expect(events.every((event) => event.date === date)).toBe(true);
    expect(contributionDays(events, "reviewer")).toEqual([{ day: "2026-02-01", count: 2 }]);
    expect(contributionDays(authoredEvents([pr]), "reviewer")).toEqual([]);
  });

  it("does not invent vote events from the current vote or creation date", () => {
    const pr = samplePr();
    pr.reviewers[0]!.vote = 10;
    expect(reviewEvents(pr, [{ id: 1, comments: [], properties: { CodeReviewVoteResult: { $value: 10 } } }])).toEqual([]);
  });

  it("normalizes offset timestamps to UTC contribution days", () => {
    const pr = samplePr();
    pr.creationDate = "2026-02-01T23:30:00-05:00";
    expect(contributionDays(authoredEvents([pr]), "author")).toEqual([{ day: "2026-02-02", count: 1 }]);
    expect(mergeEvents(authoredEvents([pr]), "2026-02-02T00:00:00Z")).toHaveLength(1);
  });

  it("deduplicates by full PR/event identity and excludes other people and periods", () => {
    const pr = samplePr();
    const other = samplePr(); other.repository.project.id = "other-project";
    expect(prKey(pr)).not.toBe(prKey(other));
    const events = authoredEvents([pr, pr, other]);
    expect(mergeEvents(events, "2025-01-01", new Set(["author"]))).toHaveLength(2);
    expect(mergeEvents(events, "2026-02-01")).toEqual([]);
  });

  it("recognizes only HTTPS ADO hosts and encodes native PR links", () => {
    const modern = organizationContext(new URL("https://dev.azure.com/org/Project"));
    expect(modern?.base).toBe("https://dev.azure.com/org");
    expect(organizationContext(new URL("https://org.visualstudio.com/Project"))?.organization).toBe("org");
    expect(organizationContext(new URL("https://org.visualstudio.com.evil.test"))).toBeNull();
    expect(organizationContext(new URL("http://dev.azure.com/org"))).toBeNull();
    expect(prUrl(modern!, samplePr())).toBe("https://dev.azure.com/org/Project/_git/Repo/pullrequest/1");
  });

  it("rejects arbitrary fetches, SQL, and invalid query limits", () => {
    expect(requestSchema.safeParse({ id: "x", request: { type: "fetch", url: "https://evil.test" } }).success).toBe(false);
    expect(requestSchema.safeParse({ id: "x", request: { type: "sql", sql: "SELECT 1" } }).success).toBe(false);
    expect(requestSchema.safeParse({ id: "x", request: { type: "read", query: { kind: "prs", project: "p", status: "all", skip: -1, since: "invalid" } } }).success).toBe(false);
  });
});
