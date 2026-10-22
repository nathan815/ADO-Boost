import { AdoApi, FetchHttpClient } from "../adapters/ado-api";
import { applyDraftMutation, ChromeBrowserStore, type DraftMutation } from "../adapters/browser";
import { AnnouncementService } from "../core/announcement";
import { DraftQueue } from "../core/drafts";
import { parsePrRoute } from "../core/route";
import { SubmissionCoordinator } from "../core/submission";
import { SerialExecutor } from "../core/serial-executor";
import type { PrRoute, PullRequestContext, ReviewCompletionTrigger, ReviewDecision, SubmissionReceipt } from "../core/types";
import { migrateSettings, resolveFeature } from "../features/registry";
import { ChromeSettingsStorage, SETTINGS_KEY, SettingsService } from "../features/settings-service";
import { NativeCopilotClient } from "./native-copilot";
import { ChromeRecentPrStorage } from "../adapters/recent-pr-storage";
import { RecentPrService } from "../core/recent-prs";
import { parseCopilotGroupResult, parseCopilotHealth, type CopilotGroupResult } from "../core/copilot-gateway";
import { isPopupMessage, PopupService } from "./popup-service";
import { writeFailure } from "../core/write-gateway";
import { CompanionAccountsService, isCompanionAccountsMessage } from "./companion-accounts";

const api = new AdoApi(new FetchHttpClient());
const store = new ChromeBrowserStore(false);
const settingsStorage = new ChromeSettingsStorage();
const settings = new SettingsService(settingsStorage);
const writes = new SerialExecutor();
const copilot = new NativeCopilotClient();
const companionAccounts = new CompanionAccountsService(copilot, chrome.runtime.id, chrome.runtime.getURL("options.html"));
const popup = new PopupService({
  extensionId: chrome.runtime.id,
  popupUrl: chrome.runtime.getURL("popup.html"),
  history: new RecentPrService(new ChromeRecentPrStorage()),
  enabled: async () => migrateSettings(await settingsStorage.get(SETTINGS_KEY)).masterEnabled,
  summary: (route) => api.getPrSummary(route, AbortSignal.timeout(10_000)),
  health: async () => parseCopilotHealth(await copilot.request("health"))
});
settings.subscribe((current) => {
  const enabled = resolveFeature(current, "copilotSemanticGroups").enabled || resolveFeature(current, "copilotChat").enabled;
  // Popup diagnostics remain available when inference features are disabled.
  if (!enabled && copilot.hasActiveInference) copilot.disconnect();
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isCompanionAccountsMessage(message)) {
    void companionAccounts.handle(message, sender)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Companion account request failed" }));
    return true;
  }
  if (isPopupMessage(message)) {
    void popup.handle(message, sender)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Popup request failed" }));
    return true;
  }
  if (isUiMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, error: "UI requests are accepted only from this extension" });
      return;
    }
    void openExtensionOptions()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unable to open extension settings" }));
    return true;
  }
  if (isCopilotMessage(message)) {
    void handleCopilot(message.kind, message.payload, sender)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Copilot companion request failed" }));
    return true;
  }
  if (isStorageMessage(message)) {
    if (sender.id !== chrome.runtime.id || !sender.tab?.url) {
      sendResponse({ ok: false, error: "Draft mutations are accepted only from an extension content script" });
      return;
    }
    void writes.run(`draft:${message.key}`, async () => {
      const route = parsePrRoute(new URL(sender.tab!.url!));
      if (!route) throw new Error("Draft update does not originate from a pull request page");
      requireFeature(await settings.load(), "draftQueue");
      const context = await api.getContext(route);
      if (new DraftQueue(store, context).key() !== message.key) throw new Error("Draft queue does not match the active pull request and reviewer");
      const drafts = applyDraftMutation(await store.getDrafts(message.key), message.mutation);
      await store.saveDrafts(message.key, drafts);
      return drafts;
    }).then((data) => sendResponse({ ok: true, data })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Draft update failed" }));
    return true;
  }
  if (!isWriteMessage(message)) return;
  void handleWrite(message.kind, message.payload, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse(writeFailure(error)));
  return true;
});

