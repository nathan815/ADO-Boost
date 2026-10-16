import type { BrowserStore } from "../adapters/browser";
import type { AdoApi } from "../adapters/ado-api";
import { AnnouncementService } from "../core/announcement";
import type { FileStat, PullRequestAnalysis, ReviewGroup } from "../core/types";
import type { FeatureSettings } from "../features/registry";
import { resolveFeature } from "../features/registry";
import type { SettingsService } from "../features/settings-service";
import type { WriteGateway } from "../core/write-gateway";
import type { CopilotGateway, CopilotHealth } from "../core/copilot-gateway";
import { validateSemanticGroups } from "../core/semantic-groups";
import type { SemanticGroupProposal } from "../core/types";
import { buildCopilotExcerpts, MAX_COPILOT_FILES } from "../core/diff-context";
import { DiffDialog } from "./diff-dialog";
import { DiscussionController } from "./discussion-controller";
import { panelStyles } from "./styles";
import { AnnouncementDialog } from "./announcement-dialog";
import { AdoPanelHeader, adoComponentStyles } from "./ado-panel-header";
import { ReviewPanelLayout } from "./review-panel-layout";
import { isTypingEvent } from "./keyboard";
import { PanelToast } from "./panel-toast";
import { ReviewCompletionMonitor } from "./review-completion-monitor";

interface ReviewPanelDependencies {
  analysis: PullRequestAnalysis;
  api: AdoApi;
  store: BrowserStore;
  settingsService: SettingsService;
  settings: FeatureSettings;
  reviewKey: string;
  writes: WriteGateway;
  copilot: CopilotGateway;
  openSettings: () => void;
  synthetic?: boolean;
}

export class ReviewPanel {
  private readonly host = document.createElement("div");
  private readonly root = this.host.attachShadow({ mode: "open" });
  private readonly toast = new PanelToast(this.root);
  private readonly layout: ReviewPanelLayout;
  private header: AdoPanelHeader | null = null;
  private readonly announcement: AnnouncementService;
  private readonly diffDialog: DiffDialog;
  private readonly discussion: DiscussionController;
  private readonly completionMonitor: ReviewCompletionMonitor;
  private settings: FeatureSettings;
  private open = false;
  private overlay = false;
  private destroyed = false;
  private announcementPosted = false;
  private announcementFinished = false;
  private completionSignature = "";
  private announcementError = "";
  private announcementDialog: AnnouncementDialog | null = null;
  private copilotGroups: ReviewGroup[] | null = null;
  private copilotHealth: CopilotHealth | null = null;
  private copilotBusy = false;
  private copilotError = "";
  private copilotAnswer = "";

  constructor(private readonly dependencies: ReviewPanelDependencies) {
    this.settings = dependencies.settings;
    this.completionMonitor = new ReviewCompletionMonitor(
      () => this.checkReviewCompletion(),
      (message) => {
        console.error("ADO Boost could not finish the review announcement:", message);
        this.toast.show(`Couldn't finish the review-start announcement: ${message}`);
      }
    );
    this.announcement = new AnnouncementService(dependencies.api, dependencies.store);
    this.diffDialog = new DiffDialog(dependencies.api, dependencies.analysis.context, (root, path, trackingId, line, side) => this.discussion.showInlineDraft(root, path, trackingId, line, side));
    this.discussion = new DiscussionController(dependencies.api, dependencies.store, dependencies.analysis, dependencies.writes, () => this.settings, () => this.render(), this.toast, () => this.completionMonitor.refresh());
    this.host.dataset.theme = dependencies.settings.presentation.theme;
    this.host.dataset.adoppReviewPanel = "true";
    this.layout = new ReviewPanelLayout(this.host);
    for (const type of ["keydown", "keypress", "keyup"]) this.root.addEventListener(type, this.onPanelKeyboardEvent);
    document.addEventListener("keydown", this.onKeyDown, true);
    if (resolveFeature(this.settings, "startReviewing").enabled) void this.loadAnnouncementStatus();
    void this.discussion.load();
    this.render();
  }

  updateSettings(settings: FeatureSettings): void {
    const threadsWereEnabled = resolveFeature(this.settings, "threadNavigator").enabled;
    const announcementsWereEnabled = resolveFeature(this.settings, "startReviewing").enabled;
    this.settings = settings;
    if (!resolveFeature(settings, "startReviewing").enabled) this.announcementDialog?.close();
    this.updateCompletionMonitor();
    this.host.dataset.theme = settings.presentation.theme;
    if (!settings.masterEnabled) {
      this.destroy();
      return;
    }
    if (!threadsWereEnabled && resolveFeature(settings, "threadNavigator").enabled) void this.discussion.loadThreads().then(() => this.render());
    if (!announcementsWereEnabled && resolveFeature(settings, "startReviewing").enabled) void this.loadAnnouncementStatus();
    this.render();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.announcementDialog?.close();
    this.discussion.destroy();
    this.completionMonitor.stop();
    this.header?.destroy();
    this.toast.destroy();
    document.removeEventListener("keydown", this.onKeyDown, true);
    for (const type of ["keydown", "keypress", "keyup"]) this.root.removeEventListener(type, this.onPanelKeyboardEvent);
    this.layout.destroy();
  }

