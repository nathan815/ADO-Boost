import { describe, expect, it, vi } from "vitest";
import { DiffCountController } from "../src/core/diff-counts";
import type { DiffPolicy, PullRequestAnalysis } from "../src/core/types";

const ignored: DiffPolicy = { ignoreTrimWhitespace: true };
const strict: DiffPolicy = { ignoreTrimWhitespace: false };

function analysis(): PullRequestAnalysis {
  return {
    context: {
      origin: "https://dev.azure.com", organization: "org", project: "project", repository: "repo",
      repositoryId: "repo-id", pullRequestId: 7, title: "PR", iterationId: 3, identity: "comparison",
      sourceCommit: "source", targetCommit: "target", mergeBaseCommit: "base",
      reviewer: { id: "reviewer", displayName: "Reviewer" }
    },
    files: [{
      path: "/app.ts", trackingId: 1, changeType: "edit", additions: 15, deletions: 4,
      state: "exact", generated: false, lockfile: false
    }],
    groups: [], completedTrackingIds: new Set(), threads: { state: "available", active: 0, resolved: 0, total: 0 },
    diffPolicy: strict
  };
}

function result(value: PullRequestAnalysis, additions: number) {
  return { changes: [], files: [{ ...value.files[0]!, additions, deletions: 0 }], unresolvedChanges: [] };
}

describe("whitespace-aware count refresh", () => {
  it("updates shared analysis and groups without recreating the panel or losing review state", async () => {
    const value = analysis();
    value.completedTrackingIds.add(1);
    const analyzer = { analyzeFiles: vi.fn().mockResolvedValue(result(value, 11)) };
    const changed = vi.fn();
    const controller = new DiffCountController(analyzer, changed);
    controller.setAnalysis(value);
    const update = controller.update(ignored);
    expect(value.countsUpdating).toBe(true);
    await update;
    expect(value.files[0]).toMatchObject({ additions: 11, deletions: 0 });
    expect(value.diffPolicy).toEqual(ignored);
    expect(value.groups.flatMap((group) => group.files)).toContain(value.files[0]);
    expect(value.completedTrackingIds.has(1)).toBe(true);
    expect(value.countsUpdating).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
    await controller.update({ ...ignored });
    expect(analyzer.analyzeFiles).toHaveBeenCalledTimes(1);
    expect(value.diffPolicy).toEqual(ignored);
  });

  it("discards late results after a second setting change or navigation", async () => {
    const value = analysis();
    let finish = (_value: ReturnType<typeof result>) => {};
    const analyzer = { analyzeFiles: vi.fn()
      .mockImplementationOnce(() => new Promise<ReturnType<typeof result>>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(result(value, 15)) };
    const controller = new DiffCountController(analyzer, vi.fn());
    controller.setAnalysis(value);
    const first = controller.update(ignored);
    await controller.update(strict);
    finish(result(value, 11));
    await first;
    expect(value.files[0]?.additions).toBe(15);
    expect(value.diffPolicy).toEqual(strict);

    analyzer.analyzeFiles.mockImplementationOnce(() => new Promise<ReturnType<typeof result>>((resolve) => { finish = resolve; }));
    const next = controller.update(ignored);
    controller.setAnalysis(null);
    finish(result(value, 11));
    await next;
    expect(value.files[0]?.additions).toBe(15);
  });

  it("surfaces refresh errors instead of leaving old counts marked exact", async () => {
    const value = analysis();
    const logger = { warn: vi.fn() };
    const controller = new DiffCountController({ analyzeFiles: vi.fn().mockRejectedValue(new Error("Denied")) }, vi.fn(), logger);
    controller.setAnalysis(value);
    await controller.update(ignored);
    expect(value.files[0]).toMatchObject({ additions: null, deletions: null, state: "error", detail: "Denied" });
    expect(value.countsUpdating).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });
});
