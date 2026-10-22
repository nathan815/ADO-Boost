import { describe, expect, it, vi } from "vitest";
import { ComparisonRefresh } from "../src/core/comparison-refresh";
import type { PullRequestAnalysis, PullRequestContext } from "../src/core/types";

function fixture() {
  const context: PullRequestContext = {
    origin: "https://dev.azure.com", organization: "org", project: "project", repository: "repo",
    repositoryId: "repo-id", pullRequestId: 7, title: "PR", sourceCommit: "source", targetCommit: "target",
    mergeBaseCommit: "base", iterationId: 3, identity: "original", reviewer: { id: "me", displayName: "Me" }
  };
  const analysis: PullRequestAnalysis = {
    context, files: [], groups: [], threads: { state: "available", active: 0, resolved: 0, total: 0 },
    completedTrackingIds: new Set()
  };
  const latest = { ...context, identity: "latest", iterationId: 4, sourceCommit: "new-source" };
  const getContext = vi.fn().mockResolvedValue(latest);
  const file = { path: "/new.ts", trackingId: 1, changeType: "add", additions: 1, deletions: 0, state: "exact" as const, generated: false, lockfile: false };
  const analyzeFiles = vi.fn().mockResolvedValue({ files: [file], unresolvedChanges: [] });
  const markStale = vi.fn();
  const apply = vi.fn((updated: PullRequestAnalysis) => { Object.assign(analysis, updated); });
  const abort = new AbortController();
  const refresh = new ComparisonRefresh({
    analysis, api: { getContext }, analyzer: { analyzeFiles }, signal: abort.signal,
    policy: () => ({ ignoreTrimWhitespace: true }), markStale, apply
  });
  return { context, analysis, latest, getContext, analyzeFiles, markStale, apply, abort, refresh, file };
}

describe("PR comparison refresh", () => {
  it("marks a detected iteration stale once without retargeting native files or open feedback", async () => {
    const f = fixture();
    await Promise.all([f.refresh.refresh(false), f.refresh.refresh(false)]);
    expect(f.getContext).toHaveBeenCalledOnce();
    expect(f.markStale).toHaveBeenCalledOnce();
    expect(f.analysis.context).toBe(f.context);
    expect(f.analyzeFiles).not.toHaveBeenCalled();
    expect(f.apply).not.toHaveBeenCalled();
    await f.refresh.refresh(false);
    expect(f.markStale).toHaveBeenCalledOnce();
    f.getContext.mockResolvedValue({ ...f.latest, iterationId: 5, identity: "newest" });
    await f.refresh.refresh(false);
    expect(f.markStale).toHaveBeenCalledTimes(2);
  });

  it("applies latest context and files together, preserving the old context object and policy", async () => {
    const f = fixture();
    await Promise.all([f.refresh.refresh(), f.refresh.refresh()]);
    expect(f.analyzeFiles).toHaveBeenCalledExactlyOnceWith(f.latest, f.abort.signal, true);
    expect(f.apply).toHaveBeenCalledOnce();
    expect(f.analysis.context).toBe(f.latest);
    expect(f.context.identity).toBe("original");
    expect(f.analysis.files).toEqual([f.file]);
    expect(f.analysis.groups.flatMap((group) => group.files)).toEqual([f.file]);
    expect(f.analysis.diffPolicy).toEqual({ ignoreTrimWhitespace: true });
    await f.refresh.refresh();
    expect(f.analyzeFiles).toHaveBeenCalledOnce();
  });

  it("upgrades an in-flight detection to a full refresh before regeneration", async () => {
    const f = fixture();
    let resolve!: (context: PullRequestContext) => void;
    f.getContext.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const detection = f.refresh.refresh(false);
    const generation = f.refresh.refresh(true);
    resolve(f.latest);
    await Promise.all([detection, generation]);
    expect(f.markStale).toHaveBeenCalledOnce();
    expect(f.apply).toHaveBeenCalledOnce();
    expect(f.analysis.context).toBe(f.latest);
  });

  it("reports a refresh failure without replacing context and allows a retry", async () => {
    const f = fixture();
    f.analyzeFiles.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(f.refresh.refresh()).rejects.toThrow("Unavailable");
    expect(f.analysis.context).toBe(f.context);
    expect(f.apply).not.toHaveBeenCalled();
    await f.refresh.refresh();
    expect(f.analysis.context).toBe(f.latest);
  });

  it("does not downgrade to a historical iteration returned by the service", async () => {
    const f = fixture();
    f.getContext.mockResolvedValue({ ...f.context, iterationId: 2, identity: "historical" });
    await expect(f.refresh.refresh()).rejects.toThrow("older PR iteration");
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.analysis.context).toBe(f.context);
  });

  it("does not apply an outstanding refresh after navigating away", async () => {
    const f = fixture();
    let resolve!: (value: { files: []; unresolvedChanges: [] }) => void;
    f.analyzeFiles.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = f.refresh.refresh();
    await vi.waitFor(() => expect(f.analyzeFiles).toHaveBeenCalledOnce());
    f.abort.abort();
    resolve({ files: [], unresolvedChanges: [] });
    await pending;
    expect(f.apply).not.toHaveBeenCalled();
    await f.refresh.refresh();
    expect(f.getContext).toHaveBeenCalledOnce();
  });
});
