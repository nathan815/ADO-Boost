import { emptyPreferences, preferencesSchema, prPageSchema, type Preferences, type Project, type Repository, type WorkspaceSuggestions } from "./protocol";

interface CacheEntry { key: string; partition: string; updatedAt: number; value: unknown; permanent?: boolean }
export interface CacheOptions { retention?: "recent" | "history"; permanent?: boolean }

export class WorkspaceStorage {
  private database: Promise<IDBDatabase> | null = null;
  constructor(private readonly factory: IDBFactory, private readonly now: () => number = Date.now) {}

  static partition(organization: string, viewer: string): string {
    return JSON.stringify([organization.toLowerCase(), viewer]);
  }

  async preferences(partition: string, value?: Preferences): Promise<Preferences> {
    if (value) {
      const parsed = preferencesSchema.parse(value);
      await this.transaction("preferences", "readwrite", (store) => store.put(parsed, partition));
      return parsed;
    }
    const stored = await this.transaction("preferences", "readonly", (store) => store.get(partition));
    return stored === undefined ? emptyPreferences() : preferencesSchema.parse(stored);
  }

  async cache(partition: string, key: string, value?: unknown, options: CacheOptions = {}): Promise<unknown> {
    const fullKey = JSON.stringify([partition, key]);
    const storeName = options.retention === "history" ? "history" : "cache";
    if (value === undefined) {
      const result = await this.transaction(storeName, "readonly", (store) => store.get(fullKey)) as CacheEntry | undefined;
      return result && (result.permanent || this.now() - result.updatedAt < 5 * 60_000) ? result.value : null;
    }
    if (JSON.stringify(value).length > 2_000_000) throw new Error("Workspace cache entry is too large. Reduce the loaded history.");
    await this.transaction(storeName, "readwrite", (store) => store.put({
      key: fullKey, partition, updatedAt: this.now(), value, permanent: storeName === "history" && options.permanent === true
    } satisfies CacheEntry));
    if (storeName === "history") return value;
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("cache", "readwrite");
      const store = tx.objectStore("cache");
      const request = store.index("partition").getAll(partition);
      request.onsuccess = () => {
        const entries = request.result as CacheEntry[];
        entries.sort((a, b) => b.updatedAt - a.updatedAt);
        let size = 0;
        entries.forEach((entry, index) => {
          size += JSON.stringify(entry.value).length;
          if (index >= 200 || size > 20_000_000 || this.now() - entry.updatedAt >= 7 * 86400_000) store.delete(entry.key);
        });
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Workspace cache cleanup failed"));
      tx.onerror = () => reject(tx.error ?? new Error("Workspace cache cleanup failed"));
    });
    return value;
  }

  async clearCache(partition: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["cache", "history"], "readwrite");
      for (const name of ["cache", "history"]) {
        const cursor = tx.objectStore(name).index("partition").openCursor(partition);
        cursor.onsuccess = () => { if (cursor.result) { cursor.result.delete(); cursor.result.continue(); } };
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Could not clear workspace cache"));
      tx.onerror = () => reject(tx.error ?? new Error("Could not clear workspace cache"));
    });
  }

  async suggestions(partition: string, viewer: string, selectedProjects: readonly string[]): Promise<WorkspaceSuggestions> {
    const db = await this.open();
    const projects = new Map<string, { project: Project; date: string }>();
    const repositories = new Map<string, { repository: Repository; date: string }>();
    const selected = new Set(selectedProjects);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["cache", "history"], "readonly");
      for (const name of ["cache", "history"]) {
        const cursor = tx.objectStore(name).index("partition").openCursor(partition);
        cursor.onsuccess = () => {
          const result = cursor.result;
          if (!result) return;
          const page = prPageSchema.safeParse((result.value as CacheEntry).value);
          if (page.success) for (const pr of page.data.items) {
            if (pr.createdBy.id !== viewer && !pr.reviewers.some((reviewer) => reviewer.id === viewer)) continue;
            const project = pr.repository.project;
            const date = pr.closedDate ?? pr.creationDate;
            const previous = projects.get(project.id);
            if (!previous || previous.date < date) projects.set(project.id, { project, date });
            if (selected.has(project.id)) {
              const previousRepo = repositories.get(pr.repository.id);
              if (!previousRepo || previousRepo.date < date) repositories.set(pr.repository.id, { repository: pr.repository, date });
            }
          }
          result.continue();
        };
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Could not load workspace suggestions"));
      tx.onerror = () => reject(tx.error ?? new Error("Could not load workspace suggestions"));
    });
    return {
      projects: [...projects.values()].sort((a, b) => b.date.localeCompare(a.date) || a.project.name.localeCompare(b.project.name))
        .slice(0, 10).map(({ project }) => project),
      repositories: [...repositories.values()].sort((a, b) => b.date.localeCompare(a.date) ||
        a.repository.project.name.localeCompare(b.repository.project.name) || a.repository.name.localeCompare(b.repository.name))
        .slice(0, 20).map(({ repository }) => repository)
    };
  }

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory.open("ado-boost-workspace", 2);
        let blocked = false;
        request.onupgradeneeded = (event) => {
          if (event.oldVersion < 1) {
            request.result.createObjectStore("preferences");
            const cache = request.result.createObjectStore("cache", { keyPath: "key" });
            cache.createIndex("partition", "partition");
          }
          const history = request.result.createObjectStore("history", { keyPath: "key" });
          history.createIndex("partition", "partition");
        };
        request.onsuccess = () => {
          const db = request.result;
          if (blocked) { db.close(); return; }
          db.onversionchange = () => { db.close(); this.database = null; };
          resolve(db);
        };
        request.onerror = () => reject(request.error ?? new Error("Workspace IndexedDB is unavailable"));
        request.onblocked = () => { blocked = true; reject(new Error("Close other ADO Boost workspace tabs to update local storage.")); };
      }).catch((error: unknown) => { this.database = null; throw error; });
    }
    return this.database;
  }

  private async transaction(storeName: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = operation(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error("Workspace storage transaction was aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("Workspace storage transaction failed"));
    });
  }
}
