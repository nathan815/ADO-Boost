import { describe, expect, it } from "vitest";
import { MemoryBrowserStore } from "../src/adapters/browser";
import { DraftQueue } from "../src/core/drafts";
import type { PullRequestContext } from "../src/core/types";

function context(reviewerId: string, identity = "comparison-1"): PullRequestContext {
  return {
    origin: "https://dev.azure.com",
    organization: "org",
    project: "project",
    repository: "repo",
    repositoryId: "repo-id",
    pullRequestId: 7,
    title: "PR",
    sourceCommit: "source",
    targetCommit: "target",
    mergeBaseCommit: "base",
    iterationId: 3,
    identity,
    reviewer: { id: reviewerId, displayName: reviewerId }
  };
}

describe("DraftQueue", () => {
  it("isolates drafts by account", async () => {
    const store = new MemoryBrowserStore();
    const first = new DraftQueue(store, context("one"));
    const second = new DraftQueue(store, context("two"));
    await first.add({ kind: "general", body: "Only account one" });
    expect(await first.list()).toHaveLength(1);
    expect(await second.list()).toEqual([]);
  });

  it("marks drafts stale when the immutable comparison changes", async () => {
    const store = new MemoryBrowserStore();
    const original = new DraftQueue(store, context("one", "old"));
    const draft = await original.add({ kind: "inline", body: "Check this", path: "/a.ts", line: 4, trackingId: 1 });
    expect(new DraftQueue(store, context("one", "new")).stale(draft)).toBe(true);
  });

  it("preserves the selected inline side", async () => {
    const store = new MemoryBrowserStore();
    const queue = new DraftQueue(store, context("one"));
    const draft = await queue.add({ kind: "inline", body: "Removed line", path: "/a.ts", line: 7, side: "left", trackingId: 1 });
    expect(draft.side).toBe("left");
  });

  it("preserves concurrent additions instead of losing a read-modify-write update", async () => {
    const store = new MemoryBrowserStore();
    const first = new DraftQueue(store, context("one"));
    const second = new DraftQueue(store, context("one"));
    await Promise.all([
      first.add({ kind: "general", body: "First" }),
      second.add({ kind: "general", body: "Second" })
    ]);
    expect((await first.list()).map((draft) => draft.body).sort()).toEqual(["First", "Second"]);
  });

  it("defaults provenance to manual and publishes authoritative queue changes", async () => {
    const store = new MemoryBrowserStore();
    const queue = new DraftQueue(store, context("one"));
    const changes: string[][] = [];
    const unsubscribe = queue.subscribe((drafts) => changes.push(drafts.map((draft) => draft.body)));
    const draft = await queue.add({ kind: "general", body: "First" });
    expect(draft.source).toBe("manual");
    await queue.update(draft.id, { body: "Updated" });
    await queue.remove(draft.id);
    unsubscribe();
    await queue.add({ kind: "general", body: "Ignored", source: "copilot" });
    expect(changes).toEqual([["First"], ["Updated"], []]);
  });
});