async function handleCopilot(kind: string, payload: Record<string, unknown>, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const context = payload.context as PullRequestContext | undefined;
  if (!context) throw new Error("Missing pull request context");
  assertSender(context, sender);
  const current = await api.getContext(context);
  if (current.identity !== context.identity) throw new Error("The pull request changed; refresh before sending context to Copilot");
  const currentSettings = await settings.load();
  if (kind === "health") {
    requireFeature(currentSettings, "copilotSemanticGroups");
    return parseCopilotHealth(await copilot.request("health"));
  }
  const files = Array.isArray(payload.files) ? payload.files : null;
  if (kind === "cached-semantic-groups") {
    requireFeature(currentSettings, "copilotSemanticGroups");
    if (!files) throw new Error("Missing changed-file context");
    return loadCachedCopilotGroups(current.identity, files, true);
  }
  const excerpts = Array.isArray(payload.excerpts) ? payload.excerpts : null;
  if (!files || !excerpts) throw new Error("Missing bounded changed-file context");
  if (kind === "semantic-groups") {
    requireFeature(currentSettings, "copilotSemanticGroups");
    const cacheKey = `copilot-groups:${current.identity}`;
    if (payload.regenerate !== true) {
      const cached = await loadCachedCopilotGroups(current.identity, files);
      if (cached) return cached;
    }
    const result = {
      ...parseCopilotGroupResult(await copilot.request("semantic-groups", { title: current.title, comparisonIdentity: current.identity, files, excerpts })),
      generation: { iterationId: current.iterationId, generatedAt: new Date().toISOString() },
      cached: false
    };
    validateProposalPaths(result.groups, files);
    await chrome.storage.local.set({ [cacheKey]: result });
    return { ...result, cached: false };
  }
  if (kind === "chat") {
    requireFeature(currentSettings, "copilotChat");
    if (typeof payload.question !== "string" || !payload.question.trim()) throw new Error("Question is required");
    const data = await copilot.request("chat", { title: current.title, comparisonIdentity: current.identity, files, excerpts, question: payload.question }) as { answer?: unknown };
    if (typeof data.answer !== "string") throw new Error("Copilot returned an invalid answer");
    return data.answer;
  }
  throw new Error("Unsupported Copilot request");
}

async function loadCachedCopilotGroups(identity: string, files: unknown[], includeStale = false): Promise<CopilotGroupResult | null> {
  const key = `copilot-groups:${identity}`;
  const value: unknown = (await chrome.storage.local.get(key))[key];
  if (value === undefined) {
    if (!includeStale) return null;
    const parts = identity.split("/");
    const iteration = Number(parts.at(-3));
    if (!Number.isInteger(iteration) || iteration < 2) return null;
    const prefix = `copilot-groups:${parts.slice(0, -3).join("/")}/`;
    const entries = await chrome.storage.local.get(null);
    const previous = Object.keys(entries).filter((candidate) => {
      if (!candidate.startsWith(prefix)) return false;
      const suffix = candidate.slice(prefix.length).split("/");
      const id = Number(suffix[0]);
      return suffix.length === 3 && Number.isInteger(id) && id > 0 && id < iteration;
    }).sort((a, b) => Number(b.slice(prefix.length).split("/")[0]) - Number(a.slice(prefix.length).split("/")[0]));
    if (!previous.length) return null;
    const cached = entries[previous[0]!];
    const result = parseCopilotGroupResult(Array.isArray(cached) ? { groups: cached } : cached);
    const paths = proposalPaths(files);
    const groups = result.groups.map((group) => ({ ...group, paths: group.paths.filter((path) => paths.has(path)) })).filter((group) => group.paths.length);
    validateProposalPaths(groups, files);
    return { ...result, groups, cached: true, stale: true };
  }
  const result = parseCopilotGroupResult(Array.isArray(value) ? { groups: value } : value);
  validateProposalPaths(result.groups, files);
  return { ...result, cached: true };
}

