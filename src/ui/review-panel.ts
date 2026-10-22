import type { BrowserStore } from "../adapters/browser";
import type { AdoApi } from "../adapters/ado-api";
import { AnnouncementService } from "../core/announcement";
import type { FileStat, PullRequestAnalysis } from "../core/types";
import type { FeatureSettings } from "../features/registry";
import { resolveFeature } from "../features/registry";
import type { SettingsService } from "../features/settings-service";
import type { WriteGateway } from "../core/write-gateway";
import type { CopilotGateway, CopilotGroupResult } from "../core/copilot-gateway";
import { SemanticGroupState, validateSemanticGroups } from "../core/semantic-groups";
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
import { adoFileUrl, navigateToAdoFile } from "./ado-navigation";
import { CompanionStatus } from "./companion-status";

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
  semanticGroups?: SemanticGroupState;
  refreshComparison?: () => Promise<void>;
}

type PanelTab = "discussions" | "groups" | "chat";

export class ReviewPanel {
  private readonly host = document.createElement("div");
  private readonly root = this.host.attachShadow({ mode: "open" });
  private readonly toast = new PanelToast(this.root);
  private readonly layout: ReviewPanelLayout;
  private header: AdoPanelHeader | null = null;
  private readonly announcement: AnnouncementService;
  private diffDialog: DiffDialog;
  private readonly discussion: DiscussionController;
  private readonly completionMonitor: ReviewCompletionMonitor;
  private settings: FeatureSettings;
  private open = false;
  private activeTab: PanelTab = "discussions";
  private readonly tabScroll = { discussions: 0, groups: 0, chat: 0 };
  private overlay = false;
  private destroyed = false;
  private announcementPosted = false;
  private announcementFinished = false;
  private completionSignature = "";
  private announcementError = "";
  private announcementDialog: AnnouncementDialog | null = null;
  private readonly semanticGroups: SemanticGroupState;
  private readonly unsubscribeSemantic: () => void;
  private get copilotGroups() { return this.semanticGroups.groups; }
  private readonly companionStatus: CompanionStatus;
  private copilotBusy = false;
  private get copilotGrouping() { return this.semanticGroups.processing; }
  private copilotError = "";
  private copilotChatError = "";
  private copilotAnswer = "";
  private copilotQuestion = "";
  private copilotGroupResult: CopilotGroupResult | null = null;
  private cachedGroupsRequest = 0;
  private groupConfirmation: HTMLDialogElement | null = null;
  private savingGroupingPreference = false;

  constructor(private readonly dependencies: ReviewPanelDependencies) {
    this.companionStatus = new CompanionStatus(() => dependencies.copilot.health(dependencies.analysis.context), document);
    this.settings = dependencies.settings;
    this.semanticGroups = dependencies.semanticGroups ?? new SemanticGroupState();
    this.semanticGroups.setEnabled(resolveFeature(this.settings, "copilotSemanticGroups").enabled);
    let groupsAvailable = this.semanticGroups.enabled && this.semanticGroups.available;
    this.unsubscribeSemantic = this.semanticGroups.subscribe(() => {
      const available = this.semanticGroups.enabled && this.semanticGroups.available;
      const restore = available && !groupsAvailable;
      groupsAvailable = available;
      if (!available) this.cachedGroupsRequest++;
      this.render();
      if (restore) void this.restoreCachedCopilotGroups(false, this.semanticGroups.stale);
    });
    this.completionMonitor = new ReviewCompletionMonitor(
      () => this.checkReviewCompletion(),
      (message, error) => {
        console.error("ADO Boost review completion check failed:", message, error instanceof Error ? error.cause ?? error : error);
        this.toast.show(`Couldn't check review completion: ${message}`);
      }
    );
    this.announcement = new AnnouncementService(dependencies.api, dependencies.store);
    const initialContext = dependencies.analysis.context;
    this.diffDialog = new DiffDialog(dependencies.api, initialContext, (root, path, trackingId, line, side) => this.discussion.showInlineDraft(root, path, trackingId, line, side, initialContext));
    this.discussion = new DiscussionController(dependencies.api, dependencies.store, dependencies.analysis, dependencies.writes, () => this.settings, () => this.render(), this.toast, () => this.completionMonitor.refresh());
    this.host.dataset.theme = dependencies.settings.presentation.theme;
    this.host.dataset.adoppReviewPanel = "true";
    this.layout = new ReviewPanelLayout(this.host);
    for (const type of ["keydown", "keypress", "keyup"]) this.root.addEventListener(type, this.onPanelKeyboardEvent);
    document.addEventListener("keydown", this.onKeyDown, true);
    if (resolveFeature(this.settings, "startReviewing").enabled) void this.loadAnnouncementStatus();
    void this.discussion.load();
    this.render();
    void this.restoreCachedCopilotGroups(true);
  }

