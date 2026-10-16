import { describe, expect, it, vi } from "vitest";
import { AdoApi, type HttpClient } from "../src/adapters/ado-api";
import { MemoryBrowserStore } from "../src/adapters/browser";
import { PullRequestAnalyzer } from "../src/core/analyzer";
import { totalStats } from "../src/core/diff";

const route = {
  origin: "https://dev.azure.com",
  organization: "org",
  project: "project",
  repository: "repo",
  pullRequestId: 7
};

function createHttp(unresolvedChange: boolean): HttpClient {
  return {
    async fetch(input) {
      const url = new URL(String(input));
      let payload: unknown;
      if (url.pathname.endsWith("/items")) {
        return new Response(url.searchParams.get("versionDescriptor.version") === "source" ? "new\n" : "old\n");
      }
      if (url.pathname.endsWith("/changes")) {
        payload = {
          changeEntries: [
            { changeTrackingId: 1, changeType: "edit", item: { path: "/a.ts", objectId: "new" } },
            ...(unresolvedChange ? [{ changeTrackingId: 2, changeType: "edit", item: { path: null } }] : [])
          ]
        };
      } else if (url.pathname.endsWith("/iterations")) {
        payload = { value: [{ id: 3, sourceRefCommit: { commitId: "source" }, targetRefCommit: { commitId: "target" }, commonRefCommit: { commitId: "base" } }] };
      } else if (url.pathname.endsWith("/connectionData")) {
        payload = { authenticatedUser: { id: "me", displayName: null, providerDisplayName: "Me" } };
      } else if (url.pathname.endsWith("/threads")) {
        payload = { value: [] };
      } else if (url.pathname.endsWith("/pullRequests/7")) {
        payload = { pullRequestId: 7, title: null, repository: { id: "repo-id" }, createdBy: null };
      } else {
        throw new Error(`Unexpected request: ${url.pathname}`);
      }
      return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
    }
  };
}

