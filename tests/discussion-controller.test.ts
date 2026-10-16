// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { AdoApi } from "../src/adapters/ado-api";
import { MemoryBrowserStore } from "../src/adapters/browser";
import type { WriteGateway } from "../src/core/write-gateway";
import type { PullRequestAnalysis } from "../src/core/types";
import { defaultSettings } from "../src/features/registry";
import { DiscussionController } from "../src/ui/discussion-controller";

const analysis: PullRequestAnalysis = {
  context: {
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
    identity: "identity",
    reviewer: { id: "me", displayName: "Me" }
  },
  files: [],
  groups: [],
  threads: { state: "available", active: 0, resolved: 0, total: 0 },
  completedTrackingIds: new Set()
};

const writes = {} as WriteGateway;
const toast = { show: () => undefined, dismiss: () => undefined };

describe("DiscussionController feature gating", () => {
  it("shows separate creation and edit ages for originals and replies without enhancing system activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:20:00Z"));
    const settings = defaultSettings();
    settings.features.draftQueue = false;
    const publishedDate = "2026-10-16T12:00:00Z";
    const lastContentUpdatedDate = "2026-10-16T12:18:00Z";
    const api = { listThreads: async () => [{
      id: 10, status: "active", comments: [
        { id: 1, content: "Original", author: "Alice", isDeleted: false, publishedDate, lastContentUpdatedDate },
        { id: 2, content: "Reply", author: "Bob", isDeleted: false, publishedDate, lastContentUpdatedDate },
        { id: 3, content: "System activity", author: "System", isDeleted: false, isSystem: true, publishedDate, lastContentUpdatedDate }
      ]
    }] } as unknown as AdoApi;
    const controller = new DiscussionController(api, new MemoryBrowserStore(), analysis, writes, () => settings, () => undefined, toast);
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    try {
      await controller.load();
      root.innerHTML = controller.markup();
      controller.bind(root);
      expect(root.querySelectorAll("[data-adopp-comment-timestamps]")).toHaveLength(2);
      expect(root.querySelector('[data-comment-id="1"] time')!.textContent).toBe("20 min ago");
      expect(root.querySelector('[data-comment-id="2"]')!.textContent).toContain("Edited 2 min ago");
      expect(root.querySelector('[data-comment-id="3"] [data-adopp-comment-timestamps]')).toBeNull();
      expect(root.querySelector<HTMLButtonElement>(".jump-comment")!.dataset.publishedDate).toBe(publishedDate);
      const time = root.querySelector("time")!;
      vi.advanceTimersByTime(60000);
      expect(time.textContent).toBe("21 min ago");
      settings.features.commentTimestamps = false;
      root.innerHTML = controller.markup();
      controller.bind(root);
      expect(root.querySelector("[data-adopp-comment-timestamps]")).toBeNull();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      controller.destroy();
      vi.useRealTimers();
    }
  });

  it("renders no discussion surface when drafts and threads are disabled", async () => {
    const settings = defaultSettings();
    settings.features.draftQueue = false;
    settings.features.threadNavigator = false;
    const controller = new DiscussionController({} as AdoApi, new MemoryBrowserStore(), analysis, writes, () => settings, () => undefined, toast);
    await controller.load();
    expect(controller.markup()).toBe("");
  });

  it("does not expose draft, export, or submit actions when only threads are enabled", async () => {
    const settings = defaultSettings();
    settings.features.draftQueue = false;
    const api = { listThreads: async () => [] } as unknown as AdoApi;
    const controller = new DiscussionController(api, new MemoryBrowserStore(), analysis, writes, () => settings, () => undefined, toast);
    await controller.load();
    const markup = controller.markup();
    expect(markup).toContain("Discussion threads");
    expect(markup).not.toContain("Add general draft");
    expect(markup).not.toContain("Copy Markdown");
    expect(markup).not.toContain("class=\"primary submit-review\"");
  });

  it("gates export and submit independently", async () => {
    const settings = defaultSettings();
    settings.features.feedbackExport = false;
    settings.features.submitReview = false;
    const controller = new DiscussionController({ listThreads: async () => [] } as unknown as AdoApi, new MemoryBrowserStore(), analysis, writes, () => settings, () => undefined, toast);
    await controller.load();
    const markup = controller.markup();
    expect(markup).toContain("Add general draft");
    expect(markup).not.toContain("Copy Markdown");
    expect(markup).not.toContain("class=\"primary submit-review\"");
  });
});
