// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://dev.azure.com/org/project/_git/repo/pullrequests?_a=mine"}

import { afterEach, describe, expect, it, vi } from "vitest";
import { PullRequestListBadges } from "../src/content/list-badges";
import type { PullRequestListStat, PullRequestListStatService } from "../src/core/list-stats";
import type { PrRoute, PullRequestAnalysis } from "../src/core/types";

let badges: PullRequestListBadges | null = null;

describe("PullRequestListBadges", () => {
  afterEach(() => {
    badges?.stop();
    badges = null;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders independent stats for PR links that share the same parent", async () => {
    document.body.innerHTML = `
      <div class="relative">
        <a href="/org/project/_git/repo/pullrequest/101">
          <div class="bolt-table-two-line-cell"><div class="bolt-table-two-line-cell-item"><div>First PR</div></div></div>
        </a>
        <a href="/org/project/_git/repo/pullrequest/202">
          <div class="bolt-table-two-line-cell"><div class="bolt-table-two-line-cell-item"><div>Second PR</div></div></div>
        </a>
      </div>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 100,
      height: 20,
      top: 0,
      right: 100,
      bottom: 20,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });
    const stats = createStats((route) => Promise.resolve(analysisFor(route)));

    badges = new PullRequestListBadges(stats.service);
    badges.start();

    await vi.waitFor(() => expect(document.querySelectorAll(".adopp-list-badge")).toHaveLength(2));
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a")];
    const firstBadge = links[0]?.querySelector<HTMLElement>(".adopp-list-badge");
    const secondBadge = links[1]?.querySelector<HTMLElement>(".adopp-list-badge");
    expect(firstBadge?.parentElement).toBe(links[0]?.querySelector(".bolt-table-two-line-cell-item"));
    expect(secondBadge?.parentElement).toBe(links[1]?.querySelector(".bolt-table-two-line-cell-item"));
    expect(firstBadge?.textContent).toBe("+101−1");
    expect(secondBadge?.textContent).toBe("+202−2");
    expect(firstBadge?.querySelector(".adopp-list-badge-additions")?.textContent).toBe("+101");
    expect(firstBadge?.querySelector(".adopp-list-badge-deletions")?.textContent).toBe("−1");
    expect(document.getElementById("adopp-list-badge-styles")?.textContent).toContain("140ms ease-out");
    expect(stats.resolve).toHaveBeenCalledTimes(2);
  });

  it("replaces stale stats when a virtualized row is recycled for another PR", async () => {
    document.body.innerHTML = `
      <div class="relative">
        <a href="/org/project/_git/repo/pullrequest/101">
          <div class="bolt-table-two-line-cell"><div class="bolt-table-two-line-cell-item"><div>First PR</div></div></div>
        </a>
      </div>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 100,
      height: 20,
      top: 0,
      right: 100,
      bottom: 20,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });
    let resolveFirst!: (analysis: PullRequestAnalysis) => void;
    const firstAnalysis = new Promise<PullRequestAnalysis>((resolve) => {
      resolveFirst = resolve;
    });
    const stats = createStats((route) => route.pullRequestId === 101
        ? firstAnalysis
        : Promise.resolve(analysisFor(route)));

    badges = new PullRequestListBadges(stats.service);
    badges.start();
    const link = document.querySelector<HTMLAnchorElement>("a")!;
    await vi.waitFor(() => expect(link.querySelector(".adopp-list-badge")?.textContent).toBe("…"));

    link.href = "/org/project/_git/repo/pullrequest/202";
    await vi.waitFor(() => expect(link.querySelector(".adopp-list-badge")?.textContent).toBe("+202−2"));
    expect(link.querySelectorAll(".adopp-list-badge")).toHaveLength(1);

    resolveFirst(analysisFor({
      origin: "https://dev.azure.com",
      organization: "org",
      project: "project",
      repository: "repo",
      pullRequestId: 101
    }));
    await Promise.resolve();
    expect(link.querySelector(".adopp-list-badge")?.textContent).toBe("+202−2");
    expect(stats.resolve).toHaveBeenCalledTimes(2);
  });

  it("reattaches cached stats after ADO replaces a virtualized title line", async () => {
    document.body.innerHTML = `
      <div class="relative">
        <a href="/org/project/_git/repo/pullrequest/101">
          <div class="bolt-table-two-line-cell"><div class="bolt-table-two-line-cell-item"><div>First PR</div></div></div>
        </a>
      </div>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 100,
      height: 20,
      top: 0,
      right: 100,
      bottom: 20,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });
    const stats = createStats((route) => Promise.resolve(analysisFor(route)));

    badges = new PullRequestListBadges(stats.service);
    badges.start();
    const link = document.querySelector<HTMLAnchorElement>("a")!;
    await vi.waitFor(() => expect(link.querySelector(".adopp-list-badge")?.textContent).toBe("+101−1"));

    link.querySelector(".bolt-table-two-line-cell-item")?.replaceWith(
      createTitleLine("First PR remounted")
    );

    await vi.waitFor(() => expect(link.querySelector(".adopp-list-badge")?.textContent).toBe("+101−1"));
    expect(link.querySelectorAll(".adopp-list-badge")).toHaveLength(1);
    expect(link.querySelector<HTMLElement>(".adopp-list-badge")?.title).toContain("cached");
    expect(stats.resolve).toHaveBeenCalledTimes(1);
  });

  it("preloads stats for rows within one viewport below the visible area", async () => {
    document.body.innerHTML = `
      <a href="/org/project/_git/repo/pullrequest/101">
        <div class="bolt-table-two-line-cell"><div class="bolt-table-two-line-cell-item"><div>Next panel PR</div></div></div>
      </a>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 100,
      height: 20,
      top: innerHeight + 100,
      right: 100,
      bottom: innerHeight + 120,
      left: 0,
      x: 0,
      y: innerHeight + 100,
      toJSON: () => ({})
    });
    const stats = createStats((route) => Promise.resolve(analysisFor(route)));

    badges = new PullRequestListBadges(stats.service);
    badges.start();

    await vi.waitFor(() => expect(document.querySelector(".adopp-list-badge")?.textContent).toBe("+101−1"));
  });
});

