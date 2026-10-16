// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://dev.azure.com/org/project/_git/repo/pullrequest/7"}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBrowserStore } from "../src/adapters/browser";
import type { PullRequestAnalysis } from "../src/core/types";
import { NativeDiscussionClient } from "../src/native-discussions/client";
import {
  DISCUSSION_CHANNEL,
  discussionActionSchema,
  discussionConfigurationSchema
} from "../src/native-discussions/protocol";

const analysis: PullRequestAnalysis = {
  context: {
    origin: location.origin,
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
    identity: "comparison",
    reviewer: { id: "reviewer", displayName: "Reviewer" }
  },
  files: [{ trackingId: 12, path: "/src/app.ts", changeType: "edit", additions: 1, deletions: 1, state: "exact", generated: false, lockfile: false }],
  groups: [],
  threads: { state: "available", active: 0, resolved: 0, total: 0 },
  completedTrackingIds: new Set()
};

describe("native discussion protocol", () => {
  it("accepts bounded draft projections and rejects write-shaped commands", () => {
    const configuration = {
      channel: DISCUSSION_CHANNEL,
      kind: "configure",
      session: "16748ae6-f0a9-4dad-ac76-88e2bafc32c1",
      page: location.origin + location.pathname,
      reviewer: analysis.context.reviewer,
      enabled: true,
      drafts: []
    };
    expect(discussionConfigurationSchema.safeParse(configuration).success).toBe(true);
    expect(discussionConfigurationSchema.safeParse({ ...configuration, submit: true }).success).toBe(false);
    expect(discussionActionSchema.safeParse({
      channel: DISCUSSION_CHANNEL,
      kind: "action",
      session: configuration.session,
      action: "add",
      draft: { kind: "general", body: "" }
    }).success).toBe(false);
  });
});

describe("native discussion client", () => {
  let store: MemoryBrowserStore;
  let client: NativeDiscussionClient;
  let posted: unknown[];

  beforeEach(() => {
    store = new MemoryBrowserStore();
    posted = [];
    vi.spyOn(window, "postMessage").mockImplementation((message) => {
      posted.push(message);
    });
    client = new NativeDiscussionClient(analysis, store);
  });

  afterEach(() => {
    client.stop();
    vi.restoreAllMocks();
  });

  it("projects authoritative draft updates and validates inline locations", async () => {
    await client.start(true);
    const configured = discussionConfigurationSchema.parse(posted.at(-1));
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      origin: location.origin,
      data: {
        channel: DISCUSSION_CHANNEL,
        kind: "action",
        session: configured.session,
        action: "add",
        draft: { kind: "inline", body: "Check this", path: "/src/app.ts", line: 4, side: "right" }
      }
    }));
    await vi.waitFor(() => {
      const latest = discussionConfigurationSchema.parse(posted.at(-1));
      expect(latest.drafts).toEqual([expect.objectContaining({
        kind: "inline",
        body: "Check this",
        path: "/src/app.ts",
        line: 4,
        trackingId: 12,
        source: "manual"
      })]);
    });
  });

  it("ignores actions from another bridge session", async () => {
    await client.start(true);
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      origin: location.origin,
      data: {
        channel: DISCUSSION_CHANNEL,
        kind: "action",
        session: "e3c7c96b-77ac-4c78-a27f-9b586e383b8c",
        action: "add",
        draft: { kind: "general", body: "Forged" }
      }
    }));
    await Promise.resolve();
    const latest = discussionConfigurationSchema.parse(posted.at(-1));
    expect(latest.drafts).toEqual([]);
  });

  it("preserves the latest enabled state when storage changes", async () => {
    await client.start(true);
    client.update(false);
    await store.saveDrafts(`${analysis.context.origin}/${analysis.context.repositoryId}/${analysis.context.pullRequestId}/${analysis.context.reviewer.id}`, []);
    await vi.waitFor(() => {
      const latest = discussionConfigurationSchema.parse(posted.at(-1));
      expect(latest.enabled).toBe(false);
    });
  });

  it("keeps timestamp enablement independent of draft storage updates", async () => {
    await client.start(false, true);
    expect(discussionConfigurationSchema.parse(posted.at(-1))).toMatchObject({ enabled: false, commentTimestamps: true });
    client.update(true, false);
    await store.saveDrafts(`${analysis.context.origin}/${analysis.context.repositoryId}/${analysis.context.pullRequestId}/${analysis.context.reviewer.id}`, []);
    await vi.waitFor(() => {
      expect(discussionConfigurationSchema.parse(posted.at(-1))).toMatchObject({ enabled: true, commentTimestamps: false });
    });
  });
});
