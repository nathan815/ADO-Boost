import { describe, expect, it } from "vitest";
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

describe("DiscussionController feature gating", () => {
  it("renders no discussion surface when drafts and threads are disabled", async () => {
    const settings = defaultSettings();
    settings.features.draftQueue = false;
    settings.features.threadNavigator = false;
    const controller = new DiscussionController({} as AdoApi, new MemoryBrowserStore(), analysis, writes, () => settings, () => undefined);
    await controller.load();
    expect(controller.markup()).toBe("");
  });

  it("does not expose draft, export, or submit actions when only threads are enabled", async () => {
    const settings = defaultSettings();
    settings.features.draftQueue = false;
    const api = { listThreads: async () => [] } as unknown as AdoApi;
    const controller = new DiscussionController(api, new MemoryBrowserStore(), analysis, writes, () => settings, () => undefined);
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
    const controller = new DiscussionController({ listThreads: async () => [] } as unknown as AdoApi, new MemoryBrowserStore(), analysis, writes, () => settings, () => undefined);
    await controller.load();
    const markup = controller.markup();
    expect(markup).toContain("Add general draft");
    expect(markup).not.toContain("Copy Markdown");
    expect(markup).not.toContain("class=\"primary submit-review\"");
  });
});
