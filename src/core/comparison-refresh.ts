import type { AdoApi } from "../adapters/ado-api";
import type { PullRequestAnalyzer } from "./analyzer";
import { buildLocalGroups } from "./grouping";
import type { DiffPolicy, PullRequestAnalysis } from "./types";

interface ComparisonRefreshDependencies {
  analysis: PullRequestAnalysis;
  api: Pick<AdoApi, "getContext">;
  analyzer: Pick<PullRequestAnalyzer, "analyzeFiles">;
  signal: AbortSignal;
  policy: () => DiffPolicy;
  markStale: () => void;
  apply: (analysis: PullRequestAnalysis) => void;
}

export class ComparisonRefresh {
  private pending: Promise<void> | null = null;
  private applying = false;
  private detectedIdentity: string;

  constructor(private readonly dependencies: ComparisonRefreshDependencies) {
    this.detectedIdentity = dependencies.analysis.context.identity;
  }

  refresh(apply = true): Promise<void> {
    if (this.dependencies.signal.aborted) return Promise.resolve();
    if (this.pending) return apply && !this.applying ? this.pending.then(() => this.refresh(true)) : this.pending;
    this.applying = apply;
    this.pending = this.load(apply).catch((error: unknown) => {
      if (!this.dependencies.signal.aborted) throw error;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }

  private async load(apply: boolean): Promise<void> {
    const { analysis, api, analyzer, signal, policy, markStale } = this.dependencies;
    const context = await api.getContext(analysis.context, signal);
    if (signal.aborted || context.identity === analysis.context.identity) return;
    if (context.iterationId < analysis.context.iterationId) throw new Error("Azure DevOps returned an older PR iteration. Try refreshing again.");
    if (!apply) {
      if (context.identity !== this.detectedIdentity) {
        this.detectedIdentity = context.identity;
        markStale();
      }
      return;
    }
    this.detectedIdentity = context.identity;
    const diffPolicy = policy();
    const result = await analyzer.analyzeFiles(context, signal, diffPolicy.ignoreTrimWhitespace);
    if (signal.aborted) return;
    this.dependencies.apply({
      ...analysis, context, files: result.files, unresolvedChanges: result.unresolvedChanges,
      groups: buildLocalGroups(result.files), diffPolicy, countsUpdating: false
    });
  }
}
