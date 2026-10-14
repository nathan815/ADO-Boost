import { describe, expect, it, vi } from "vitest";
import type { AdoApi } from "../src/adapters/ado-api";
import { MemoryBrowserStore } from "../src/adapters/browser";
import { AnnouncementService } from "../src/core/announcement";
import type { PullRequestContext } from "../src/core/types";
import { announcementBody, readAnnouncementMetadata } from "../src/core/announcement-content";

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
    expect(service.body(context)).toContain("**Current Reviewer** has started reviewing this PR.");
    expect(service.body(context)).not.toContain("### Review started");
    expect(service.body(context)).toContain("[ADO Boost](https://github.com/nathan815/ADO-Boost) browser extension");
  });

  it("stores versioned review-start metadata without browser-local data", () => {
    const body = announcementBody(context, "2026-10-14T04:00:00.000Z");
    expect(readAnnouncementMetadata(body)).toEqual({
      version: 1,
      kind: "review-start",
      repositoryId: "repo-id",
      pullRequestId: 7,
      reviewerId: "reviewer-id",
      startedAt: "2026-10-14T04:00:00.000Z",
      iterationId: 3,
      sourceCommit: "source",
      targetCommit: "target",
      mergeBaseCommit: "base"
    });
  });

  it("does not allow context strings to close the metadata comment", () => {
    const body = announcementBody({ ...context, sourceCommit: "--><script>alert(1)</script>" });
    expect(body.match(/-->/g)).toHaveLength(1);
    expect(body).not.toContain("<script>");
    expect(readAnnouncementMetadata(body)?.sourceCommit).toBe("--><script>alert(1)</script>");
  });

  it.each([
    "No metadata",
    '<!-- ado-boost:{"version":1,} -->',
    '<!-- ado-boost:{"version":1} -->',
    announcementBody(context).replace('"version":1', '"version":2'),
    announcementBody(context).replace('"iterationId":3', '"iterationId":0'),
    announcementBody(context).replace(/"startedAt":"[^"]*"/, '"startedAt":"invalid"')
  ])("ignores invalid or unsupported metadata: %s", (body) => {
    expect(readAnnouncementMetadata(body)).toBeNull();
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
      findAnnouncement: vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ threadId: 8, commentId: 9 }),
      postAnnouncement: async () => { throw new TypeError("network failed"); }
    } as unknown as AdoApi;
    const service = new AnnouncementService(api, store);
    await expect(service.post(context)).rejects.toThrow("network failed");
    await expect(service.status(context)).resolves.toMatchObject({ status: "posted", threadId: 8, commentId: 9 });
  });

  it("restores a server announcement into a fresh browser without reposting", async () => {
    const body = announcementBody(context, "2026-10-14T04:00:00.000Z");
    const postAnnouncement = vi.fn();
    const store = new MemoryBrowserStore();
    const service = new AnnouncementService({
      findAnnouncement: async () => ({ threadId: 8, commentId: 9, body, postedAt: "2026-10-14T04:00:00.000Z" }),
      postAnnouncement
    } as unknown as AdoApi, store);
    const record = await service.post({ ...context, iterationId: 4, sourceCommit: "new-source" });
    expect(record).toMatchObject({ status: "posted", body, postedAt: "2026-10-14T04:00:00.000Z" });
    expect(readAnnouncementMetadata(record.body)).toMatchObject({ iterationId: 3, sourceCommit: "source" });
    expect(await store.getAnnouncement(service.key(context))).toEqual(record);
    expect(postAnnouncement).not.toHaveBeenCalled();
  });

  it("does not post when server reconciliation fails", async () => {
    const postAnnouncement = vi.fn();
    const service = new AnnouncementService({
      findAnnouncement: async () => { throw new Error("Lookup failed"); },
      postAnnouncement
    } as unknown as AdoApi, new MemoryBrowserStore());
    await expect(service.post(context)).rejects.toThrow("Lookup failed");
    expect(postAnnouncement).not.toHaveBeenCalled();
  });

  it("keeps an in-flight marker when the server comment is not visible yet", async () => {
    const store = new MemoryBrowserStore();
    const service = new AnnouncementService({ findAnnouncement: async () => null } as unknown as AdoApi, store);
    await store.saveAnnouncement({ key: service.key(context), status: "posting", body: service.body(context) });
    await expect(service.status(context)).resolves.toMatchObject({ status: "posting" });
    await expect(service.post(context)).rejects.toThrow("already being posted");
  });
});