function createStats(analyze: (route: PrRoute) => Promise<PullRequestAnalysis>): {
  service: PullRequestListStatService;
  resolve: ReturnType<typeof vi.fn>;
} {
  const cache = new Map<string, PullRequestListStat>();
  const key = (route: PrRoute) => `${route.origin}/${route.organization}/${route.project}/${route.repository}/${route.pullRequestId}`;
  const resolve = vi.fn(async (route: PrRoute) => {
    const analysis = await analyze(route);
    const file = analysis.files[0]!;
    const stat: PullRequestListStat = {
      version: 1,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      exact: file.state === "exact",
      fileCount: analysis.files.length,
      iterationId: analysis.context.iterationId,
      sourceCommit: analysis.context.sourceCommit,
      targetCommit: analysis.context.targetCommit,
      mergeBaseCommit: analysis.context.mergeBaseCommit,
      calculatedAt: new Date().toISOString(),
      validatedAt: new Date().toISOString()
    };
    cache.set(key(route), stat);
    return { stat, freshness: "recalculated" as const };
  });
  return {
    resolve,
    service: {
      prune: vi.fn().mockResolvedValue(undefined),
      peek: (route: PrRoute) => cache.get(key(route)) ?? null,
      getCached: async (route: PrRoute) => cache.get(key(route)) ?? null,
      isFresh: () => true,
      resolve
    } as unknown as PullRequestListStatService
  };
}

function createTitleLine(title: string): HTMLElement {
  const line = document.createElement("div");
  line.className = "bolt-table-two-line-cell-item";
  const text = document.createElement("div");
  text.textContent = title;
  line.append(text);
  return line;
}

function analysisFor(route: PrRoute): PullRequestAnalysis {
  return {
    context: {
      ...route,
      repositoryId: "repo-id",
      title: `PR ${route.pullRequestId}`,
      sourceCommit: "source",
      targetCommit: "target",
      mergeBaseCommit: "base",
      iterationId: 1,
      identity: `identity-${route.pullRequestId}`,
      reviewer: { id: "me", displayName: "Me" }
    },
    files: [{
      trackingId: route.pullRequestId,
      path: `/file-${route.pullRequestId}.ts`,
      changeType: "edit",
      additions: route.pullRequestId,
      deletions: route.pullRequestId === 101 ? 1 : 2,
      state: "exact",
      generated: false,
      lockfile: false
    }],
    groups: [],
    threads: { state: "available", active: 0, resolved: 0, total: 0 },
    completedTrackingIds: new Set()
  };
}
