// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { AdoApi } from "../src/adapters/ado-api";
import { MemoryBrowserStore } from "../src/adapters/browser";
import { RuntimeCopilotGateway } from "../src/core/copilot-gateway";
import type { PullRequestAnalysis } from "../src/core/types";
import { RuntimeWriteGateway } from "../src/core/write-gateway";
import { defaultSettings } from "../src/features/registry";
import { MemorySettingsStorage, SettingsService } from "../src/features/settings-service";
import { ReviewPanel } from "../src/ui/review-panel";

let panel: ReviewPanel | undefined;

afterEach(() => {
  panel?.destroy();
  panel = undefined;
});

describe("ReviewPanel unresolved changes", () => {
  it("lists retained records and safely escapes diagnostic text without requesting unknown files", async () => {
    const analysis: PullRequestAnalysis = {
      context: {
        origin: "https://dev.azure.com", organization: "org", project: "project", repository: "repo",
        repositoryId: "repo-id", pullRequestId: 7, title: "PR", sourceCommit: "source", targetCommit: "target",
        mergeBaseCommit: "base", iterationId: 3, identity: "identity", reviewer: { id: "me", displayName: "Me" }
      },
      files: [],
      groups: [],
      threads: { state: "available", active: 0, resolved: 0, total: 0 },
      completedTrackingIds: new Set(),
      unresolvedChanges: [
        { unresolved: true, trackingId: 2, detail: "No usable file path", raw: { item: { path: null } } },
        { unresolved: true, path: "<img src=x>", detail: "<script>unexpected metadata</script>", raw: {} }
      ]
    };
    const settings = defaultSettings();
    settings.features.startReviewing = false;
    settings.features.threadNavigator = false;
    const fetch = vi.fn(async () => { throw new Error("Unexpected API request"); });
    panel = new ReviewPanel({
      analysis,
      api: new AdoApi({ fetch }),
      store: new MemoryBrowserStore(),
      settingsService: new SettingsService(new MemorySettingsStorage()),
      settings,
      reviewKey: "org/project/repo-id/7",
      writes: new RuntimeWriteGateway(),
      copilot: new RuntimeCopilotGateway(),
      openSettings: vi.fn()
    });
    panel.openDiscussions();
    const root = [...document.documentElement.children].find((element) => element.shadowRoot)?.shadowRoot;
    await vi.waitFor(() => expect(root?.querySelector("summary")?.textContent).toBe("2 unresolved changes retained. Diff totals are partial."));
    expect(root?.textContent).toContain("Change 2: No usable file path");
    expect(root?.textContent).toContain("<img src=x>: <script>unexpected metadata</script>");
    expect(root?.querySelectorAll("script, img")).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
