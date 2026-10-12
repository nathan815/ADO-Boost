import { AdoApi } from "../adapters/ado-api";
import type { BrowserStore } from "../adapters/browser";
import { countChangedLines, unavailableStat } from "./diff";
import { buildLocalGroups } from "./grouping";
import { reconcileReviewRecords } from "./review-state";
import type { ChangedFile, FileStat, PrRoute, PullRequestAnalysis } from "./types";

const FETCH_CONCURRENCY = 4;

async function mapConcurrent<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export class PullRequestAnalyzer {
  constructor(
    private readonly api: AdoApi,
    private readonly store: BrowserStore
  ) {}

  async analyze(route: PrRoute, signal?: AbortSignal): Promise<PullRequestAnalysis> {
    const context = await this.api.getContext(route, signal);
    const [changes, threads] = await Promise.all([
      this.api.getChanges(context, signal),
      this.api.getThreadOverview(context, signal)
    ]);
    const files = await mapConcurrent(changes, FETCH_CONCURRENCY, (change) => this.analyzeFile(context, change, signal));
    const reviewKey = this.reviewKey(context);
    const records = await this.store.getReviewRecords(reviewKey);
    const { retained } = reconcileReviewRecords(changes, records);
    if (retained.length !== records.length) await this.store.saveReviewRecords(reviewKey, retained);

    return {
      context,
      files,
      groups: buildLocalGroups(files),
      threads,
      completedTrackingIds: new Set(retained.map((record) => record.trackingId))
    };
  }

  reviewKey(context: PullRequestAnalysis["context"]): string {
    return `${context.organization}/${context.project}/${context.repositoryId}/${context.pullRequestId}`;
  }

  private async analyzeFile(
    context: PullRequestAnalysis["context"],
    change: ChangedFile,
    signal?: AbortSignal
  ): Promise<FileStat> {
    try {
      const type = change.changeType.toLowerCase();
      const beforePromise = type.includes("add")
        ? Promise.resolve(null)
        : this.api.getFileContent(context, change.originalPath ?? change.path, context.mergeBaseCommit, signal).catch(() => null);
      const afterPromise = type.includes("delete")
        ? Promise.resolve(null)
        : this.api.getFileContent(context, change.path, context.sourceCommit, signal).catch(() => null);
      const [before, after] = await Promise.all([beforePromise, afterPromise]);
      return countChangedLines(change, {
        before: before?.text ?? null,
        after: after?.text ?? null,
        ...(before ? { beforeSize: before.size } : {}),
        ...(after ? { afterSize: after.size } : {})
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      return unavailableStat(change, error instanceof Error ? error.message : "Diff analysis failed");
    }
  }
}
