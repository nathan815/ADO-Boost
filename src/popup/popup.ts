import { createElement as h, type KeyboardEvent } from "react";
import { render, unmountComponentAtNode } from "react-dom";
import { Button } from "azure-devops-ui/Button";
import { Callout } from "azure-devops-ui/Callout";
import { Icon } from "azure-devops-ui/Icon";
import { Link } from "azure-devops-ui/Link";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { Status, Statuses, StatusSize } from "azure-devops-ui/Status";
import { getSafeId } from "azure-devops-ui/Util";
import { Location } from "azure-devops-ui/Utilities/Position";
import type { CopilotHealth } from "../core/copilot-gateway";
import type { RecentPr } from "../core/recent-prs";
import type { FeatureSettings } from "../features/registry";
import { reviewStatusFor, reviewStatusLabels, type ReviewActivity } from "../core/review-activity";

export const POPUP_TAB_KEY = "popup-tab:v1";
export const popupTabs = ["recent", "reviewing", "reviewed"] as const;
export type PopupTab = typeof popupTabs[number];
const tabLabels: Record<PopupTab, string> = { recent: "Recently Viewed", reviewing: "Reviewing", reviewed: "Reviewed" };

export interface PopupDependencies {
  health(): Promise<CopilotHealth>;
  list(): Promise<RecentPr[]>;
  reviews(): Promise<ReviewActivity[]>;
  loadTab(): Promise<PopupTab>;
  saveTab(tab: PopupTab): Promise<void>;
  clear(): Promise<void>;
  openSettings(): Promise<void>;
  settings(): Promise<FeatureSettings>;
  subscribe(listener: (area: "history" | "settings") => void): () => void;
}

export class ExtensionPopup {
  private active = false;
  private unsubscribe: (() => void) | undefined;
  private historyGeneration = 0;
  private health: CopilotHealth | null = null;
  private checking = false;
  private healthError = "";
  private connectionExpanded = false;
  private entries: RecentPr[] = [];
  private reviews: ReviewActivity[] = [];
  private selectedTab: PopupTab = "recent";
  private tabChanged = false;
  private tabWrites: Promise<void> = Promise.resolve();
  private loading = true;
  private historyError = "";
  private actionError = "";
  private confirmingClear = false;
  private clearing = false;
  private enabled = true;

  constructor(private readonly root: HTMLElement, private readonly dependencies: PopupDependencies) {}

  start(): void {
    this.active = true;
    this.unsubscribe = this.dependencies.subscribe((area) => {
      if (area === "history") void this.loadHistory();
      else void this.loadSettings();
    });
    this.render();
    void this.loadHistory();
    void this.refreshHealth();
    void this.loadSettings();
    void this.loadTab();
  }

  destroy(): void {
    this.active = false;
    this.unsubscribe?.();
    unmountComponentAtNode(this.root);
  }

  private async loadSettings(): Promise<void> {
    try {
      const settings = await this.dependencies.settings();
      if (!this.active) return;
      this.root.ownerDocument.documentElement.dataset.theme = settings.presentation.theme;
      this.enabled = settings.masterEnabled;
    } catch (error) {
      this.actionError = errorMessage(error, "Unable to load popup settings");
    }
    this.render();
  }

  private async loadHistory(): Promise<void> {
    const generation = ++this.historyGeneration;
    try {
      const [entries, reviews] = await Promise.all([this.dependencies.list(), this.dependencies.reviews()]);
      if (!this.active || generation !== this.historyGeneration) return;
      this.entries = entries;
      this.reviews = reviews;
      this.historyError = "";
    } catch (error) {
      if (!this.active || generation !== this.historyGeneration) return;
      this.historyError = errorMessage(error, "Unable to load recent PRs");
    }

    this.loading = false;
    this.render();
  }

  private async loadTab(): Promise<void> {
    try {
      const tab = await this.dependencies.loadTab();
      if (!this.active || this.tabChanged) return;
      this.selectedTab = tab;
    } catch (error) {
      this.actionError = errorMessage(error, "Unable to load the selected tab");
    }
    this.render();
  }

  private selectTab(tab: PopupTab): void {
    this.tabChanged = true;
    this.selectedTab = tab;
    this.confirmingClear = false;
    this.tabWrites = this.tabWrites.then(async () => {
      try {
        await this.dependencies.saveTab(tab);
      } catch (error) {
        this.actionError = errorMessage(error, "Unable to save the selected tab");
        this.render();
      }
    });
    this.render();
  }