async function handleWrite(kind: string, payload: Record<string, unknown>, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const route = parseRoute(payload.route);
  assertSender(route, sender);
  const key = `${route.origin}/${route.repository}/${route.pullRequestId}`;
  return writes.run(key, async () => {
    const currentSettings = await settings.load();
    const context = await api.getContext(route);
    if ((kind === "submit" || kind === "retry-decision") && payload.expectedIdentity !== context.identity) {
      throw new Error("The pull request changed after the preview opened. Reopen the review preview and confirm against the latest iteration");
    }
    if (kind === "announcement") {
      requireFeature(currentSettings, "startReviewing");
      return writes.run(announcementLock(context), () => new AnnouncementService(api, store).post(context));
    }
    if (kind === "finish-review") {
      return finishAnnouncement(context, parseCompletionTrigger(payload.trigger));
    }
    if (kind === "submit") {
      requireFeature(currentSettings, "submitReview");
      const draftIds = Array.isArray(payload.draftIds) && payload.draftIds.every((id) => typeof id === "string") ? payload.draftIds : null;
      const decision = parseDecision(payload.decision);
      if (!draftIds) throw new Error("Invalid draft selection");
      const queue = new DraftQueue(store, context);
      return writes.run(`draft:${queue.key()}`, () => new SubmissionCoordinator(api, store, queue, context, () => requireSubmitEnabled(), async (receipt) => {
        if (payload.finishAnnouncement === true && resolveFeature(await settings.load(), "startReviewing").enabled) await finishAnnouncement(context, completionTrigger(receipt));
      }).submit(draftIds, decision));
    }
    if (kind === "retry-decision") {
      requireFeature(currentSettings, "submitReview");
      const receipt = payload.receipt as SubmissionReceipt | undefined;
      if (!receipt?.id) throw new Error("Invalid submission receipt");
      const queue = new DraftQueue(store, context);
      return writes.run(`draft:${queue.key()}`, () => new SubmissionCoordinator(api, store, queue, context, () => requireSubmitEnabled(), async (receipt) => {
        if (resolveFeature(await settings.load(), "startReviewing").enabled) await finishAnnouncement(context, completionTrigger(receipt));
      }).retryVote(receipt));
    }
    if (kind === "thread-status") {
      requireFeature(currentSettings, "threadNavigator");
      const threadId = Number(payload.threadId);
      const status = Number(payload.status);
      if (!Number.isInteger(threadId) || ![1, 2].includes(status)) throw new Error("Invalid thread update");
      await api.setThreadStatus(context, threadId, status as 1 | 2);
      return null;
    }
    throw new Error("Unsupported write request");
  });

  async function requireSubmitEnabled(): Promise<void> {
    requireFeature(await settings.load(), "submitReview");
  }
}

function announcementLock(context: PullRequestContext): string {
  return `announcement:${context.repositoryId}/${context.pullRequestId}/${context.reviewer.id}`;
}

async function finishAnnouncement(context: PullRequestContext, trigger: ReviewCompletionTrigger) {
  return writes.run(announcementLock(context), async () => {
    requireFeature(await settings.load(), "startReviewing");
    const service = new AnnouncementService(api, store);
    return service.finish(context, trigger);
  });
}

function completionTrigger(receipt: SubmissionReceipt): ReviewCompletionTrigger {
  return receipt.decision === "comment"
    ? { kind: "submission", submissionId: receipt.id, commentCount: receipt.postedDraftIds.length }
    : { kind: "vote" };
}

function parseCompletionTrigger(value: unknown): ReviewCompletionTrigger {
  if (!value || typeof value !== "object") throw new Error("Missing review completion trigger");
  const trigger = value as Record<string, unknown>;
  if (trigger.kind === "vote") return { kind: "vote" };
  if (trigger.kind === "submission" && typeof trigger.submissionId === "string" && trigger.submissionId.length > 0 && typeof trigger.commentCount === "number" && Number.isInteger(trigger.commentCount) && trigger.commentCount >= 0) {
    return { kind: "submission", submissionId: trigger.submissionId, commentCount: trigger.commentCount };
  }
  throw new Error("Invalid review completion trigger");
}