  updateSettings(settings: FeatureSettings): void {
    const threadsWereEnabled = resolveFeature(this.settings, "threadNavigator").enabled;
    const announcementsWereEnabled = resolveFeature(this.settings, "startReviewing").enabled;
    this.settings = settings;
    this.semanticGroups.setEnabled(resolveFeature(settings, "copilotSemanticGroups").enabled);
    if (!this.semanticGroups.enabled) {
      this.groupConfirmation?.close();
      this.groupConfirmation?.remove();
      this.groupConfirmation = null;
    }
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
    this.groupConfirmation?.close();
    this.groupConfirmation = null;
    this.unsubscribeSemantic();
    this.semanticGroups.setEnabled(false);
    this.announcementDialog?.close();
    this.discussion.destroy();
    this.completionMonitor.stop();
    this.companionStatus.destroy();
    this.header?.destroy();
    this.toast.destroy();
    document.removeEventListener("keydown", this.onKeyDown, true);
    for (const type of ["keydown", "keypress", "keyup"]) this.root.removeEventListener(type, this.onPanelKeyboardEvent);
    this.layout.destroy();
  }

  openDiscussions(): void {
    this.selectTab("discussions");
    this.open = true;
    this.render();
    this.root.querySelector<HTMLElement>(".rail")?.focus();
  }

  openCopilotGroups(): void {
    if (this.destroyed || !resolveFeature(this.settings, "copilotSemanticGroups").enabled) return;
    this.selectTab("groups");
    this.tabScroll.groups = 0;
    this.open = true;
    this.render();
    this.root.querySelector<HTMLButtonElement>("#groups-tab")?.focus();
  }

  async toggleGroupingPreference(feature: "autoGenerateCopilotGroups" | "confirmCopilotGroups"): Promise<void> {
    if (this.destroyed || this.savingGroupingPreference) return;
    this.savingGroupingPreference = true;
    const next = { ...this.settings, features: { ...this.settings.features, [feature]: !this.settings.features[feature] } };
    try {
      await this.dependencies.settingsService.save(next);
      if (!this.destroyed) this.updateSettings(next);
    } catch (error) {
      console.error("ADO Boost could not save grouping preference", error);
      this.toast.show(error instanceof Error ? error.message : "Could not save grouping preference");
    } finally {
      this.savingGroupingPreference = false;
    }
  }

  updateComparison(analysis: PullRequestAnalysis): void {
    if (this.destroyed || analysis.context.identity === this.dependencies.analysis.context.identity) return;
    this.cachedGroupsRequest++;
    Object.assign(this.dependencies.analysis, analysis);
    this.discussion.updateComparison();
    const context = analysis.context;
    this.diffDialog = new DiffDialog(this.dependencies.api, context,
      (root, path, trackingId, line, side) => this.discussion.showInlineDraft(root, path, trackingId, line, side, context));
    this.semanticGroups.updateComparison(analysis.files);
    this.copilotError = "";
    this.render();
    void this.restoreCachedCopilotGroups(false, true);
  }

  reportComparisonError(error: unknown): void {
    if (this.destroyed) return;
    this.copilotError = error instanceof Error ? error.message : "Couldn't refresh the pull request comparison";
    this.render();
  }

  requestSemanticGroups(): void {
    if (this.destroyed || this.copilotBusy || this.groupConfirmation || !this.semanticGroups.enabled) return;
    if (this.settings.features.confirmCopilotGroups) {
      this.showGroupConfirmation();
    } else void this.loadCopilotGroups(this.dependencies.analysis.files);
  }

