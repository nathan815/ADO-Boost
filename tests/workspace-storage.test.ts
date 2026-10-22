import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { WorkspaceStorage } from "../src/workspace/storage";
import { emptyPreferences } from "../src/workspace/protocol";

describe("extension workspace IndexedDB", () => {
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