  openDiscussions(): void {
    this.open = true;
    this.render();
    this.root.querySelector<HTMLElement>(".rail")?.focus();
  }

  startReviewing(): void {
    this.showAnnouncementDialog();
  }

  isReviewAnnounced(): boolean {
    return this.announcementPosted;
  }

  isReviewFinished(): boolean {
    return this.announcementFinished;
  }

  private async loadAnnouncementStatus(): Promise<void> {
    try {
      const record = await this.announcement.status(this.dependencies.analysis.context);
      if (this.destroyed || !resolveFeature(this.settings, "startReviewing").enabled) return;
      this.announcementPosted ||= record?.status === "posted";
      this.announcementFinished = record?.completions?.some((completion) => completion.status === "closed") ?? false;
      this.completionSignature = JSON.stringify(record?.completions ?? []);
      this.announcementError = "";
      this.updateCompletionMonitor();
      this.render();
      window.dispatchEvent(new CustomEvent("adopp:announcement-changed"));
    } catch (error) {
      if (this.destroyed || !resolveFeature(this.settings, "startReviewing").enabled) return;
      this.announcementError = error instanceof Error ? error.message : "Review announcement lookup failed";
      this.render();
    }
  }

  private updateCompletionMonitor(): void {
    if (!this.destroyed && this.announcementPosted && resolveFeature(this.settings, "startReviewing").enabled) this.completionMonitor.start();
    else this.completionMonitor.stop();
  }

  private async checkReviewCompletion(): Promise<boolean> {
    if (this.destroyed || !resolveFeature(this.settings, "startReviewing").enabled) return true;
    const record = await this.dependencies.writes.finishReview(this.dependencies.analysis.context);
    if (this.destroyed || !resolveFeature(this.settings, "startReviewing").enabled) return true;
    if (!record) return true;
    const signature = JSON.stringify(record.completions ?? []);
    if (signature === this.completionSignature) return false;
    this.completionSignature = signature;
    this.announcementFinished = record.completions?.some((completion) => completion.status === "closed") ?? false;
    if (resolveFeature(this.settings, "threadNavigator").enabled) await this.discussion.loadThreads();
    if (!this.destroyed) {
      this.render();
      window.dispatchEvent(new CustomEvent("adopp:announcement-changed"));
    }
    return false;
  }

  private render(): void {
    if (this.destroyed) return;
    const analysis = this.dependencies.analysis;
    const scrollTop = this.root.querySelector(".workspace")?.scrollTop ?? 0;
    this.header?.destroy();
    this.layout.update(this.open, this.overlay ? "overlay" : "inline");
    this.root.innerHTML = `
      <style>${adoComponentStyles}\n${panelStyles}</style>
      <aside class="rail" data-open="${this.open}" aria-label="ADO Boost review navigator" tabindex="-1" ${this.open ? "" : "inert"}>
        <header class="header"></header>
        <section class="summary" aria-label="Pull request review summary">
          <div class="metric"><b>${analysis.threads.active}</b><span>open</span></div>
          <div class="metric"><b>${analysis.threads.resolved}</b><span>resolved</span></div>
          <div class="metric"><b>${analysis.threads.total}</b><span>all threads</span></div>
        </section>
        <main class="workspace">
          ${this.unresolvedChangesMarkup()}
          ${this.announcementError ? `<div class="delivery error">${escapeHtml(this.announcementError)}. Announce Review Start will check again before posting.</div>` : ""}
          ${this.copilotMarkup()}
          ${resolveFeature(this.settings, "draftQueue").enabled || resolveFeature(this.settings, "threadNavigator").enabled ? this.discussion.markup() : ""}
        </main>
      </aside>
    `;
    this.header = new AdoPanelHeader(this.root.querySelector<HTMLElement>(".header")!);
    this.header.render({
      overlay: this.overlay,
      announcementEnabled: resolveFeature(this.settings, "startReviewing").enabled,
      announced: this.announcementPosted,
      finished: this.announcementFinished,
      subtitle: `${this.dependencies.synthetic ? "Synthetic offline fixture · " : ""}Iteration ${analysis.context.iterationId}`,
      onSettings: this.dependencies.openSettings,
      onLayoutChange: (overlay) => { this.overlay = overlay; this.render(); this.root.querySelector<HTMLElement>(".panel-layout-toggle")?.focus(); },
      onClose: () => this.closePanel(),
      onAnnounce: () => this.startReviewing()
    });
    this.bind();
    this.toast.mount();
    const workspace = this.root.querySelector(".workspace");
    if (workspace) workspace.scrollTop = scrollTop;
  }

