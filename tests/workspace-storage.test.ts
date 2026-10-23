import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { WorkspaceStorage } from "../src/workspace/storage";
import { emptyPreferences, prSchema } from "../src/workspace/protocol";

describe("extension workspace IndexedDB", () => {
  it("preserves initial project confirmation across sessions without requiring it in legacy preferences", async () => {
    const factory = new IDBFactory();
    const storage = new WorkspaceStorage(factory);
    const legacy = { ...emptyPreferences(), projects: [{ id: "one", name: "One" }] };
    await storage.preferences("a", legacy);
    expect(await storage.preferences("a")).toEqual(legacy);
    await storage.preferences("a", { ...legacy, projectsConfirmed: true });
    const reopened = new WorkspaceStorage(factory);
    expect(await reopened.preferences("a")).toEqual({ ...legacy, projectsConfirmed: true });
    expect((await reopened.preferences("b")).projectsConfirmed).toBeUndefined();
  });

  it("suggests unique projects from the viewer's own cached PR activity, including history, without mixing accounts", async () => {
    const storage = new WorkspaceStorage(new IDBFactory());
    const pr = (project: string, date: string, author = "me", reviewers: string[] = []) => prSchema.parse({
      pullRequestId: 1, title: "Change", status: "active", creationDate: date,
      repository: { id: `${project}-repo`, name: "Repo", project: { id: project, name: project } },
      createdBy: { id: author, displayName: author },
      reviewers: reviewers.map((id) => ({ id, displayName: id, vote: 0 }))
    });
    await storage.cache("a", "recent", { items: [
      pr("Older", "2026-01-01T00:00:00Z"), pr("One", "2026-03-01T00:00:00Z", "other", ["me"]),
      pr("Unrelated", "2026-05-01T00:00:00Z", "other")
    ], more: false });
    await storage.cache("a", "history", { items: [
      pr("One", "2026-02-01T00:00:00Z"), pr("Newest", "2026-04-01T00:00:00Z")
    ], more: false }, { retention: "history", permanent: true });
    await storage.cache("b", "private", { items: [pr("Private", "2026-06-01T00:00:00Z")], more: false });
    await storage.cache("a", "projects", { items: [{ id: "not-a-pr", name: "Ignore" }], more: false });
    const suggestions = await storage.suggestions("a", "me", ["One", "Older"]);
    expect(suggestions.projects).toEqual([
      { id: "Newest", name: "Newest" }, { id: "One", name: "One" }, { id: "Older", name: "Older" }
    ]);
    expect(suggestions.repositories.map((repo) => repo.id)).toEqual(["One-repo", "Older-repo"]);
    expect(await storage.suggestions("elsewhere", "me", ["One"])).toEqual({ projects: [], repositories: [] });
    await storage.clearCache("a");
    expect(await storage.suggestions("a", "me", ["One"])).toEqual({ projects: [], repositories: [] });
    expect((await storage.suggestions("b", "me", [])).projects).toEqual([{ id: "Private", name: "Private" }]);
    expect((await storage.suggestions("b", "me", [])).repositories).toEqual([]);
  });

  it("limits activity suggestions to ten projects", async () => {
    const storage = new WorkspaceStorage(new IDBFactory());
    await storage.cache("a", "prs", { items: Array.from({ length: 15 }, (_, index) => ({
      pullRequestId: index + 1, title: "Change", status: "active", creationDate: "2026-01-01T00:00:00Z",
      repository: { id: "r", name: "Repo", project: { id: String(index), name: String(index) } },
      createdBy: { id: "me", displayName: "Me" }
    })), more: false });
    expect((await storage.suggestions("a", "me", [])).projects).toHaveLength(10);
  });

  it("deduplicates repository suggestions and limits the most recent results after scoping to selected projects", async () => {
    const storage = new WorkspaceStorage(new IDBFactory());
    const pr = (id: number, selected: boolean) => ({
      pullRequestId: id + 1, title: "Change", status: "active", creationDate: new Date(Date.UTC(2026, 0, id + 1)).toISOString(),
      repository: { id: `repo-${id}`, name: `Repo ${id}`, project: { id: selected ? "selected" : "unselected", name: "Project" } },
      createdBy: { id: "me", displayName: "Me" }
    });
    const recent = pr(24, true);
    await storage.cache("a", "recent", { items: [
      ...Array.from({ length: 25 }, (_, id) => pr(id, true)),
      ...Array.from({ length: 25 }, (_, id) => pr(id + 25, false))
    ], more: false });
    await storage.cache("a", "historical-duplicate", { items: [
      { ...recent, creationDate: "2025-01-01T00:00:00Z", repository: { ...recent.repository, name: "Old name" } }
    ], more: false }, { retention: "history", permanent: true });
    const { repositories } = await storage.suggestions("a", "me", ["selected"]);
    expect(repositories).toHaveLength(20);
    expect(repositories[0]).toEqual(recent.repository);
    expect(repositories[19]?.id).toBe("repo-5");
    expect(repositories.every((repo) => repo.project.id === "selected")).toBe(true);
  });

  it("partitions preferences and cache by organization and viewer", async () => {
    const storage = new WorkspaceStorage(new IDBFactory());
    const me = WorkspaceStorage.partition("Org", "me");
    const other = WorkspaceStorage.partition("Org", "other");
    const elsewhere = WorkspaceStorage.partition("Elsewhere", "me");
    const preferences = { ...emptyPreferences(), projects: [{ id: "1", name: "Project" }] };
    await storage.preferences(me, preferences);
    await storage.cache(me, "prs", { items: [1] });
    expect(await storage.preferences(me)).toEqual(preferences);
    expect(await storage.preferences(other)).toEqual(emptyPreferences());
    expect(await storage.cache(other, "prs")).toBeNull();
    expect(await storage.cache(elsewhere, "prs")).toBeNull();
    expect(WorkspaceStorage.partition("ORG", "me")).toBe(me);
  });

  it("persists across service instances and clears only this partition's cache", async () => {
    const factory = new IDBFactory();
    const first = new WorkspaceStorage(factory);
    await first.preferences("a", { ...emptyPreferences(), follows: [{ id: "p", displayName: "Person" }] });
    await first.cache("a", "data", [1]);
    await first.cache("b", "data", [2]);
    const restarted = new WorkspaceStorage(factory);
    expect(await restarted.cache("a", "data")).toEqual([1]);
    await restarted.clearCache("a");
    expect(await restarted.cache("a", "data")).toBeNull();
    expect(await restarted.cache("b", "data")).toEqual([2]);
    expect((await restarted.preferences("a")).follows).toHaveLength(1);
  });

  it("expires cached responses and keeps preference records", async () => {
    let now = 0;
    const storage = new WorkspaceStorage(new IDBFactory(), () => now);
    await storage.cache("a", "data", [1]);
    now = 5 * 60_000;
    expect(await storage.cache("a", "data")).toBeNull();
    await expect(storage.cache("a", "large", "x".repeat(2_000_001))).rejects.toThrow("too large");
  });

  it("retains historical snapshots across years and volatile-cache eviction, but lets refresh replace them with mutable data", async () => {
    let now = 0;
    const factory = new IDBFactory();
    const storage = new WorkspaceStorage(factory, () => now);
    const history = { retention: "history", permanent: true } as const;
    await storage.cache("a", "old-month", [1], history);
    now = 366 * 86400_000;
    for (let index = 0; index < 202; index++) await storage.cache("a", String(index), index);
    const reopened = new WorkspaceStorage(factory, () => now);
    expect(await reopened.cache("a", "old-month", undefined, history)).toEqual([1]);
    expect(await reopened.cache("b", "old-month", undefined, history)).toBeNull();
    await reopened.cache("a", "old-month", [2], { retention: "history", permanent: false });
    now += 5 * 60_000;
    expect(await reopened.cache("a", "old-month", undefined, history)).toBeNull();
    await reopened.cache("a", "old-month", [3], history);
    await reopened.cache("b", "old-month", [4], history);
    await reopened.clearCache("a");
    expect(await reopened.cache("a", "old-month", undefined, history)).toBeNull();
    expect(await reopened.cache("b", "old-month", undefined, history)).toEqual([4]);
  });

  it("upgrades the existing database without replacing preferences or the recent cache", async () => {
    const factory = new IDBFactory();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("ado-boost-workspace", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("preferences");
        request.result.createObjectStore("cache", { keyPath: "key" }).createIndex("partition", "partition");
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("preferences", "readwrite");
      tx.objectStore("preferences").put(emptyPreferences(), "a");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const storage = new WorkspaceStorage(factory);
    expect(await storage.preferences("a")).toEqual(emptyPreferences());
    await storage.cache("a", "old-month", [], { retention: "history", permanent: true });
    expect(await storage.cache("a", "old-month", undefined, { retention: "history" })).toEqual([]);
  });

  it("bounds cache entries without evicting follows", async () => {
    let now = 0;
    const storage = new WorkspaceStorage(new IDBFactory(), () => now++);
    await storage.preferences("a", { ...emptyPreferences(), follows: [{ id: "p", displayName: "Person" }] });
    for (let index = 0; index < 202; index++) await storage.cache("a", String(index), index);
    expect(await storage.cache("a", "0")).toBeNull();
    expect(await storage.cache("a", "201")).toBe(201);
    expect((await storage.preferences("a")).follows).toHaveLength(1);
  });

  it("rejects invalid preference data instead of accepting unbounded selections", async () => {
    const storage = new WorkspaceStorage(new IDBFactory());
    await expect(storage.preferences("a", { ...emptyPreferences(), projects: Array.from({ length: 11 }, (_, id) => ({ id: String(id), name: String(id) })) })).rejects.toThrow();
  });

  it("surfaces unavailable IndexedDB rather than pretending data was saved", async () => {
    const factory = new IDBFactory();
    factory.open = () => { throw new DOMException("Storage disabled", "SecurityError"); };
    await expect(new WorkspaceStorage(factory).preferences("a", emptyPreferences())).rejects.toThrow("Storage disabled");
  });
});
