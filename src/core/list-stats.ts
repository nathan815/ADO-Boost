import type { AdoApi } from "../adapters/ado-api";
import type { PullRequestAnalyzer } from "./analyzer";
import { totalStats } from "./diff";
import type { PrRoute, PullRequestComparison } from "./types";

export const LIST_STAT_CACHE_VERSION = 2;
export const LIST_STAT_VALIDATION_TTL_MS = 5 * 60 * 1000;
export const LIST_STAT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const LIST_STAT_MAX_ENTRIES = 5_000;

export interface PullRequestListStat {
  ignoreTrimWhitespace: boolean;
  version: typeof LIST_STAT_CACHE_VERSION;
  additions: number;
  deletions: number;
  exact: boolean;
  fileCount: number;
  iterationId: number;
  sourceCommit: string;
  targetCommit: string;
  mergeBaseCommit: string;
  calculatedAt: string;
  validatedAt: string;
}

export interface PullRequestListStatStore {
  get(key: string): Promise<PullRequestListStat | null>;
  save(key: string, stat: PullRequestListStat): Promise<void>;
  prune(options: { maxAgeMs: number; maxEntries: number; now: Date }): Promise<void>;
}

export type PullRequestListStatResolution = {
  stat: PullRequestListStat;
  freshness: "fresh" | "validated" | "recalculated";
} | {
  stat: PullRequestListStat;
  freshness: "unverified";
  error: string;
};

export class PullRequestListStatService {
  private readonly memory = new Map<string, PullRequestListStat>();
  private readonly inFlight = new Map<string, {
    signal: AbortSignal | undefined;
    promise: Promise<PullRequestListStatResolution>;
  }>();

  constructor(
    private readonly api: Pick<AdoApi, "getLatestComparison">,
    private readonly analyzer: Pick<PullRequestAnalyzer, "analyzeFiles">,
    private readonly store: PullRequestListStatStore,
    private readonly now: () => Date = () => new Date(),
    private readonly validationTtlMs = LIST_STAT_VALIDATION_TTL_MS,
    private readonly ignoreTrimWhitespace: () => boolean | null = () => true
  ) {}

  key(route: PrRoute, ignoreTrimWhitespace = this.ignoreTrimWhitespace()): string {
    return `${route.origin}/${route.organization}/${route.project}/${route.repository}/${route.pullRequestId}/ignore-trim:${ignoreTrimWhitespace}`;
  }

  peek(route: PrRoute): PullRequestListStat | null {
    if (this.ignoreTrimWhitespace() === null) return null;
    return this.memory.get(this.key(route)) ?? null;
  }

  async getCached(route: PrRoute): Promise<PullRequestListStat | null> {
    if (this.ignoreTrimWhitespace() === null) return null;
    const key = this.key(route);
    const memory = this.memory.get(key);
    if (memory) return memory;
    const stored = await this.store.get(key);
    if (stored) this.memory.set(key, stored);
    return stored;
  }

  isFresh(stat: PullRequestListStat): boolean {
    const validatedAt = Date.parse(stat.validatedAt);
    return Number.isFinite(validatedAt) && this.now().getTime() - validatedAt < this.validationTtlMs;
  }

  resolve(route: PrRoute, cached: PullRequestListStat | null, signal?: AbortSignal): Promise<PullRequestListStatResolution> {
    const key = this.key(route);
    const existing = this.inFlight.get(key);
    if (existing && !existing.signal?.aborted) return existing.promise;
    const promise = this.resolveOnce(route, cached, signal).finally(() => {
      if (this.inFlight.get(key)?.promise === promise) this.inFlight.delete(key);
    });
    this.inFlight.set(key, { signal, promise });
    return promise;
  }

  private async resolveOnce(route: PrRoute, cached: PullRequestListStat | null, signal?: AbortSignal): Promise<PullRequestListStatResolution> {
    const ignoreTrimWhitespace = this.ignoreTrimWhitespace();
    if (ignoreTrimWhitespace === null) throw new Error("ADO whitespace setting unavailable");
    if (cached?.ignoreTrimWhitespace !== ignoreTrimWhitespace) cached = null;
    if (cached && this.isFresh(cached)) return { stat: cached, freshness: "fresh" };
    let comparison: PullRequestComparison;
    try {
      comparison = await this.api.getLatestComparison(route, signal);
    } catch (error) {
      if (!cached || signal?.aborted) throw error;
      return {
        stat: cached,
        freshness: "unverified",
        error: error instanceof Error ? error.message : "Unable to validate cached PR stats"
      };
    }
    if (cached && comparisonMatches(cached, comparison)) {
      const validated = { ...cached, validatedAt: this.now().toISOString() };
      await this.save(route, validated);
      return { stat: validated, freshness: "validated" };
    }
    const analysis = await this.analyzer.analyzeFiles(comparison, signal, ignoreTrimWhitespace);
    const totals = totalStats(analysis.files, analysis.unresolvedChanges.length);
    const timestamp = this.now().toISOString();
    const stat: PullRequestListStat = {
      ignoreTrimWhitespace,
      version: LIST_STAT_CACHE_VERSION,
      additions: totals.additions,
      deletions: totals.deletions,
      exact: totals.exact,
      fileCount: analysis.files.length,
      iterationId: comparison.iterationId,
      sourceCommit: comparison.sourceCommit,
      targetCommit: comparison.targetCommit,
      mergeBaseCommit: comparison.mergeBaseCommit,
      calculatedAt: timestamp,
      validatedAt: timestamp
    };
    await this.save(route, stat);
    return { stat, freshness: "recalculated" };
  }

  async prune(): Promise<void> {
    await this.store.prune({
      maxAgeMs: LIST_STAT_MAX_AGE_MS,
      maxEntries: LIST_STAT_MAX_ENTRIES,
      now: this.now()
    });
  }

  private async save(route: PrRoute, stat: PullRequestListStat): Promise<void> {
    const key = this.key(route, stat.ignoreTrimWhitespace);
    this.memory.set(key, stat);
    await this.store.save(key, stat);
  }
}

function comparisonMatches(stat: PullRequestListStat, comparison: PullRequestComparison): boolean {
  return stat.iterationId === comparison.iterationId
    && stat.sourceCommit === comparison.sourceCommit
    && stat.targetCommit === comparison.targetCommit
    && stat.mergeBaseCommit === comparison.mergeBaseCommit;
}
