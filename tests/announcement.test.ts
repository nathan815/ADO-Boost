import { describe, expect, it } from "vitest";
import type { AdoApi } from "../src/adapters/ado-api";
import { MemoryBrowserStore } from "../src/adapters/browser";
import { AnnouncementService } from "../src/core/announcement";
import type { PullRequestContext } from "../src/core/types";

const context: PullRequestContext = {
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
  reviewer: { id: "reviewer-id", displayName: "Current Reviewer" }
};

describe("AnnouncementService", () => {
  it("uses the authenticated reviewer display name", () => {
    const service = new AnnouncementService({} as AdoApi, new MemoryBrowserStore());
    expect(service.body(context)).toContain("Current Reviewer has started reviewing this PR.");
  });

  it("deduplicates a successfully posted announcement", async () => {
    let posts = 0;
    const api = {
      findAnnouncement: async () => null,
      postAnnouncement: async () => { posts += 1; return { threadId: 1, commentId: 2 }; }
    } as unknown as AdoApi;
    const service = new AnnouncementService(api, new MemoryBrowserStore());
    await service.post(context);
    await service.post(context);
    expect(posts).toBe(1);
  });

  it("reconciles an ambiguous result before retrying", async () => {
    const store = new MemoryBrowserStore();
    const api = {
      findAnnouncement: async () => ({ threadId: 8, commentId: 9 }),
      postAnnouncement: async () => { throw new TypeError("network failed"); }
    } as unknown as AdoApi;
    const service = new AnnouncementService(api, store);
    await expect(service.post(context)).rejects.toThrow("network failed");
    await expect(service.status(context)).resolves.toMatchObject({ status: "posted", threadId: 8, commentId: 9 });
  });

  it("keeps an in-flight marker when the server comment is not visible yet", async () => {
    const store = new MemoryBrowserStore();
    const service = new AnnouncementService({ findAnnouncement: async () => null } as unknown as AdoApi, store);
    await store.saveAnnouncement({ key: service.key(context), status: "posting", body: service.body(context) });
    await expect(service.status(context)).resolves.toMatchObject({ status: "posting" });
    await expect(service.post(context)).rejects.toThrow("already being posted");
  });
});
