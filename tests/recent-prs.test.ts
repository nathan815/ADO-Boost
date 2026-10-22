import { describe, expect, it } from "vitest";
import { RecentPrService, recentPrUrl, type RecentPr, type RecentPrStorage, type PrSummary } from "../src/core/recent-prs";

class MemoryStorage implements RecentPrStorage {
  value: unknown;
  async load(): Promise<unknown> { return this.value; }
  async save(entries: RecentPr[]): Promise<void> { this.value = entries; }
}

const summary: PrSummary = {
  origin: "https://dev.azure.com", organization: "org", project: "Project One", repository: "Repo One",
  repositoryId: "repo-id", pullRequestId: 42, title: "A pull request", author: "PR Author"
};

describe("recent PR history", () => {
  it("starts empty and persists only bounded summary metadata", async () => {
    const storage = new MemoryStorage();
    const history = new RecentPrService(storage, () => 1234);
    expect(await history.list()).toEqual([]);
    await history.record(summary);
    expect(await history.list()).toEqual([{
      organization: "org", project: "Project One", repository: "Repo One", repositoryId: "repo-id",
      pullRequestId: 42, title: "A pull request", author: "PR Author", viewedAt: 1234,
      url: "https://dev.azure.com/org/Project%20One/_git/Repo%20One/pullrequest/42"
    }]);
    expect(JSON.stringify(storage.value)).not.toMatch(/origin|reviewer|commit|diff/);
  });

  it("preserves older entries without authors and adds the author on revisit", async () => {
    const storage = new MemoryStorage();
    const history = new RecentPrService(storage);
    await history.record(summary, 1);
    const legacy = (await history.list())[0]!;
    delete legacy.author;
    storage.value = [legacy];
    expect(await history.list()).toMatchObject([{ title: summary.title, viewedAt: 1 }]);
    expect((await history.list())[0]?.author).toBeUndefined();
    await history.record(summary, 2);
    expect(await history.list()).toMatchObject([{ author: "PR Author", viewedAt: 2 }]);
    expect(await history.list()).toHaveLength(1);
  });

  it.each([123, "", "a".repeat(257)])("rejects invalid persisted authors (%s)", async (author) => {
    const storage = new MemoryStorage();
    storage.value = [{ ...summary, author, url: recentPrUrl(summary), viewedAt: 1 }];
    await expect(new RecentPrService(storage).list()).rejects.toThrow();
  });

  it("retains exactly the 100 most recent unique PRs", async () => {
    const history = new RecentPrService(new MemoryStorage());
    for (let i = 1; i <= 103; i++) await history.record({ ...summary, pullRequestId: i }, i);
    const entries = await history.list();
    expect(entries).toHaveLength(100);
    expect(entries[0]?.pullRequestId).toBe(103);
    expect(entries[99]?.pullRequestId).toBe(4);
  });

  it("deduplicates repository aliases and both ADO host formats", async () => {
    const history = new RecentPrService(new MemoryStorage());
    await history.record(summary, 1);
    await history.record({ ...summary, pullRequestId: 43 }, 2);
    await history.record({
      ...summary, origin: "https://ORG.visualstudio.com", organization: "ORG",
      repositoryId: "REPO-ID", repository: "Renamed repository", title: "Renamed PR"
    }, 3);
    expect(await history.list()).toMatchObject([
      { pullRequestId: 42, viewedAt: 3, title: "Renamed PR", repository: "Renamed repository" },
      { pullRequestId: 43, viewedAt: 2 }
    ]);
    expect(await history.list()).toHaveLength(2);
  });

  it("keeps matching PR numbers in different repos and orgs distinct", async () => {
    const history = new RecentPrService(new MemoryStorage());
    await history.record(summary, 1);
    await history.record({ ...summary, organization: "another-org" }, 2);
    await history.record({ ...summary, repositoryId: "another-repo" }, 3);
    expect(await history.list()).toHaveLength(3);
  });

  it("replaces a saved GUID repository label and URL with its resolved name on revisit", async () => {
    const history = new RecentPrService(new MemoryStorage());
    const repositoryId = "28363435-ab90-4b5a-878d-c637c15c66f1";
    await history.record({ ...summary, repository: repositoryId, repositoryId }, 1);
    await history.record({ ...summary, repositoryId }, 2);
    expect(await history.list()).toEqual([{
      organization: summary.organization, project: summary.project, repository: summary.repository,
      repositoryId, pullRequestId: summary.pullRequestId, title: summary.title, author: summary.author,
      viewedAt: 2, url: recentPrUrl(summary)
    }]);
  });

  it("does not let late older visits overwrite a newer title or timestamp", async () => {
    const history = new RecentPrService(new MemoryStorage());
    await history.record({ ...summary, title: "Latest title" }, 50);
    await history.record({ ...summary, pullRequestId: 43 }, 20);
    await history.record(summary, 10);
    expect(await history.list()).toMatchObject([{ pullRequestId: 42, title: "Latest title", viewedAt: 50 }, { pullRequestId: 43 }]);
  });

  it("clears only its own storage and permits future visits", async () => {
    const history = new RecentPrService(new MemoryStorage());
    await history.record(summary);
    await history.clear();
    expect(await history.list()).toEqual([]);
    await history.record(summary);
    expect(await history.list()).toHaveLength(1);
  });

  it.each(["javascript:alert(1)", "https://example.com/pr/42", "https://dev.azure.com/org/project/_git/repo/pullrequest/42?token=secret"])("rejects unsafe or noncanonical stored URL %s", async (url) => {
    const storage = new MemoryStorage();
    storage.value = [{ ...summary, url, viewedAt: 1 }];
    await expect(new RecentPrService(storage).list()).rejects.toThrow("Invalid recent PR URL");
  });

  it("surfaces malformed persisted data and storage failures", async () => {
    const storage = new MemoryStorage();
    storage.value = {};
    await expect(new RecentPrService(storage).list()).rejects.toThrow();
    const failure = new RecentPrService({ load: async () => undefined, save: async () => { throw new Error("Quota exceeded"); } });
    await expect(failure.record(summary)).rejects.toThrow("Quota exceeded");
    expect(recentPrUrl(summary)).not.toContain(" ");
  });
});