  private closePanel(): void {
    this.toast.dismiss();
    this.open = false;
    this.render();
    document.querySelector<HTMLElement>(".adopp-start-button")?.focus();
  }

  private unresolvedChangesMarkup(): string {
    const entries = this.dependencies.analysis.unresolvedChanges ?? [];
    if (entries.length === 0) return "";
    return `<details class="delivery"><summary>${entries.length} unresolved changes retained. Diff totals are partial.</summary><ul>${entries.map((entry, index) =>
      `<li>${escapeHtml(entry.path ?? (entry.trackingId !== undefined ? `Change ${entry.trackingId}` : `Unresolved entry ${index + 1}`))}: ${escapeHtml(entry.detail)}</li>`
    ).join("")}</ul><p>Original response records are retained and logged in the page console.</p></details>`;
  }

  private bind(): void {
    this.discussion.bind(this.root);
    this.root.querySelector(".copilot-health")?.addEventListener("click", () => void this.checkCopilot());
    this.root.querySelector(".copilot-groups")?.addEventListener("click", () => this.showCopilotPrivacy("groups"));
    this.root.querySelector(".copilot-ask")?.addEventListener("click", () => this.showCopilotPrivacy("chat"));
    this.root.querySelector(".copilot-draft")?.addEventListener("click", () => this.discussion.showGeneralDraft(this.root, this.copilotAnswer));
  }

  private copilotMarkup(): string {
    const groupsEnabled = resolveFeature(this.settings, "copilotSemanticGroups").enabled;
    const chatEnabled = resolveFeature(this.settings, "copilotChat").enabled;
    if (!groupsEnabled && !chatEnabled) return "";
    const status = this.copilotHealth ? this.copilotHealth.authenticated ? `Connected${this.copilotHealth.login ? ` as ${escapeHtml(this.copilotHealth.login)}` : ""}` : `Needs login${this.copilotHealth.detail ? `: ${escapeHtml(this.copilotHealth.detail)}` : ""}` : "Not checked";
    return `<section class="copilot-panel"><div class="section-head"><div><h3>Local Copilot companion</h3><p class="muted">${status}. PR metadata is sent only after an explicit action and may use your configured model provider.</p></div><button class="secondary copilot-health" type="button" ${this.copilotBusy ? "disabled" : ""}>Check connection</button></div>${this.copilotError ? `<div class="delivery error">${escapeHtml(this.copilotError)}</div>` : ""}<div class="copilot-actions">${groupsEnabled ? `<button class="secondary copilot-groups" type="button" ${this.copilotBusy ? "disabled" : ""}>${this.copilotGroups ? "Use cached semantic groups" : "Group changes with Copilot"}</button>` : ""}</div>${chatEnabled ? `<textarea class="copilot-question" rows="3" placeholder="Ask a question about the PR file summary"></textarea><button class="secondary copilot-ask" type="button" ${this.copilotBusy ? "disabled" : ""}>Ask Copilot</button>${this.copilotAnswer ? `<div class="preview copilot-answer">${escapeHtml(this.copilotAnswer)}</div><button class="secondary copilot-draft" type="button">Use answer as feedback draft</button>` : ""}` : ""}</section>`;
  }

  private async checkCopilot(): Promise<void> {
    this.copilotBusy = true;
    this.copilotError = "";
    this.render();
    try {
      this.copilotHealth = await this.dependencies.copilot.health(this.dependencies.analysis.context);
    } catch (error) {
      this.copilotHealth = { connected: false, authenticated: false };
      this.copilotError = error instanceof Error ? error.message : "Copilot companion is unavailable";
    } finally {
      this.copilotBusy = false;
      this.render();
    }
  }

  private async loadCopilotGroups(files: FileStat[]): Promise<void> {
    this.copilotBusy = true;
    this.copilotError = "";
    this.render();
    try {
      const excerpts = await buildCopilotExcerpts(this.dependencies.api, this.dependencies.analysis.context, files);
      const proposals: SemanticGroupProposal[] = await this.dependencies.copilot.semanticGroups(this.dependencies.analysis.context, this.dependencies.analysis.files, excerpts, this.copilotGroups !== null);
      if (!this.host.isConnected) return;
      this.copilotGroups = validateSemanticGroups(this.dependencies.analysis.files, proposals);
    } catch (error) {
      this.copilotError = error instanceof Error ? error.message : "Copilot grouping failed";
    } finally {
      this.copilotBusy = false;
      this.render();
    }
  }

