import { describe, expect, it, vi } from "vitest";
import { WorkspaceApi } from "../src/workspace/api";
import { currentProjectName } from "../src/workspace/protocol";

const context = { origin: "https://dev.azure.com", organization: "org", base: "https://dev.azure.com/org" };
const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { ...init, headers: { "Content-Type": "application/json", ...init.headers } });

describe("workspace read API", () => {
  it.each([
    ["https://dev.azure.com/org/Project%20name/_dashboards/dashboard/1", "Project name"],
    ["https://org.visualstudio.com/One/_git/repo", "One"],
    ["https://dev.azure.com/org/_projects", null],
    ["https://org.visualstudio.com/", null]
  ])("identifies the dashboard project from %s", (url, project) => {
    expect(currentProjectName(new URL(url))).toBe(project);
  });

  it("resolves the current project's canonical identity without listing projects or repositories", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ id: "p", name: "Project name" }));
    const result = await new WorkspaceApi({ fetch }, context).read({ kind: "project", project: "Project name" }, new AbortController().signal);
    expect(result).toEqual({ id: "p", name: "Project name" });
    expect(new URL(fetch.mock.calls[0]![0]).pathname).toBe("/org/_apis/projects/Project%20name");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses project-wide PR queries with explicit date semantics and paging", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ value: [] }));
    const api = new WorkspaceApi({ fetch }, context);
    const signal = new AbortController().signal;
    await api.read({ kind: "prs", project: "Project name", creator: "me", status: "completed", skip: 50, since: "2026-01-01T00:00:00Z", range: "closed" }, signal);
    const url = new URL(fetch.mock.calls[0]![0]);
    expect(url.pathname).toBe("/org/Project%20name/_apis/git/pullrequests");
    expect(url.searchParams.get("searchCriteria.queryTimeRangeType")).toBe("closed");
    expect(url.searchParams.get("$skip")).toBe("50");
    expect(url.searchParams.get("$top")).toBe("50");
    expect(fetch.mock.calls[0]![1].signal.aborted).toBe(false);
  });

  it("bounds profile queries by month across all repositories, with a larger explicit page size", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ value: [] }));
    await new WorkspaceApi({ fetch }, context).read({
      kind: "prs", project: "Project", reviewer: "me", status: "all", skip: 500, top: 500,
      since: "2025-01-01T00:00:00Z", until: "2025-01-31T23:59:59.999Z", range: "created"
    }, new AbortController().signal);
    const url = new URL(fetch.mock.calls[0]![0]);
    expect(url.pathname).toBe("/org/Project/_apis/git/pullrequests");
    expect(url.searchParams.get("searchCriteria.maxTime")).toBe("2025-01-31T23:59:59.999Z");
    expect(url.searchParams.get("searchCriteria.reviewerId")).toBe("me");
    expect(url.searchParams.get("$top")).toBe("500");
    expect(url.searchParams.get("$skip")).toBe("500");
  });

  it("returns and forwards project continuation tokens", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ value: [{ id: "p", name: "Project" }] }, { headers: { "x-ms-continuationtoken": "next+token" } }));
    const api = new WorkspaceApi({ fetch }, context);
    expect(await api.read({ kind: "projects", continuation: "prior+token" }, new AbortController().signal))
      .toEqual({ items: [{ id: "p", name: "Project" }], more: true, continuation: "next+token" });
    expect(new URL(fetch.mock.calls[0]![0]).searchParams.get("continuationToken")).toBe("prior+token");
  });

  it("keeps every thread and comment while bounding cached previews and retaining only used vote properties", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ value: [{
      id: 1, publishedDate: "2026-01-01T00:00:00Z",
      properties: { CodeReviewVotedByIdentity: { $value: "me" }, CodeReviewVoteResult: { $value: 10 }, unusedReport: "x".repeat(2_000_001) },
      comments: Array.from({ length: 3 }, (_, id) => ({
        id, author: { id: "me", displayName: "Me" }, content: "x".repeat(700_000), commentType: "text", publishedDate: "2026-01-01T00:00:00Z"
      }))
    }] }));
    const result = await new WorkspaceApi({ fetch }, context).read({
      kind: "threads", project: "Project", repository: "Repo", pr: 1
    }, new AbortController().signal);
    expect(result).toEqual([{
      id: 1, publishedDate: "2026-01-01T00:00:00Z",
      properties: { CodeReviewVotedByIdentity: { $value: "me" }, CodeReviewVoteResult: { $value: 10 } },
      comments: Array.from({ length: 3 }, (_, id) => ({
        id, author: { id: "me", displayName: "Me" }, content: "x".repeat(300), commentType: "text", publishedDate: "2026-01-01T00:00:00Z"
      }))
    }]);
  });

  it.each([401, 403, 500])("reports HTTP %s rather than empty data", async (status) => {
    const api = new WorkspaceApi({ fetch: vi.fn().mockResolvedValue(json({}, { status })) }, context);
    await expect(api.read({ kind: "projects" }, new AbortController().signal)).rejects.toThrow();
  });

  it("does not retry before a long Retry-After period has elapsed", async () => {
    const fetch = vi.fn().mockResolvedValue(json({}, { status: 429, headers: { "Retry-After": "60" } }));
    await expect(new WorkspaceApi({ fetch }, context).read({ kind: "projects" }, new AbortController().signal)).rejects.toThrow("throttling");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
