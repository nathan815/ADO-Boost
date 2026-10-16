import { AdoApi, FetchHttpClient } from "../adapters/ado-api";
import { ChromeBrowserStore } from "../adapters/browser";
import { ChromePullRequestListStatStore } from "../adapters/list-stat-cache";
import { PullRequestAnalyzer } from "../core/analyzer";
import { PullRequestListStatService } from "../core/list-stats";
import { parsePrRoute } from "../core/route";
import { RuntimeWriteGateway } from "../core/write-gateway";
import { RuntimeCopilotGateway } from "../core/copilot-gateway";
import type { FeatureSettings } from "../features/registry";
import { resolveFeature } from "../features/registry";
import { ChromeSettingsStorage, SettingsService } from "../features/settings-service";
import { ReviewPanel } from "../ui/review-panel";
import { PullRequestListBadges } from "./list-badges";
import { NativePrEnhancer } from "./native-pr-enhancer";
import { NativeTreeClient } from "../native-tree/client";

class ContentApp {
  private readonly api = new AdoApi(new FetchHttpClient());
  private readonly store = new ChromeBrowserStore();
  private readonly analyzer = new PullRequestAnalyzer(this.api, this.store);
  private readonly listStats = new PullRequestListStatService(this.api, this.analyzer, new ChromePullRequestListStatStore());
  private readonly settingsService = new SettingsService(new ChromeSettingsStorage());
  private readonly writes = new RuntimeWriteGateway();
  private readonly copilot = new RuntimeCopilotGateway();
  private settings: FeatureSettings | null = null;
  private panel: ReviewPanel | null = null;
  private enhancer: NativePrEnhancer | null = null;
  private badges: PullRequestListBadges | null = null;
  private routeController: AbortController | null = null;
  private currentUrl = "";
  private currentRouteKey = "";
  private unsubscribe: (() => void) | null = null;
  private readonly openSettings = (): void => {
    void requestOpenOptions();
  };

  async start(): Promise<void> {
    this.settings = await this.settingsService.load();
    this.unsubscribe = this.settingsService.subscribe((settings) => {
      this.settings = settings;
      void this.mount(true);
    });
    this.observeNavigation();
    await this.mount();
  }

  private observeNavigation(): void {
    const check = () => {
      if (location.href !== this.currentUrl) void this.mount();
    };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    addEventListener("popstate", check);
    addEventListener("hashchange", check);
  }

  private async mount(settingsOnly = false): Promise<void> {
    if (!this.settings) return;
    const url = location.href;
    if (!settingsOnly && url === this.currentUrl) return;
    this.currentUrl = url;
    const route = parsePrRoute(new URL(url));
    const routeKey = route ? `${route.origin}|${route.organization}|${route.project}|${route.repository}|${route.pullRequestId}` : "";
    if (this.settings.masterEnabled && resolveFeature(this.settings, "prOverview").enabled
      && routeKey && routeKey === this.currentRouteKey && this.panel && this.enhancer) {
      this.panel.updateSettings(this.settings);
      this.enhancer.updateSettings(this.settings);
      this.enhancer.refresh();
      return;
    }
    this.routeController?.abort();
    this.routeController = new AbortController();
    this.panel?.destroy();
    this.panel = null;
    this.enhancer?.destroy();
    this.enhancer = null;
    this.badges?.stop();
    this.badges = null;

    if (!this.settings.masterEnabled) return;
    if (route && resolveFeature(this.settings, "prOverview").enabled) {
      try {
        const analysis = await this.analyzer.analyze(route, this.routeController.signal);
        if (this.routeController.signal.aborted) return;
        this.panel = new ReviewPanel({
          analysis,
          api: this.api,
          store: this.store,
          settingsService: this.settingsService,
          settings: this.settings,
          writes: this.writes,
          copilot: this.copilot,
          reviewKey: this.analyzer.reviewKey(analysis.context),
          openSettings: this.openSettings
        });
        this.enhancer = new NativePrEnhancer(analysis, this.settings, {
          openDiscussions: () => this.panel?.openDiscussions(),
          startReviewing: () => this.panel?.startReviewing(),
          isReviewAnnounced: () => this.panel?.isReviewAnnounced() ?? false,
          isReviewFinished: () => this.panel?.isReviewFinished() ?? false,
          openSettings: this.openSettings
        }, new NativeTreeClient(analysis));
        this.enhancer.start();
        this.currentRouteKey = routeKey;
      } catch (error) {
        if (!this.routeController.signal.aborted) console.error("ADO Boost failed to analyze this PR", error);
      }
    } else if (resolveFeature(this.settings, "prListBadges").enabled) {
      this.currentRouteKey = "";
      this.badges = new PullRequestListBadges(this.listStats);
      this.badges.start();
    }
  }
}

async function requestOpenOptions(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ channel: "adopp-ui", kind: "open-options" }) as { ok: true } | { ok: false; error: string };
    if (!response?.ok) console.error("ADO Boost could not open settings", response?.error ?? "No response from extension service worker");
  } catch (error) {
    console.error("ADO Boost could not open settings", error);
  }
}

void new ContentApp().start();
