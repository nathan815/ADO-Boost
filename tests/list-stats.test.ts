import { describe, expect, it, vi } from "vitest";
import { MemoryPullRequestListStatStore } from "../src/adapters/list-stat-cache";
import {
  LIST_STAT_MAX_AGE_MS,
  PullRequestListStatService,
  type PullRequestListStat
} from "../src/core/list-stats";
import type { FileStat, PrRoute, PullRequestComparison } from "../src/core/types";

const route: PrRoute = {
  origin: "https://dev.azure.com",
  organization: "org",
  project: "project",
  repository: "repo",
  pullRequestId: 7
};
const now = new Date("2026-10-16T05:00:00.000Z");

describe("PullRequestListStatService", () => {
  it("does not use cached counts or calculate new ones without the user's actual setting", async () => {
    const api = { getLatestComparison: vi.fn() };
    const analyzer = { analyzeFiles: vi.fn() };
    const service = new PullRequestListStatService(api, analyzer, new MemoryPullRequestListStatStore(),
      () => now, undefined, () => null);
    expect(service.peek(route)).toBeNull();
    expect(await service.getCached(route)).toBeNull();
    await expect(service.resolve(route, stat())).rejects.toThrow("ADO whitespace setting unavailable");
    expect(api.getLatestComparison).not.toHaveBeenCalled();
    expect(analyzer.analyzeFiles).not.toHaveBeenCalled();
  });

  it("separates cached and in-flight results by whitespace policy even if the policy changes mid-request", async () => {
    let mode = true;
    const api = { getLatestComparison: vi.fn().mockResolvedValue(comparison()) };
    const analyzer = { analyzeFiles: vi.fn(async (_context, _signal, ignore: boolean | null) => ({
      changes: [], files: [file({ additions: ignore ? 7 : 16, deletions: ignore ? 3 : 12 })], unresolvedChanges: []
    })) };
    const service = new PullRequestListStatService(api, analyzer, new MemoryPullRequestListStatStore(), () => now, undefined, () => mode);
    const ignoredKey = service.key(route);
    const ignored = service.resolve(route, null);
    mode = false;
    expect(service.key(route)).not.toBe(ignoredKey);
    const strict = service.resolve(route, null);
    await expect(ignored).resolves.toMatchObject({ stat: { additions: 7, deletions: 3, ignoreTrimWhitespace: true } });
    await expect(strict).resolves.toMatchObject({ stat: { additions: 16, deletions: 12, ignoreTrimWhitespace: false } });
    expect(service.peek(route)?.additions).toBe(16);
    mode = true;
    expect((await service.getCached(route))?.additions).toBe(7);
    mode = false;
    await expect(service.resolve(route, stat())).resolves.toMatchObject({ stat: { ignoreTrimWhitespace: false }, freshness: "recalculated" });
  });
  it("uses a recently validated persisted result without an API request", async () => {
    const store = new MemoryPullRequestListStatStore();
    const cached = stat();
    const api = { getLatestComparison: vi.fn() };
    const analyzer = { analyzeFiles: vi.fn() };
    const service = new PullRequestListStatService(api, analyzer, store, () => now);
    await store.save(service.key(route), cached);

    const stored = await service.getCached(route);
    await expect(service.resolve(route, stored)).resolves.toEqual({ stat: cached, freshness: "fresh" });
    expect(api.getLatestComparison).not.toHaveBeenCalled();
    expect(analyzer.analyzeFiles).not.toHaveBeenCalled();
  });

  it("validates a stale result with one iterations request without recalculating unchanged stats", async () => {
    const store = new MemoryPullRequestListStatStore();
    const cached = stat({ validatedAt: "2026-10-16T04:00:00.000Z" });
    const api = { getLatestComparison: vi.fn().mockResolvedValue(comparison()) };
    const analyzer = { analyzeFiles: vi.fn() };
    const service = new PullRequestListStatService(api, analyzer, store, () => now);
    await store.save(service.key(route), cached);

    const resolution = await service.resolve(route, await service.getCached(route));
    expect(resolution).toMatchObject({ freshness: "validated", stat: { validatedAt: now.toISOString() } });
    expect(api.getLatestComparison).toHaveBeenCalledExactlyOnceWith(route, undefined);
    expect(analyzer.analyzeFiles).not.toHaveBeenCalled();
  });

  it("recalculates and persists totals when the comparison identity changes", async () => {
    const store = new MemoryPullRequestListStatStore();
    const cached = stat({ validatedAt: "2026-10-16T04:00:00.000Z" });
    const latest = comparison({ iterationId: 4, sourceCommit: "source-2", identity: "identity-2" });
    const api = { getLatestComparison: vi.fn().mockResolvedValue(latest) };
    const analyzer = {
      analyzeFiles: vi.fn().mockResolvedValue({
        changes: [],
        files: [file({ additions: 5, deletions: 2 })],
        unresolvedChanges: []
      })
    };
    const service = new PullRequestListStatService(api, analyzer, store, () => now);
    await store.save(service.key(route), cached);

    await expect(service.resolve(route, await service.getCached(route))).resolves.toMatchObject({
      freshness: "recalculated",
      stat: { additions: 5, deletions: 2, iterationId: 4, sourceCommit: "source-2", exact: true }
    });
    expect(analyzer.analyzeFiles).toHaveBeenCalledExactlyOnceWith(latest, undefined, true);
    expect(await store.get(service.key(route))).toMatchObject({ additions: 5, iterationId: 4 });
  });

  it("retains cached totals but marks them unverified when validation fails", async () => {
    const store = new MemoryPullRequestListStatStore();
    const cached = stat({ validatedAt: "2026-10-16T04:00:00.000Z" });
    const api = { getLatestComparison: vi.fn().mockRejectedValue(new Error("Iterations unavailable")) };
    const service = new PullRequestListStatService(api, { analyzeFiles: vi.fn() }, store, () => now);

    await expect(service.resolve(route, cached)).resolves.toEqual({
      stat: cached,
      freshness: "unverified",
      error: "Iterations unavailable"
    });
  });

  it("does not turn a cold-load failure into a cached-looking result", async () => {
    const api = { getLatestComparison: vi.fn().mockRejectedValue(new Error("Denied")) };
    const service = new PullRequestListStatService(api, { analyzeFiles: vi.fn() }, new MemoryPullRequestListStatStore(), () => now);
    await expect(service.resolve(route, null)).rejects.toThrow("Denied");
  });

  it("deduplicates concurrent calculations for duplicate PR rows", async () => {
    const latest = comparison();
    const api = { getLatestComparison: vi.fn().mockResolvedValue(latest) };
    const analyzer = {
      analyzeFiles: vi.fn().mockResolvedValue({
        changes: [],
        files: [file()],
        unresolvedChanges: []
      })
    };
    const service = new PullRequestListStatService(api, analyzer, new MemoryPullRequestListStatStore(), () => now);

    const [first, second] = await Promise.all([
      service.resolve(route, null),
      service.resolve(route, null)
    ]);

    expect(first).toEqual(second);
    expect(api.getLatestComparison).toHaveBeenCalledOnce();
    expect(analyzer.analyzeFiles).toHaveBeenCalledOnce();
  });

  it("prunes expired and excess persisted summaries", async () => {
    const store = new MemoryPullRequestListStatStore();
    await store.save("expired", stat({ validatedAt: new Date(now.getTime() - LIST_STAT_MAX_AGE_MS - 1).toISOString() }));
    await store.save("newest", stat({ validatedAt: "2026-10-16T04:59:00.000Z" }));
    await store.save("older", stat({ validatedAt: "2026-10-16T04:58:00.000Z" }));

    await store.prune({ maxAgeMs: LIST_STAT_MAX_AGE_MS, maxEntries: 1, now });

    expect(await store.get("expired")).toBeNull();
    expect(await store.get("newest")).not.toBeNull();
    expect(await store.get("older")).toBeNull();
  });
});

function comparison(overrides: Partial<PullRequestComparison> = {}): PullRequestComparison {
  return {
    ...route,
    repositoryId: "repo",
    sourceCommit: "source",
    targetCommit: "target",
    mergeBaseCommit: "base",
    iterationId: 3,
    identity: "identity",
    ...overrides
  };
}

function stat(overrides: Partial<PullRequestListStat> = {}): PullRequestListStat {
  return {
    version: 2,
    ignoreTrimWhitespace: true,
    additions: 10,
    deletions: 4,
    exact: true,
    fileCount: 2,
    iterationId: 3,
    sourceCommit: "source",
    targetCommit: "target",
    mergeBaseCommit: "base",
    calculatedAt: "2026-10-16T04:00:00.000Z",
    validatedAt: now.toISOString(),
    ...overrides
  };
}

function file(overrides: Partial<FileStat> = {}): FileStat {
  return {
    trackingId: 1,
    path: "/a.ts",
    changeType: "edit",
    additions: 1,
    deletions: 1,
    state: "exact",
    generated: false,
    lockfile: false,
    ...overrides
  };
}