  private selectTab(tab: PanelTab): void {
    this.tabScroll[this.activeTab] = this.root.querySelector(".workspace")?.scrollTop ?? 0;
    this.activeTab = tab;
  }

  startReviewing(): void {
    this.showAnnouncementDialog();
  }

  triggerTestToast(): void {
    this.toast.show("This is a test notification. It stays visible until dismissed with X. No Azure DevOps request was made.");
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
    const groupsEnabled = resolveFeature(this.settings, "copilotSemanticGroups").enabled;
    const chatEnabled = resolveFeature(this.settings, "copilotChat").enabled;
    if (this.activeTab === "groups" && !groupsEnabled || this.activeTab === "chat" && !chatEnabled) this.selectTab("discussions");
    const scrollTop = this.tabScroll[this.activeTab];
    const dialogs = [...this.root.children].filter((element): element is HTMLElement => element instanceof HTMLElement
      && element.matches(".dialog-backdrop") && element !== this.groupConfirmation);
    const dialogFocus = dialogs.some((dialog) => dialog.contains(this.root.activeElement)) ? this.root.activeElement : null;
    for (const dialog of dialogs) dialog.remove();
    const confirmationFocus = this.groupConfirmation?.contains(this.root.activeElement) ? this.root.activeElement : null;
    this.groupConfirmation?.close();
    this.companionStatus.detach();
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
        <nav class="panel-tabs" role="tablist" aria-label="Review views">
          <button id="discussions-tab" type="button" role="tab" aria-controls="discussions-panel" aria-selected="${this.activeTab === "discussions"}" tabindex="${this.activeTab === "discussions" ? 0 : -1}" data-panel-tab="discussions">Discussions</button>
          ${groupsEnabled ? `<button id="groups-tab" type="button" role="tab" aria-controls="groups-panel" aria-selected="${this.activeTab === "groups"}" tabindex="${this.activeTab === "groups" ? 0 : -1}" data-panel-tab="groups">Copilot Groups${this.copilotGrouping ? '<span class="grouping-spinner" aria-hidden="true"></span><span class="sr-only">Generating...</span>' : ""}</button>` : ""}
          ${chatEnabled ? `<button id="chat-tab" type="button" role="tab" aria-controls="chat-panel" aria-selected="${this.activeTab === "chat"}" tabindex="${this.activeTab === "chat" ? 0 : -1}" data-panel-tab="chat">Chat</button>` : ""}
        </nav>
        <main class="workspace">
          ${this.unresolvedChangesMarkup()}
          ${this.announcementError ? `<div class="delivery error">${escapeHtml(this.announcementError)}. Announce Review Start will check again before posting.</div>` : ""}
          ${groupsEnabled ? `<div id="groups-panel" role="tabpanel" aria-labelledby="groups-tab" ${this.activeTab === "groups" ? "" : "hidden"}>${this.copilotGroupsPanelMarkup()}</div>` : ""}
          ${chatEnabled ? `<div id="chat-panel" role="tabpanel" aria-labelledby="chat-tab" ${this.activeTab === "chat" ? "" : "hidden"}>${this.copilotChatMarkup()}</div>` : ""}
          <div id="discussions-panel" role="tabpanel" aria-labelledby="discussions-tab" ${this.activeTab === "discussions" ? "" : "hidden"}>
          ${resolveFeature(this.settings, "draftQueue").enabled || resolveFeature(this.settings, "threadNavigator").enabled ? this.discussion.markup() : ""}
          </div>
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
      companionEnabled: groupsEnabled || chatEnabled,
      onSettings: this.dependencies.openSettings,
      onLayoutChange: (overlay) => { this.overlay = overlay; this.render(); this.root.querySelector<HTMLElement>(".panel-layout-toggle")?.focus(); },
      onClose: () => this.closePanel(),
      onAnnounce: () => this.startReviewing()
    });
    this.bind();
    const statusSlot = this.root.querySelector<HTMLElement>(".companion-status-slot");
    this.companionStatus.mount(statusSlot);
    if (this.open && statusSlot) this.companionStatus.checkOnce();
    this.toast.mount();
    this.root.append(...dialogs);
    if (dialogFocus instanceof HTMLElement) dialogFocus.focus();
    if (this.groupConfirmation) {
      this.root.append(this.groupConfirmation);
      this.groupConfirmation.showModal();
      if (confirmationFocus instanceof HTMLElement) confirmationFocus.focus();
    }
    const workspace = this.root.querySelector(".workspace");
    if (workspace) workspace.scrollTop = scrollTop;
    workspace?.addEventListener("scroll", () => { this.tabScroll[this.activeTab] = workspace.scrollTop; }, { passive: true });
  }

  private closePanel(): void {
    this.companionStatus.close();
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
    for (const tab of this.root.querySelectorAll<HTMLButtonElement>("[data-panel-tab]")) {
      const activate = (target: HTMLButtonElement) => {
        this.selectTab(target.dataset.panelTab === "chat" ? "chat" : target.dataset.panelTab === "groups" ? "groups" : "discussions");
        this.render();
        this.root.querySelector<HTMLButtonElement>(`[data-panel-tab="${this.activeTab}"]`)?.focus();
      };
      tab.addEventListener("click", () => activate(tab));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const tabs = [...this.root.querySelectorAll<HTMLButtonElement>("[data-panel-tab]")];
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (tabs.indexOf(tab) + direction + tabs.length) % tabs.length;
        activate(tabs[index]!);
      });
    }
    this.root.querySelector(".copilot-groups")?.addEventListener("click", () => this.requestSemanticGroups());
    this.root.querySelector<HTMLTextAreaElement>(".copilot-question")?.addEventListener("input", (event) => {
      this.copilotQuestion = (event.target as HTMLTextAreaElement).value;
    });
    this.root.querySelector(".copilot-ask")?.addEventListener("click", () => this.showCopilotPrivacy());
    this.root.querySelector(".copilot-draft")?.addEventListener("click", () => {
      this.selectTab("discussions");
      this.discussion.showGeneralDraft(this.root, this.copilotAnswer);
    });
    for (const link of this.root.querySelectorAll<HTMLAnchorElement>("[data-copilot-path]")) {
      link.addEventListener("click", (event) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        void navigateToAdoFile(link.dataset.copilotPath!).catch((error: unknown) => {
          this.toast.show(error instanceof Error ? error.message : "Couldn't open this file in Azure DevOps.");
        });
      });
    }
  }

  private copilotGroupsPanelMarkup(): string {
    const comparisonNotice = !this.semanticGroups.available
      ? '<p class="delivery" role="status">Choose the latest All Changes comparison to apply groups to the file tree.</p>' : "";
    const staleNotice = this.semanticGroups.stale ? '<p class="delivery" role="status">Groups are stale. Regenerate for the latest iteration.</p>' : "";
    const error = this.copilotError || this.semanticGroups.error;
    return `<section class="copilot-panel" aria-busy="${this.copilotGrouping}">${error ? `<div class="delivery error" role="alert">${escapeHtml(error)}</div>` : ""}${comparisonNotice}${staleNotice}${this.copilotSessionMarkup()}<button class="${this.copilotGroups ? "secondary" : "primary"} copilot-groups" type="button" ${this.copilotBusy ? "disabled" : ""}>${this.copilotGrouping ? '<span class="grouping-spinner" aria-hidden="true"></span>Grouping changes...' : this.copilotGroups ? "Regenerate" : "Generate"}</button>${this.copilotGroupsMarkup()}</section>`;
  }

  private copilotChatMarkup(): string {
    return `<section class="copilot-panel copilot-chat" aria-busy="${this.copilotBusy && !this.copilotGrouping}">${this.copilotChatError ? `<div class="delivery error" role="alert">${escapeHtml(this.copilotChatError)}</div>` : ""}<textarea class="copilot-question" rows="3" placeholder="Ask a question about the PR file summary">${escapeHtml(this.copilotQuestion)}</textarea><button class="secondary copilot-ask" type="button" ${this.copilotBusy ? "disabled" : ""}>Ask Copilot</button>${this.copilotAnswer ? `<div class="preview copilot-answer">${escapeHtml(this.copilotAnswer)}</div><button class="secondary copilot-draft" type="button">Use answer as feedback draft</button>` : ""}</section>`;
  }

  private copilotGroupsMarkup(): string {
    if (this.copilotGrouping && !this.copilotGroups) return `<p class="muted" role="status">Grouping changes with Copilot...</p>`;
    if (!this.copilotGroups) return "";
    const fileCount = this.copilotGroups.reduce((count, group) => count + group.files.length, 0);
    return `<section class="copilot-results" aria-label="Semantic groups"><p class="muted" role="status">${this.copilotGroups.length} groups, ${fileCount} files</p>${this.copilotGroups.map((group) =>
      `<details class="copilot-result" open><summary>${escapeHtml(group.title)} <span class="group-count">(${group.files.length})</span></summary><p class="group-note">${escapeHtml(group.rationale)}</p><ul>${group.files.map((file) =>
        `<li><a class="file-link" data-copilot-path="${escapeHtml(file.path)}" href="${escapeHtml(adoFileUrl(file.path))}">${escapeHtml(file.path)}</a></li>`
      ).join("")}</ul></details>`
    ).join("")}</section>`;
  }

  private copilotSessionMarkup(): string {
    const result = this.copilotGroups ? this.copilotGroupResult : null;
    if (!result) return "";
    const header = `<div class="section-head"><h3 title="Latest completed grouping session. Each generation uses a separate session.">Session</h3>${result.cached ? '<span class="status" title="Restored from cache. No new model request.">Cached</span>' : ""}</div>`;
    const generated = result.generation;
    const metadata = `<p class="copilot-generation">Iteration ${generated?.iterationId ?? (this.semanticGroups.stale ? "unknown" : this.dependencies.analysis.context.iterationId)} / ${generated ? `<time datetime="${escapeHtml(generated.generatedAt)}">${escapeHtml(new Date(generated.generatedAt).toLocaleString())}</time>` : "Time not recorded"}</p>`;
    const session = result.session;
    if (!session) return `<section class="copilot-session" aria-label="Copilot grouping session">${header}${metadata}<p class="muted copilot-session-unavailable">Session info unavailable.</p></section>`;
    const tokens = (value: number | null | undefined) => value == null ? "Not reported" : value.toLocaleString();
    const total = session.inputTokens != null && session.outputTokens != null ? session.inputTokens + session.outputTokens : null;
    const model = session.models.length ? session.models.map(escapeHtml).join(", ") : "Not reported";
    return `<section class="copilot-session" aria-label="Copilot grouping session">${header}${metadata}<dl><div><dt>Session ID</dt><dd><code>${escapeHtml(session.sessionId)}</code></dd></div><div><dt>Model</dt><dd>${model}</dd></div><div><dt>Input tokens</dt><dd>${tokens(session.inputTokens)}</dd></div><div><dt>Output tokens</dt><dd>${tokens(session.outputTokens)}</dd></div><div><dt>Total tokens</dt><dd>${tokens(total)}</dd></div>${session.cacheReadTokens != null ? `<div><dt>Cache read tokens</dt><dd>${tokens(session.cacheReadTokens)}</dd></div>` : ""}${session.cacheWriteTokens != null ? `<div><dt>Cache write tokens</dt><dd>${tokens(session.cacheWriteTokens)}</dd></div>` : ""}</dl></section>`;
  }

  private async restoreCachedCopilotGroups(generateOnMiss = false, replaceStale = false): Promise<void> {
    if (this.destroyed || !this.semanticGroups.enabled || (this.copilotGroups !== null && !(replaceStale && this.semanticGroups.stale))) return;
    const request = ++this.cachedGroupsRequest;
    const identity = this.dependencies.analysis.context.identity;
    const isCurrent = () => request === this.cachedGroupsRequest && !this.destroyed && this.semanticGroups.enabled
      && identity === this.dependencies.analysis.context.identity
      && !this.semanticGroups.processing && (this.copilotGroups === null || (replaceStale && this.semanticGroups.stale));
    try {
      const result = await this.dependencies.copilot.cachedSemanticGroups(this.dependencies.analysis.context, this.dependencies.analysis.files);
      if (!isCurrent()) return;
      if (result) {
        if (result.stale && this.copilotGroups !== null) return;
        const groups = validateSemanticGroups(this.dependencies.analysis.files, result.groups, result.stale);
        this.copilotError = "";
        const generation = this.semanticGroups.begin();
        this.copilotGroupResult = result;
        this.semanticGroups.complete(generation, groups, result.stale);
      } else if (generateOnMiss && resolveFeature(this.settings, "autoGenerateCopilotGroups").enabled) {
        void this.loadCopilotGroups(this.dependencies.analysis.files);
      }
    } catch (error) {
      if (!isCurrent()) return;
      this.copilotError = error instanceof Error ? error.message : "Couldn't restore cached Copilot groups";
      this.render();
    }
  }

  private async loadCopilotGroups(files: FileStat[]): Promise<void> {
    if (this.destroyed || !this.semanticGroups.enabled || this.copilotBusy) return;
    this.cachedGroupsRequest++;
    this.copilotBusy = true;
    let request = this.semanticGroups.begin();
    this.semanticGroups.setInFlight(true);
    this.copilotError = "";
    this.render();
    try {
      const identity = this.dependencies.analysis.context.identity;
      await this.dependencies.refreshComparison?.();
      if (this.destroyed || !this.semanticGroups.enabled) return;
      if (!this.semanticGroups.isCurrent(request)) {
        if (identity === this.dependencies.analysis.context.identity) return;
        this.cachedGroupsRequest++;
        request = this.semanticGroups.begin();
      }
      files = this.dependencies.analysis.files;
      const excerpts = await buildCopilotExcerpts(this.dependencies.api, this.dependencies.analysis.context, files);
      if (!this.semanticGroups.isCurrent(request) || this.destroyed) return;
      const result = await this.dependencies.copilot.semanticGroups(this.dependencies.analysis.context, this.dependencies.analysis.files, excerpts, this.copilotGroups !== null);
      if (!this.host.isConnected || !this.semanticGroups.isCurrent(request)) return;
      const groups = validateSemanticGroups(this.dependencies.analysis.files, result.groups);
      this.copilotGroupResult = result;
      this.semanticGroups.complete(request, groups);
    } catch (error) {
      if (!this.semanticGroups.isCurrent(request)) return;
      this.copilotError = error instanceof Error ? error.message : "Copilot grouping failed";
      this.semanticGroups.fail(request, this.copilotError);
      if (!this.open) this.toast.show(`Copilot grouping failed: ${this.copilotError}`);
    } finally {
      this.copilotBusy = false;
      this.semanticGroups.setInFlight(false);
      this.render();
    }
  }

  private async askCopilot(files: FileStat[], question: string): Promise<void> {
    this.copilotBusy = true;
    this.copilotChatError = "";
    this.render();
    try {
      const excerpts = await buildCopilotExcerpts(this.dependencies.api, this.dependencies.analysis.context, files);
      const answer = await this.dependencies.copilot.chat(this.dependencies.analysis.context, this.dependencies.analysis.files, excerpts, question);
      if (!this.host.isConnected) return;
      this.copilotAnswer = answer;
    } catch (error) {
      this.copilotChatError = error instanceof Error ? error.message : "Copilot question failed";
    } finally {
      this.copilotBusy = false;
      this.render();
    }
  }

  private showGroupConfirmation(): void {
    if (this.root.querySelector(".dialog-backdrop")) return;
    const backdrop = document.createElement("dialog");
    backdrop.className = "dialog-backdrop";
    backdrop.setAttribute("aria-labelledby", "group-confirm-title");
    let saving = false;
    backdrop.innerHTML = `    <section class="dialog"><h3 id="group-confirm-title">Generate Copilot groups?</h3><p>All PR files and context will be sent to Copilot running locally.</p><p>All changed-file paths and counts are included. Changed-line excerpts are bounded to ${MAX_COPILOT_FILES} files, 200 changed lines per file, 32 KB per file, and 128 KB total; binary, unavailable, and truncated content is marked omitted. Copilot may use your configured model provider.</p><label class="confirmation-option"><input class="auto-generate-groups" type="checkbox"> Automatically generate on PR page load</label><label class="confirmation-option"><input class="show-group-confirmation" type="checkbox"> Always show this confirmation dialog</label><p class="confirmation-error delivery error" role="alert" hidden></p><div class="dialog-actions"><button class="secondary cancel" type="button">Cancel</button><button class="primary confirm-context" type="button">Send and generate</button></div></section>`;
    const close = () => {
      if (saving) return;
      this.groupConfirmation = null;
      backdrop.close();
      backdrop.remove();
      this.root.querySelector<HTMLButtonElement>(".copilot-groups")?.focus();
    };
    backdrop.querySelector(".cancel")?.addEventListener("click", close);
    backdrop.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    backdrop.querySelector(".confirm-context")?.addEventListener("click", () => {
      if (saving) return;
      saving = true;
      const auto = backdrop.querySelector<HTMLInputElement>(".auto-generate-groups")!.checked;
      const confirm = backdrop.querySelector<HTMLInputElement>(".show-group-confirmation")!.checked;
      const next = { ...this.settings, features: { ...this.settings.features, autoGenerateCopilotGroups: auto, confirmCopilotGroups: confirm } };
      for (const button of backdrop.querySelectorAll<HTMLButtonElement>("button")) button.disabled = true;
      void this.dependencies.settingsService.save(next).then(() => {
        if (this.destroyed) return;
        this.settings = next;
        this.groupConfirmation = null;
        backdrop.close();
        backdrop.remove();
        void this.loadCopilotGroups(this.dependencies.analysis.files);
      }).catch((error: unknown) => {
        if (this.destroyed) return;
        saving = false;
        const message = error instanceof Error ? error.message : "Could not save Copilot preferences";
        const output = backdrop.querySelector<HTMLElement>(".confirmation-error")!;
        output.hidden = false;
        output.textContent = message;
        this.toast.show(message);
        for (const button of backdrop.querySelectorAll<HTMLButtonElement>("button")) button.disabled = false;
      });
    });
    backdrop.querySelector<HTMLInputElement>(".auto-generate-groups")!.checked = this.settings.features.autoGenerateCopilotGroups;
    backdrop.querySelector<HTMLInputElement>(".show-group-confirmation")!.checked = this.settings.features.confirmCopilotGroups;
    this.groupConfirmation = backdrop;
    this.root.append(backdrop);
    backdrop.showModal();
    backdrop.querySelector<HTMLButtonElement>(".confirm-context")?.focus();
  }

  private showCopilotPrivacy(): void {
    if (this.copilotBusy || this.root.querySelector(".dialog-backdrop")) return;
    const question = this.root.querySelector<HTMLTextAreaElement>(".copilot-question")?.value.trim();
    if (!question) return;
    const candidates = this.dependencies.analysis.files.slice(0, MAX_COPILOT_FILES);
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `<section class="dialog" role="dialog" aria-modal="true"><h3>Send bounded PR context to Copilot?</h3><p>ADO Boost will send the PR title, comparison identity, all changed-file paths and counts, plus changed-line excerpts only for the selected files below. Excerpts are capped at 20 files, 200 changed lines per file, 32 KB per file, and 128 KB total. Unselected, binary, unavailable, and truncated content is marked omitted.</p><div class="context-files">${candidates.map((file) => `<label><input type="checkbox" data-context-path="${escapeHtml(file.path)}" ${file.generated || file.lockfile ? "" : "checked"}> ${escapeHtml(file.path)}</label>`).join("")}</div><div class="dialog-actions"><button class="secondary cancel" type="button">Cancel</button><button class="primary confirm-context" type="button">Send and ask question</button></div></section>`;
    this.root.append(backdrop);
    backdrop.querySelector(".cancel")?.addEventListener("click", () => backdrop.remove());
    backdrop.querySelector(".confirm-context")?.addEventListener("click", () => {
      const selected = new Set([...backdrop.querySelectorAll<HTMLInputElement>("[data-context-path]:checked")].map((input) => input.dataset.contextPath));
      const files = candidates.filter((file) => selected.has(file.path));
      backdrop.remove();
      void this.askCopilot(files, question);
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
    if (event.key === "Escape" && this.companionStatus.close()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
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