  private renderTabs() {
    return h("div", { className: "popup-tabs", role: "tablist", "aria-label": "Pull requests" },
      popupTabs.map((tab, index) => h("button", {
        key: tab, id: `tab-${tab}`, role: "tab", type: "button",
        "aria-selected": tab === this.selectedTab, "aria-controls": "pr-tabpanel",
        tabIndex: tab === this.selectedTab ? 0 : -1,
        onClick: () => this.selectTab(tab),
        onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
          const next = event.key === "ArrowRight" ? (index + 1) % popupTabs.length
            : event.key === "ArrowLeft" ? (index + popupTabs.length - 1) % popupTabs.length
            : event.key === "Home" ? 0 : event.key === "End" ? popupTabs.length - 1 : null;
          if (next === null) return;
          event.preventDefault();
          this.selectTab(popupTabs[next]!);
          this.root.querySelector<HTMLButtonElement>(`#tab-${popupTabs[next]}`)?.focus();
        }
      }, tabLabels[tab])));
  }

  private async refreshHealth(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    this.healthError = "";
    this.render();
    try {
      this.health = await this.dependencies.health();
    } catch (error) {
      this.health = null;
      this.healthError = errorMessage(error, "Companion connection failed");
    } finally {
      this.checking = false;
      this.render();
    }
  }

  private async clearHistory(): Promise<void> {
    if (this.clearing) return;
    this.clearing = true;
    this.actionError = "";
    this.render();
    try {
      await this.dependencies.clear();
      this.confirmingClear = false;
      await this.loadHistory();
    } catch (error) {
      this.actionError = errorMessage(error, "Unable to clear recent PRs");
    } finally {
      this.clearing = false;
      this.render();
    }
  }

  private async openSettings(): Promise<void> {
    this.actionError = "";
    try {
      await this.dependencies.openSettings();
    } catch (error) {
      this.actionError = errorMessage(error, "Unable to open settings");
    }
    this.render();
  }

  private render(): void {
    if (!this.active) return;
    const status = this.checking ? "Checking"
      : this.healthError || !this.health?.connected ? "Unavailable"
      : this.health.authenticated ? "Connected" : "Needs login";
    const entries = this.selectedTab === "recent" ? this.entries : this.reviews.filter((pr) => pr.reviewStatus === this.selectedTab);
    render(h("div", {
      className: "popup",
      // ADO buttons consume Escape during bubbling.
      onKeyDownCapture: (event) => {
        if (event.key !== "Escape" || !this.connectionExpanded) return;
        event.preventDefault();
        event.stopPropagation();
        this.closeConnectionDetails();
      }
    },
      h("header", { className: "popup-header" },
        h("div", { className: "brand" },
          h("img", { src: "./icons/ado-boost.svg", alt: "", width: 32, height: 32 }),
          h("h1", null, "ADO Boost")),
        h("div", { className: "header-actions" },
          h(Button, {
            className: "companion-toggle", subtle: true, ariaLabel: `Copilot companion: ${status}`,
            ariaExpanded: this.connectionExpanded, ariaControls: "companion-details",
            onClick: () => { this.connectionExpanded = !this.connectionExpanded; this.render(); }
          },
          h("span", { className: "companion-icon", "aria-hidden": true },
            this.checking ? h(Spinner, { size: SpinnerSize.small, ariaLive: "off" })
              : h(Status, { ...(this.healthError || !this.health?.connected ? Statuses.Failed : this.health.authenticated ? Statuses.Success : Statuses.Warning), size: StatusSize.m })),
          h("span", { role: "status", "aria-live": "polite" }, status)),
          h(Button, { text: "Settings", subtle: true, onClick: () => void this.openSettings() }))),
      this.connectionExpanded ? this.renderConnectionDetails(status) : null,
      this.renderTabs(),
      h("section", { className: "recent", id: "pr-tabpanel", role: "tabpanel", "aria-labelledby": `tab-${this.selectedTab}` },
        h("div", { className: "section-heading recent-heading" },
          h("h2", { id: "recent-heading" }, this.selectedTab === "recent" ? "Recent pull requests" : tabLabels[this.selectedTab]),
          this.selectedTab === "recent" && (this.entries.length || this.historyError) ? h(Button, {
            text: "Clear history", subtle: true, disabled: this.loading || this.clearing,
            onClick: () => { this.confirmingClear = true; this.render(); }
          }) : null),
        this.confirmingClear ? h("div", { className: "clear-confirmation", role: "group", "aria-label": "Confirm clearing history" },
          h("p", null, "Clear recent PR history from this browser? Drafts and review progress will stay."),
          h("div", { className: "confirmation-actions" },
            h(Button, { text: "Cancel", autoFocus: true, disabled: this.clearing, onClick: () => { this.confirmingClear = false; this.render(); } }),
            h(Button, { text: this.clearing ? "Clearing..." : "Confirm clear", danger: true, disabled: this.clearing, onClick: () => void this.clearHistory() }))) : null,
        !this.enabled && (this.loading || this.entries.length || this.historyError) ? h("p", { className: "disabled-note muted" }, "ADO Boost is disabled. New visits are not being recorded.") : null,
        this.loading ? h("div", { className: "empty" }, h(Spinner, { label: "Loading recent PRs", size: SpinnerSize.small }))
          : this.historyError ? h("div", { className: "empty" },
            h("p", { className: "error", role: "alert" }, this.historyError),
            h(Button, { text: "Retry history", onClick: () => void this.loadHistory() }))
          : entries.length ? h("ol", { className: "recent-list" }, entries.map((pr) => this.renderPr(pr)))
            : this.selectedTab === "recent" ? this.renderEmptyHistory()
              : h("div", { className: "history-empty" },
                h("h3", null, this.selectedTab === "reviewing" ? "No pull requests being reviewed" : "No reviewed pull requests yet"),
                h("p", { className: "muted" }, this.selectedTab === "reviewing"
                  ? "Use Start Reviewing on an Azure DevOps pull request to track it here."
                  : "Pull requests appear here when your announced review is complete."))),
      this.actionError ? h("p", { className: "action-error error", role: "alert" }, this.actionError) : null
    ), this.root);
  }

  private renderEmptyHistory() {
    return h("div", { className: "history-empty" },
      h(Icon, {
        render: (className) => h("svg", {
          className: `${className ?? ""} history-empty-icon`, viewBox: "0 0 24 24", width: 32, height: 32,
          fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round",
          "aria-hidden": true, focusable: false
        },
        h("circle", { cx: 6, cy: 5, r: 2.5 }),
        h("circle", { cx: 6, cy: 19, r: 2.5 }),
        h("circle", { cx: 18, cy: 19, r: 2.5 }),
        h("path", { d: "M6 7.5v9M18 16.5v-4A5.5 5.5 0 0 0 12.5 7H11m3-3-3 3 3 3" }))
      }),
      h("h3", null, "No recent pull requests yet"),
      h("p", { className: "muted" }, this.enabled
        ? "Open a pull request in Azure DevOps. It will appear here for quick access."
        : "Turn on ADO Boost in Settings to start keeping your recent pull requests here."),
      !this.enabled ? h(Button, { text: "Open settings", onClick: () => void this.openSettings() }) : null);
  }

  private renderConnectionDetails(status: string) {
    const anchor = this.root.querySelector<HTMLButtonElement>(".companion-toggle");
    if (!anchor) throw new Error("Companion status button is missing");
    return h(Callout, {
      id: "companion-details",
      className: "companion-popover",
      contentClassName: "companion-popover-content",
      anchorElement: anchor,
      anchorOrigin: { horizontal: Location.end, vertical: Location.end },
      calloutOrigin: { horizontal: Location.end, vertical: Location.start },
      anchorOffset: { horizontal: 0, vertical: 8 },
      fixedLayout: true,
      updateLayout: true,
      viewportChangeDismiss: false,
      contentShadow: true,
      lightDismiss: true,
      escDismiss: true,
      ariaLabelledBy: "companion-heading",
      onDismiss: () => this.closeConnectionDetails()
    }, h("section", { className: "connection" },
      h("div", { className: "section-heading" },
        h("h2", { id: getSafeId("companion-heading") }, "Copilot companion"),
        h(Button, { text: "Refresh", subtle: true, autoFocus: true, disabled: this.checking, ariaLabel: "Refresh companion connection", onClick: () => void this.refreshHealth() })),
      h("div", { className: "connection-status", role: "status", "aria-live": "polite" },
        h("strong", null, status),
        !this.checking && this.health?.connected && this.health.authenticated && this.health.login ? h("span", { className: "muted login" }, `Signed in as ${this.health.login}`) : null),
      this.healthError ? h("div", { className: "connection-detail" },
        h("p", { className: "error", role: "alert" }, this.healthError),
        h("p", { className: "muted" }, "Run ado-boost doctor to check the host and CLI, then refresh.")) : null,
      !this.checking && this.health?.connected && !this.health.authenticated ? h("p", { className: "muted" }, this.health.detail ?? "Run ado-boost login, then refresh.") : null,
      h("p", { className: "privacy-note muted" }, "Checks connection and sign-in only. No PR content is sent.")));
  }

  private closeConnectionDetails(): void {
    if (!this.connectionExpanded) return;
    this.connectionExpanded = false;
    this.render();
    this.root.querySelector<HTMLButtonElement>(".companion-toggle")?.focus();
  }

  private renderPr(pr: RecentPr) {
    const reviewStatus = reviewStatusFor(pr, this.reviews);
    return h("li", { key: pr.url, className: reviewStatus ? `pr-${reviewStatus}` : undefined },
      h(Link, { href: pr.url, target: "_blank", rel: "noopener noreferrer", className: "pr-link", removeUnderline: true },
        h("span", { className: "pr-title" }, pr.title || "Untitled pull request"),
        reviewStatus ? h("span", { className: `pr-review-status status-${reviewStatus}` }, reviewStatusLabels[reviewStatus]) : null,
        pr.author ? h("span", { className: "pr-author muted" }, `By ${pr.author}`) : null,
        h("span", { className: "pr-location muted" }, `${pr.organization} / ${pr.project} / ${pr.repository}`),
        h("span", { className: "pr-details muted" },
          h("span", { className: "pr-number" }, `#${pr.pullRequestId}`),
          h("time", { dateTime: new Date(pr.viewedAt).toISOString() }, new Date(pr.viewedAt).toLocaleString()))));
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