function assertSender(route: PrRoute, sender: chrome.runtime.MessageSender): void {
  if (sender.id !== chrome.runtime.id || !sender.tab?.url) throw new Error("Write requests are accepted only from an extension content script");
  const senderRoute = parsePrRoute(new URL(sender.tab.url));
  if (!senderRoute || senderRoute.origin !== route.origin || senderRoute.organization !== route.organization || senderRoute.project !== route.project || senderRoute.repository !== route.repository || senderRoute.pullRequestId !== route.pullRequestId) {
    throw new Error("Write request does not match the active pull request tab");
  }
}

function parseRoute(value: unknown): PrRoute {
  if (!value || typeof value !== "object") throw new Error("Missing pull request route");
  const route = value as Partial<PrRoute>;
  if (typeof route.origin !== "string" || typeof route.organization !== "string" || typeof route.project !== "string" || typeof route.repository !== "string" || !Number.isInteger(route.pullRequestId)) {
    throw new Error("Invalid pull request route");
  }
  return route as PrRoute;
}

function parseDecision(value: unknown): ReviewDecision {
  if (["comment", "approve", "approve-suggestions", "wait-author", "reject"].includes(String(value))) return value as ReviewDecision;
  throw new Error("Invalid review decision");
}

function requireFeature(current: Awaited<ReturnType<SettingsService["load"]>>, id: "startReviewing" | "submitReview" | "threadNavigator" | "draftQueue" | "copilotSemanticGroups" | "copilotChat"): void {
  const resolved = resolveFeature(current, id);
  if (!resolved.enabled) throw new Error(resolved.reason ?? "Feature is disabled");
}

async function openExtensionOptions(): Promise<void> {
  const runtime = chrome.runtime as typeof chrome.runtime & { openOptionsPage?: () => Promise<void> };
  if (typeof runtime.openOptionsPage === "function") {
    await runtime.openOptionsPage();
    return;
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
}

function isUiMessage(value: unknown): value is { channel: "adopp-ui"; kind: "open-options" } {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.channel === "adopp-ui" && message.kind === "open-options";
}

function isWriteMessage(value: unknown): value is { channel: "adopp-write"; kind: string; payload: Record<string, unknown> } {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.channel === "adopp-write" && typeof message.kind === "string" && !!message.payload && typeof message.payload === "object";
}

function isStorageMessage(value: unknown): value is { channel: "adopp-storage"; key: string; mutation: DraftMutation } {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (message.channel !== "adopp-storage" || typeof message.key !== "string" || !message.mutation || typeof message.mutation !== "object") return false;
  const kind = (message.mutation as Record<string, unknown>).kind;
  return ["append", "update", "remove", "replace"].includes(String(kind));
}

function isCopilotMessage(value: unknown): value is { channel: "adopp-copilot"; kind: string; payload: Record<string, unknown> } {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.channel === "adopp-copilot" && typeof message.kind === "string" && !!message.payload && typeof message.payload === "object";
}

function validateProposalPaths(proposals: Array<{ paths: string[] }>, files: unknown[]): void {
  const allowed = proposalPaths(files);
  const seen = new Set<string>();
  for (const proposal of proposals) {
    for (const path of proposal.paths) {
      if (!allowed.has(path)) throw new Error(`Copilot returned unknown path ${path}`);
      if (seen.has(path)) throw new Error(`Copilot returned duplicate path ${path}`);
      seen.add(path);
    }

  }
}

function proposalPaths(files: unknown[]): Set<string> {
  return new Set(files.map((file) => file && typeof file === "object" ? (file as { path?: unknown }).path : undefined).filter((path): path is string => typeof path === "string"));
}
