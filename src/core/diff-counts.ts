import type { PullRequestAnalyzer } from "./analyzer";
import { buildLocalGroups } from "./grouping";
import type { DiffPolicy, PullRequestAnalysis } from "./types";

export class DiffCountController {
  private analysis: PullRequestAnalysis | null = null;
  private pending: AbortController | null = null;

  constructor(
    private readonly analyzer: Pick<PullRequestAnalyzer, "analyzeFiles">,
    private readonly changed: () => void,
    private readonly logger: Pick<Console, "warn"> = console
  ) {}

  setAnalysis(analysis: PullRequestAnalysis | null): void {
    this.pending?.abort();
    this.pending = null;
    this.analysis = analysis;
  }

  async update(policy: DiffPolicy): Promise<void> {
    const analysis = this.analysis;
    if (!analysis) return;
    if (!analysis.countsUpdating && analysis.diffPolicy?.ignoreTrimWhitespace === policy.ignoreTrimWhitespace) {
      analysis.diffPolicy = policy;
      this.changed();
      return;
    }
    this.pending?.abort();
    const controller = new AbortController();
    this.pending = controller;
    analysis.countsUpdating = true;
    this.changed();
    try {
      const result = await this.analyzer.analyzeFiles(analysis.context, controller.signal, policy.ignoreTrimWhitespace);
      if (controller.signal.aborted) return;
      analysis.files.splice(0, analysis.files.length, ...result.files);
      analysis.unresolvedChanges = result.unresolvedChanges;
      analysis.groups = buildLocalGroups(analysis.files);
      analysis.diffPolicy = policy;
    } catch (error) {
      if (controller.signal.aborted) return;
      this.logger.warn("ADO Boost could not refresh whitespace-aware diff counts", error);
      for (const file of analysis.files) {
        file.additions = null;
        file.deletions = null;
        file.state = "error";
        file.detail = error instanceof Error ? error.message : "Diff count refresh failed";
      }
    } finally {
      if (!controller.signal.aborted) {
        this.pending = null;
        analysis.countsUpdating = false;
        this.changed();
      }
    }
  }
}
