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
    private readonly store: BrowserStore,
    private readonly logger: Pick<Console, "warn"> = console
  ) {}

  async analyze(route: PrRoute, signal?: AbortSignal): Promise<PullRequestAnalysis> {
    const context = await this.api.getContext(route, signal);
    const [changeResult, threads] = await Promise.all([
      this.api.getChangesWithDiagnostics(context, signal),
      this.api.getThreadOverview(context, signal)
    ]);
    const { files: changes, unresolvedChanges } = changeResult;
    const files = await mapConcurrent(changes, FETCH_CONCURRENCY, (change) => this.analyzeFile(context, change, signal));
    const reviewKey = this.reviewKey(context);
    const records = await this.store.getReviewRecords(reviewKey);
    const { retained } = reconcileReviewRecords(changes, records);
    if (unresolvedChanges.length === 0 && retained.length !== records.length) await this.store.saveReviewRecords(reviewKey, retained);

    return {
      context,
      files,
      unresolvedChanges,
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
        : this.fetchFileContent(context, change.originalPath ?? change.path, context.mergeBaseCommit, "base", signal);
      const afterPromise = type.includes("delete")
        ? Promise.resolve(null)
        : this.fetchFileContent(context, change.path, context.sourceCommit, "source", signal);
      const [before, after] = await Promise.all([beforePromise, afterPromise]);
      return countChangedLines(change, {
        before: before?.text ?? null,
        after: after?.text ?? null,
        ...(before ? { beforeSize: before.size } : {}),
        ...(after ? { afterSize: after.size } : {})
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      this.logger.warn("ADO Boost failed to analyze a file diff", { path: change.path, repositoryId: context.repositoryId, pullRequestId: context.pullRequestId }, error);
      return unavailableStat(change, error instanceof Error ? error.message : "Diff analysis failed");
    }
  }

  private async fetchFileContent(
    context: PullRequestAnalysis["context"],
    path: string,
    commit: string,
    side: "base" | "source",
    signal?: AbortSignal
  ): Promise<{ text: string; size: number } | null> {
    try {
      return await this.api.getFileContent(context, path, commit, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      this.logger.warn("ADO Boost could not fetch file content for diff analysis", {
        repositoryId: context.repositoryId,
        pullRequestId: context.pullRequestId,
        path,
        commit,
        side
      }, error);
      return null;
    }
  }
}
