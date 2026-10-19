import { afterEach, describe, expect, it, vi } from "vitest";
import { ChromeReviewActivityStorage } from "../src/adapters/review-activity-storage";
import { RECENT_PRS_KEY, recentPrUrl } from "../src/core/recent-prs";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const pr = {
    organization: "org", project: "project", repository: "repo", repositoryId: "repo-id",
    pullRequestId: 42, title: "Tracked PR", viewedAt: 100,
    url: recentPrUrl({ organization: "org", project: "project", repository: "repo", pullRequestId: 42 })
  };
  const key = "announcement:https://dev.azure.com/repo-id/42/reviewer";
  const values: Record<string, unknown> = {
    [key]: { key: key.slice("announcement:".length), status: "posted", body: "Started", pullRequest: pr },
    "drafts:private": [{ body: "Private draft" }]
  };
  const get = vi.fn(async (keys: string | string[]) => Object.fromEntries(
    (Array.isArray(keys) ? keys : [keys]).filter((key) => key in values).map((key) => [key, values[key]])
  ));
  const addListener = vi.fn();
  const removeListener = vi.fn();
  vi.stubGlobal("chrome", {
    storage: {
      local: { getKeys: async () => Object.keys(values), get },
      onChanged: { addListener, removeListener }
    }
  });
  return { values, key, get, addListener, removeListener };
}

describe("Chrome review activity storage", () => {
  it("reads only announcements and recent history, retaining tracked PRs without history", async () => {
    const { get, key } = setup();
    const entries = await new ChromeReviewActivityStorage().list();
    expect(entries).toMatchObject([{ title: "Tracked PR", reviewStatus: "reviewing" }]);
    expect(get).toHaveBeenCalledWith([key]);
    expect(get).toHaveBeenCalledWith(RECENT_PRS_KEY);
    expect(get).not.toHaveBeenCalledWith("drafts:private");
  });

  it("rejects invalid stored metadata rather than rendering unsafe links or dates", async () => {
    const { values, key } = setup();
    values[key] = {
      key: key.slice("announcement:".length), status: "posted",
      pullRequest: { url: "javascript:alert(1)" }
    };
    await expect(new ChromeReviewActivityStorage().list()).rejects.toThrow();
  });

  it("subscribes only to local history and announcement changes and unsubscribes", () => {
    const { addListener, removeListener } = setup();
    const listener = vi.fn();
    const unsubscribe = new ChromeReviewActivityStorage().subscribe(listener);
    const handler = addListener.mock.calls[0]![0];
    handler({ "drafts:private": {} }, "local");
    handler({ [RECENT_PRS_KEY]: {} }, "sync");
    expect(listener).not.toHaveBeenCalled();
    handler({ [RECENT_PRS_KEY]: {} }, "local");
    handler({ "announcement:pr": {} }, "local");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(handler);
  });
});
