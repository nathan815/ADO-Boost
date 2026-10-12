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

interface ReviewPanelDependencies {
  analysis: PullRequestAnalysis;
  api: AdoApi;
  store: BrowserStore;
  settingsService: SettingsService;
  settings: FeatureSettings;
  reviewKey: string;
  writes: WriteGateway;
  copilot: CopilotGateway;
  synthetic?: boolean;
}

export class ReviewPanel {
  private readonly host = document.createElement("div");
  private readonly root = this.host.attachShadow({ mode: "open" });
  private readonly announcement: AnnouncementService;
  private readonly diffDialog: DiffDialog;
  private readonly discussion: DiscussionController;
  private settings: FeatureSettings;
  private open = false;
  private announcementPosted = false;
  private copilotGroups: ReviewGroup[] | null = null;
  private copilotHealth: CopilotHealth | null = null;
  private copilotBusy = false;
  private copilotError = "";
  private copilotAnswer = "";

  constructor(private readonly dependencies: ReviewPanelDependencies) {
    this.settings = dependencies.settings;
    this.announcement = new AnnouncementService(dependencies.api, dependencies.store);
    this.diffDialog = new DiffDialog(dependencies.api, dependencies.analysis.context, (root, path, trackingId, line, side) => this.discussion.showInlineDraft(root, path, trackingId, line, side));
    this.discussion = new DiscussionController(dependencies.api, dependencies.store, dependencies.analysis, dependencies.writes, () => this.settings, () => this.render());
    this.host.dataset.theme = dependencies.settings.presentation.theme;
    document.documentElement.append(this.host);
    document.addEventListener("keydown", this.onKeyDown, true);
    if (resolveFeature(this.settings, "startReviewing").enabled) {
      void this.announcement.status(dependencies.analysis.context).then((record) => {
        this.announcementPosted = record?.status === "posted";
        this.render();
      });
    }
    void this.discussion.load();
    this.render();
  }

  updateSettings(settings: FeatureSettings): void {
    const threadsWereEnabled = resolveFeature(this.settings, "threadNavigator").enabled;
    this.settings = settings;
    this.host.dataset.theme = settings.presentation.theme;
    if (!settings.masterEnabled) {
      this.destroy();
      return;
    }
    if (!threadsWereEnabled && resolveFeature(settings, "threadNavigator").enabled) void this.discussion.loadThreads().then(() => this.render());
    this.render();
  }

  destroy(): void {
    document.removeEventListener("keydown", this.onKeyDown, true);
    this.host.remove();
  }

  openDiscussions(): void {
    this.open = true;
    this.render();
  }

  startReviewing(): void {
    this.showAnnouncementDialog();
  }

  isReviewAnnounced(): boolean {
    return this.announcementPosted;
  }

  private render(): void {
    const analysis = this.dependencies.analysis;
    this.root.innerHTML = `
      <style>${panelStyles}</style>
      <aside class="rail" data-open="${this.open}" aria-label="AzureDevOps++ review navigator">
        <header class="header">
          <div class="header-line">
            <h2>PR discussions</h2>
            <div class="header-actions">
              <button class="icon settings" type="button" title="Open AzureDevOps++ settings" aria-label="Open settings">⚙</button>
              <button class="icon close" type="button" aria-label="Close review navigator">✕</button>
            </div>
          </div>
          <p class="subtitle">${this.dependencies.synthetic ? "Synthetic offline fixture · " : ""}Iteration ${analysis.context.iterationId} · comments stay visible while you review files</p>
        </header>
        <section class="summary" aria-label="Pull request review summary">
          <div class="metric"><b>${analysis.threads.active}</b><span>open</span></div>
          <div class="metric"><b>${analysis.threads.resolved}</b><span>resolved</span></div>
          <div class="metric"><b>${analysis.threads.total}</b><span>all threads</span></div>
        </section>
        <main class="workspace">
          ${this.copilotMarkup()}
          ${resolveFeature(this.settings, "draftQueue").enabled || resolveFeature(this.settings, "threadNavigator").enabled ? this.discussion.markup() : ""}
        </main>
      </aside>
    `;
    this.bind();
  }

  private bind(): void {
    this.root.querySelector(".close")?.addEventListener("click", () => { this.open = false; this.render(); });
    this.root.querySelector(".settings")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
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
    backdrop.innerHTML = `<section class="dialog" role="dialog" aria-modal="true"><h3>Send bounded PR context to Copilot?</h3><p>AzureDevOps++ will send the PR title, comparison identity, all changed-file paths and counts, plus changed-line excerpts only for the selected files below. Excerpts are capped at 20 files, 200 changed lines per file, 32 KB per file, and 128 KB total. Unselected, binary, unavailable, and truncated content is marked omitted.</p><div class="context-files">${candidates.map((file) => `<label><input type="checkbox" data-context-path="${escapeHtml(file.path)}" ${file.generated || file.lockfile ? "" : "checked"}> ${escapeHtml(file.path)}</label>`).join("")}</div><div class="dialog-actions"><button class="secondary cancel" type="button">Cancel</button><button class="primary confirm-context" type="button">${action === "groups" ? "Send and group changes" : "Send and ask question"}</button></div></section>`;
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
    if (this.announcementPosted) return;
    const body = this.announcement.body(this.dependencies.analysis.context);
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="adopp-dialog-title"><h3 id="adopp-dialog-title">Announce review start?</h3><p>This posts one normal comment to PR ${this.dependencies.analysis.context.pullRequestId}. It does not change your vote or guarantee a notification.</p><div class="preview">${escapeHtml(body)}</div><div class="dialog-actions"><button class="secondary cancel" type="button">Cancel</button><button class="primary confirm" type="button">Post announcement</button></div></section>`;
    this.root.append(backdrop);
    backdrop.querySelector(".cancel")?.addEventListener("click", () => backdrop.remove());
    backdrop.querySelector(".confirm")?.addEventListener("click", () => void this.confirmAnnouncement(backdrop));
    backdrop.querySelector<HTMLButtonElement>(".cancel")?.focus();
  }

  private async confirmAnnouncement(backdrop: HTMLElement): Promise<void> {
    const button = backdrop.querySelector<HTMLButtonElement>(".confirm");
    if (!button) return;
    button.disabled = true;
    button.textContent = "Posting…";
    try {
      await this.dependencies.writes.postAnnouncement(this.dependencies.analysis.context);
      this.announcementPosted = true;
      backdrop.remove();
      this.render();
      window.dispatchEvent(new CustomEvent("adopp:announcement-changed"));
    } catch (error) {
      button.disabled = false;
      button.textContent = "Retry after checking";
      const text = backdrop.querySelector<HTMLElement>(".dialog p");
      if (text) text.textContent = error instanceof Error ? `${error.message}. AzureDevOps++ will check the PR before retrying to prevent a duplicate.` : "Announcement failed.";
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!resolveFeature(this.settings, "keyboardShortcuts").enabled || isTyping(event.target)) return;
    if (event.shiftKey && event.key.toLowerCase() === "r") {
      event.preventDefault();
      this.open = !this.open;
      this.render();
      return;
    }
  };
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character] as string);
}
