import type { FileStat, ReviewGroup, SemanticGroupProposal } from "./types";

export function validateSemanticGroups(files: FileStat[], proposals: SemanticGroupProposal[], stale = false): ReviewGroup[] {
  if (proposals.length > 199) throw new Error("Copilot returned too many groups; the maximum is 199 plus unassigned changes.");
  const byPath = new Map(files.map((file) => [file.path, file]));
  const seen = new Set<string>();
  const groups: ReviewGroup[] = proposals.map((proposal, index) => {
    if (!proposal.title.trim() || proposal.title.length > 300 || proposal.rationale.length > 8000) {
      throw new Error(`Copilot group ${index + 1} has an invalid title or explanation.`);
    }
    const grouped = proposal.paths.map((path) => {
      const file = byPath.get(path);
      if (!file) throw new Error(`Copilot returned an unknown changed path: ${path}`);
      if (seen.has(path)) throw new Error(`Copilot returned a duplicate changed path: ${path}`);
      seen.add(path);
      return file;
    });
    if (!grouped.length) throw new Error(`Copilot group ${index + 1} contains no changed files`);
    return {
      id: `copilot:${index}:${proposal.title}`,
      title: proposal.title,
      rationale: proposal.rationale,
      source: "copilot",
      files: grouped
    };
  });
  const omitted = files.filter((file) => !seen.has(file.path));
  if (omitted.length) {
    groups.push({
      id: "copilot:omitted",
      title: "Unassigned changes",
      rationale: stale ? "New or unassigned files are kept visible until groups are regenerated." : "Copilot omitted these changed files, so ADO Boost kept them visible.",
      source: "local",
      files: omitted
    });
  }
  return groups;
}

export type SemanticView = { mode: "all" | "inline" | "group"; groupId: string | null };

export class SemanticGroupState {
  groups: ReviewGroup[] | null = null;
  view: SemanticView = { mode: "all", groupId: null };
  enabled = false;
  available = true;
  busy = false;
  stale = false;
  error = "";
  revision = 0;
  private request = 0;
  private inFlight = false;
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get processing(): boolean {
    return this.busy || this.inFlight;
  }

  setInFlight(inFlight: boolean): void {
    if (this.inFlight === inFlight) return;
    this.inFlight = inFlight;
    this.notify();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.clear();
    this.notify();
  }

  setAvailable(available: boolean): void {
    if (this.available === available) return;
    this.available = available;
    this.notify();
  }

  markStale(): void {
    if (!this.groups && !this.busy) return;
    this.request++;
    this.busy = false;
    this.stale = this.groups !== null;
    this.error = this.groups ? "" : "The PR changed while grouping. Generate again for the latest iteration.";
    this.notify();
  }

  updateComparison(files: FileStat[]): void {
    this.request++;
    this.busy = false;
    this.error = "";
    if (this.groups) {
      const byPath = new Map(files.map((file) => [file.path, file]));
      const assigned = new Set<string>();
      this.groups = this.groups.flatMap((group) => {
        const retained = group.files.flatMap((file) => {
          const current = byPath.get(file.path);
          if (!current) return [];
          assigned.add(file.path);
          return [current];
        });
        return retained.length ? [{ ...group, files: retained }] : [];
      });
      const unassigned = files.filter((file) => !assigned.has(file.path));
      if (unassigned.length) {
        const fallback = this.groups.find((group) => group.id === "copilot:omitted");
        if (fallback) fallback.files.push(...unassigned);
        else this.groups.push({
          id: "copilot:omitted", title: "Unassigned changes",
          rationale: "New or unassigned files are kept visible until groups are regenerated.",
          source: "local", files: unassigned
        });
      }
      this.stale = true;
      this.revision++;
      if (!this.groups.length || (this.view.mode === "group" && !this.groups.some((group) => group.id === this.view.groupId))) {
        this.view = { mode: this.groups.length ? "inline" : "all", groupId: null };
      }
    }
    this.notify();
  }

  select(view: SemanticView): void {
    if (!this.enabled || !this.available || (view.mode !== "all" && !this.groups?.length)) return;
    if (view.mode === "group" && !this.groups?.some((group) => group.id === view.groupId)) return;
    this.view = { mode: view.mode, groupId: view.mode === "group" ? view.groupId : null };
    this.notify();
  }

  begin(): number {
    if (!this.enabled || this.busy) throw new Error("Semantic grouping is not available for this comparison.");
    this.busy = true;
    this.error = "";
    const request = ++this.request;
    this.notify();
    return request;
  }

  isCurrent(request: number): boolean {
    return this.enabled && request === this.request;
  }

  complete(request: number, groups: ReviewGroup[], stale = false): void {
    if (!this.isCurrent(request)) return;
    this.groups = groups;
    this.stale = stale;
    this.revision++;
    this.view = { mode: "inline", groupId: null };
    this.busy = false;
    this.notify();
  }

  fail(request: number, error: string): void {
    if (!this.isCurrent(request)) return;
    this.error = error;
    this.busy = false;
    this.notify();
  }

  private clear(): void {
    this.request++;
    this.groups = null;
    this.stale = false;
    this.view = { mode: "all", groupId: null };
    this.busy = false;
    this.error = "";
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
