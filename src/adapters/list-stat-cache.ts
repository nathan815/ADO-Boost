import {
  LIST_STAT_CACHE_VERSION,
  type PullRequestListStat,
  type PullRequestListStatStore
} from "../core/list-stats";

const KEY_PREFIX = `pr-list-stat:v${LIST_STAT_CACHE_VERSION}:`;
const LAST_PRUNED_KEY = `pr-list-stat:last-pruned:v${LIST_STAT_CACHE_VERSION}`;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class ChromePullRequestListStatStore implements PullRequestListStatStore {
  async get(key: string): Promise<PullRequestListStat | null> {
    const storageKey = cacheKey(key);
    const values = await chrome.storage.local.get(storageKey);
    const value = values[storageKey];
    if (isPullRequestListStat(value)) return value;
    if (value !== undefined) await chrome.storage.local.remove(storageKey);
    return null;
  }

  async save(key: string, stat: PullRequestListStat): Promise<void> {
    await chrome.storage.local.set({ [cacheKey(key)]: stat });
  }

  async prune(options: { maxAgeMs: number; maxEntries: number; now: Date }): Promise<void> {
    const marker = await chrome.storage.local.get(LAST_PRUNED_KEY);
    const lastPruned = marker[LAST_PRUNED_KEY];
    if (typeof lastPruned === "number" && options.now.getTime() - lastPruned < PRUNE_INTERVAL_MS) return;
    const values = await chrome.storage.local.get(null);
    const entries = Object.entries(values)
      .filter(([key]) => key.startsWith(KEY_PREFIX))
      .map(([key, value]) => ({ key, stat: isPullRequestListStat(value) ? value : null }));
    const cutoff = options.now.getTime() - options.maxAgeMs;
    const valid = entries
      .filter((entry): entry is { key: string; stat: PullRequestListStat } => entry.stat !== null)
      .sort((left, right) => Date.parse(right.stat.validatedAt) - Date.parse(left.stat.validatedAt));
    const remove = [
      ...entries.filter((entry) => entry.stat === null).map((entry) => entry.key),
      ...valid.filter((entry, index) => Date.parse(entry.stat.validatedAt) < cutoff || index >= options.maxEntries).map((entry) => entry.key)
    ];
    await chrome.storage.local.set({ [LAST_PRUNED_KEY]: options.now.getTime() });
    if (remove.length > 0) await chrome.storage.local.remove(remove);
  }
}

export class MemoryPullRequestListStatStore implements PullRequestListStatStore {
  private readonly entries = new Map<string, PullRequestListStat>();

  async get(key: string): Promise<PullRequestListStat | null> {
    return this.entries.get(key) ?? null;
  }

  async save(key: string, stat: PullRequestListStat): Promise<void> {
    this.entries.set(key, stat);
  }

  async prune(options: { maxAgeMs: number; maxEntries: number; now: Date }): Promise<void> {
    const cutoff = options.now.getTime() - options.maxAgeMs;
    const sorted = [...this.entries.entries()]
      .sort((left, right) => Date.parse(right[1].validatedAt) - Date.parse(left[1].validatedAt));
    for (const [index, [key, stat]] of sorted.entries()) {
      if (Date.parse(stat.validatedAt) < cutoff || index >= options.maxEntries) this.entries.delete(key);
    }
  }
}

function cacheKey(key: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(key)}`;
}

function isPullRequestListStat(value: unknown): value is PullRequestListStat {
  if (!value || typeof value !== "object") return false;
  const stat = value as Partial<PullRequestListStat>;
  return stat.version === LIST_STAT_CACHE_VERSION
    && Number.isFinite(stat.additions)
    && Number.isFinite(stat.deletions)
    && typeof stat.exact === "boolean"
    && Number.isInteger(stat.fileCount)
    && Number.isInteger(stat.iterationId)
    && typeof stat.sourceCommit === "string"
    && typeof stat.targetCommit === "string"
    && typeof stat.mergeBaseCommit === "string"
    && typeof stat.calculatedAt === "string"
    && Number.isFinite(Date.parse(stat.calculatedAt))
    && typeof stat.validatedAt === "string"
    && Number.isFinite(Date.parse(stat.validatedAt));
}