describe("PullRequestAnalyzer response recovery", () => {
  it("preserves PR metadata but does not fetch or guess file counts when the whitespace setting is unavailable", async () => {
    const http = createHttp(false);
    const fetched = vi.fn((input: RequestInfo | URL, init?: RequestInit) => http.fetch(input, init));
    const logger = { warn: vi.fn() };
    const result = await new PullRequestAnalyzer(new AdoApi({ fetch: fetched }), new MemoryBrowserStore(), logger)
      .analyze(route, undefined, null);
    expect(result.files[0]).toMatchObject({
      path: "/a.ts", additions: null, deletions: null, state: "unavailable", detail: "ADO whitespace setting unavailable"
    });
    expect(result.threads.state).toBe("available");
    expect(fetched.mock.calls.some(([input]) => new URL(String(input)).pathname.endsWith("/items"))).toBe(false);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("applies the selected whitespace policy to fetched file contents", async () => {
    const http = createHttp(false);
    const api = new AdoApi({
      fetch(input, init) {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/items")) {
          return Promise.resolve(new Response(url.searchParams.get("versionDescriptor.version") === "source" ? "alpha\nbeta \n" : "alpha\n  beta\n"));
        }
        return http.fetch(input, init);
      }
    });
    const analyzer = new PullRequestAnalyzer(api, new MemoryBrowserStore());
    const ignored = await analyzer.analyze(route, undefined, true);
    const strict = await analyzer.analyze(route, undefined, false);
    expect(ignored.files[0]).toMatchObject({ additions: 0, deletions: 0, state: "exact" });
    expect(strict.files[0]).toMatchObject({ additions: 1, deletions: 1, state: "exact" });
  });

  it("analyzes all 422 files across API pages without depending on rendered DOM rows", async () => {
    const http = createHttp(false);
    const changes = Array.from({ length: 422 }, (_, index) => ({
      changeTrackingId: index + 1, changeType: "edit", item: { path: `/src/file-${index}.ts`, objectId: `object-${index}` }
    }));
    const pages: number[] = [];
    const fileVersions = new Map<string, Set<string>>();
    const warn = vi.fn();
    const api = new AdoApi({
      fetch(input, init) {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/changes")) {
          const skip = Number(url.searchParams.get("$skip"));
          pages.push(skip);
          const next = skip + 200;
          return Promise.resolve(new Response(JSON.stringify({
            changeEntries: changes.slice(skip, next),
            nextSkip: next < changes.length ? next : 0,
            nextTop: next < changes.length ? 200 : 0
          })));
        }
        if (url.pathname.endsWith("/items")) {
          const path = url.searchParams.get("path")!;
          const versions = fileVersions.get(path) ?? new Set<string>();
          versions.add(url.searchParams.get("versionDescriptor.version")!);
          fileVersions.set(path, versions);
        }
        return http.fetch(input, init);
      }
    }, warn);
    const result = await new PullRequestAnalyzer(api, new MemoryBrowserStore(), { warn }).analyze(route);
    expect(pages).toEqual([0, 200, 400]);
    expect(result.files).toHaveLength(422);
    expect(result.files.map((file) => file.path)).toEqual(changes.map((change) => change.item.path));
    expect(fileVersions.size).toBe(422);
    for (const versions of fileVersions.values()) expect(versions).toEqual(new Set(["base", "source"]));
    expect(result.files.every((file) => file.state === "exact")).toBe(true);
    expect(result.unresolvedChanges).toEqual([]);
    expect(totalStats(result.files)).toEqual({ additions: 422, deletions: 422, exact: true, incomplete: 0 });
    expect(warn).not.toHaveBeenCalled();
  });

  it("calculates a deleted-file diff from originalPath when item.path is null", async () => {
    const http = createHttp(false);
    const fileRequests: URL[] = [];
    const warn = vi.fn();
    const api = new AdoApi({
      fetch(input, init) {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/changes")) {
          return Promise.resolve(new Response(JSON.stringify({
            changeEntries: [{ changeTrackingId: 2, changeType: "delete", originalPath: "/old.ts", item: { path: null } }]
          })));
        }
        if (url.pathname.endsWith("/items")) fileRequests.push(url);
        return http.fetch(input, init);
      }
    }, warn);
    const analysis = await new PullRequestAnalyzer(api, new MemoryBrowserStore(), { warn }).analyze(route);
    expect(analysis.files).toMatchObject([{ path: "/old.ts", changeType: "delete", state: "exact", additions: 0, deletions: 1 }]);
    expect(analysis.unresolvedChanges).toEqual([]);
    expect(fileRequests).toHaveLength(1);
    expect(fileRequests[0]?.searchParams.get("path")).toBe("/old.ts");
    expect(fileRequests[0]?.searchParams.get("versionDescriptor.version")).toBe("base");
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([true, false])("analyzes valid files and retains unresolved records and saved progress: %s", async (unresolvedChange) => {
    const store = new MemoryBrowserStore();
    const records = [
      { trackingId: 1, objectId: "new", reviewedAt: "now" },
      { trackingId: 2, objectId: "unavailable", reviewedAt: "now" }
    ];
    await store.saveReviewRecords("org/project/repo-id/7", records);
    const warn = vi.fn();
    const logger = { warn: vi.fn() };
    const analyzer = new PullRequestAnalyzer(new AdoApi(createHttp(unresolvedChange), warn), store, logger);
    const analysis = await analyzer.analyze(route);
    expect(analysis.files).toMatchObject([{ path: "/a.ts", state: "exact", additions: 1, deletions: 1 }]);
    expect(analysis.context.reviewer.displayName).toBe("Me");
    expect(analysis.unresolvedChanges).toHaveLength(unresolvedChange ? 1 : 0);
    if (unresolvedChange) expect(analysis.unresolvedChanges?.[0]?.raw).toEqual({ changeTrackingId: 2, changeType: "edit", item: { path: null } });
    expect(totalStats(analysis.files, analysis.unresolvedChanges?.length).exact).toBe(!unresolvedChange);
    expect(analysis.completedTrackingIds).toEqual(new Set([1]));
    expect(await store.getReviewRecords(analyzer.reviewKey(analysis.context))).toEqual(unresolvedChange ? records : [records[0]]);
    expect(warn).toHaveBeenCalledTimes(unresolvedChange ? 1 : 0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    { commit: "source", side: "source", status: 403 },
    { commit: "base", side: "base", status: 404 }
  ])("logs $side fetch failures with file, commit, PR, and original error", async ({ commit, side, status }) => {
    const http = createHttp(false);
    const logger = { warn: vi.fn() };
    const api = new AdoApi({
      fetch(input, init) {
        const url = new URL(String(input));
        return url.pathname.endsWith("/items") && url.searchParams.get("versionDescriptor.version") === commit
          ? Promise.resolve(new Response("unavailable", { status }))
          : http.fetch(input, init);
      }
    });
    const analysis = await new PullRequestAnalyzer(api, new MemoryBrowserStore(), logger).analyze(route);
    expect(analysis.files).toHaveLength(1);
    if (side === "source") expect(analysis.files[0]?.state).toBe("partial");
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      "ADO Boost could not fetch file content for diff analysis",
      { repositoryId: "repo-id", pullRequestId: 7, path: "/a.ts", commit, side },
      expect.objectContaining({ message: `File fetch failed (${status})` })
    );
  });

  it("propagates cancellation without logging an expected navigation abort", async () => {
    const http = createHttp(false);
    const controller = new AbortController();
    const error = new DOMException("Navigation cancelled", "AbortError");
    const logger = { warn: vi.fn() };
    const api = new AdoApi({
      async fetch(input, init) {
        if (new URL(String(input)).pathname.endsWith("/items")) {
          controller.abort();
          throw error;
        }
        return http.fetch(input, init);
      }
    });
    const analyzer = new PullRequestAnalyzer(api, new MemoryBrowserStore(), logger);
    await expect(analyzer.analyze(route, controller.signal)).rejects.toBe(error);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