  private async askCopilot(files: FileStat[], question: string): Promise<void> {
    this.copilotBusy = true;
    this.copilotError = "";
    this.render();
    try {
      const excerpts = await buildCopilotExcerpts(this.dependencies.api, this.dependencies.analysis.context, files);
      const answer = await this.dependencies.copilot.chat(this.dependencies.analysis.context, this.dependencies.analysis.files, excerpts, question);
      if (!this.host.isConnected) return;
      this.copilotAnswer = answer;
    } catch (error) {
      this.copilotError = error instanceof Error ? error.message : "Copilot question failed";
    } finally {
      this.copilotBusy = false;
      this.render();
    }
  }

  private showCopilotPrivacy(action: "groups" | "chat"): void {
    const question = action === "chat" ? this.root.querySelector<HTMLTextAreaElement>(".copilot-question")?.value.trim() : "";
    if (action === "chat" && !question) return;
    const candidates = this.dependencies.analysis.files.slice(0, MAX_COPILOT_FILES);
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `<section class="dialog" role="dialog" aria-modal="true"><h3>Send bounded PR context to Copilot?</h3><p>ADO Boost will send the PR title, comparison identity, all changed-file paths and counts, plus changed-line excerpts only for the selected files below. Excerpts are capped at 20 files, 200 changed lines per file, 32 KB per file, and 128 KB total. Unselected, binary, unavailable, and truncated content is marked omitted.</p><div class="context-files">${candidates.map((file) => `<label><input type="checkbox" data-context-path="${escapeHtml(file.path)}" ${file.generated || file.lockfile ? "" : "checked"}> ${escapeHtml(file.path)}</label>`).join("")}</div><div class="dialog-actions"><button class="secondary cancel" type="button">Cancel</button><button class="primary confirm-context" type="button">${action === "groups" ? "Send and group changes" : "Send and ask question"}</button></div></section>`;
    this.root.append(backdrop);
    backdrop.querySelector(".cancel")?.addEventListener("click", () => backdrop.remove());
    backdrop.querySelector(".confirm-context")?.addEventListener("click", () => {
      const selected = new Set([...backdrop.querySelectorAll<HTMLInputElement>("[data-context-path]:checked")].map((input) => input.dataset.contextPath));
      const files = candidates.filter((file) => selected.has(file.path));
      backdrop.remove();
      if (action === "groups") void this.loadCopilotGroups(files);
      else void this.askCopilot(files, question!);
    });
  }

  private showAnnouncementDialog(): void {
    if (this.announcementPosted || !resolveFeature(this.settings, "startReviewing").enabled) return;
    this.announcementDialog ??= new AnnouncementDialog({
      pullRequestId: this.dependencies.analysis.context.pullRequestId,
      body: this.announcement.body(this.dependencies.analysis.context),
      onConfirm: async () => {
        const record = await this.dependencies.writes.postAnnouncement(this.dependencies.analysis.context);
        if (!this.host.isConnected) return;
        this.announcementPosted = true;
        this.announcementFinished = record?.completions?.some((completion) => completion.status === "closed") ?? false;
        this.completionSignature = JSON.stringify(record?.completions ?? []);
        this.updateCompletionMonitor();
        this.announcementError = "";
        this.render();
        window.dispatchEvent(new CustomEvent("adopp:announcement-changed"));
      },
      onClose: () => {
        this.announcementDialog = null;
        if (this.open) this.root.querySelector<HTMLElement>(".announce-review,.review-start-status")?.focus();
      }
    });
    this.announcementDialog.open();
  }

  private readonly onPanelKeyboardEvent = (event: Event): void => {
    // ADO sees the shadow host instead of the editor and treats typed letters as page shortcuts.
    event.stopPropagation();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.header?.closeLayoutMenu()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Escape" && this.open && !document.querySelector("[data-adopp-announcement-dialog]") && !this.root.querySelector(".dialog-backdrop")) {
      event.preventDefault();
      event.stopPropagation();
      this.closePanel();
      return;
    }
    if (!resolveFeature(this.settings, "keyboardShortcuts").enabled || isTypingEvent(event)) return;
    if (event.shiftKey && event.key.toLowerCase() === "r") {
      event.preventDefault();
      if (this.open) this.closePanel();
      else this.openDiscussions();
      return;
    }
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character] as string);
}
