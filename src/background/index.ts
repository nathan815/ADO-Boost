import { AdoApi, FetchHttpClient } from "../adapters/ado-api";
import { applyDraftMutation, ChromeBrowserStore, type DraftMutation } from "../adapters/browser";
import { AnnouncementService } from "../core/announcement";
import { DraftQueue } from "../core/drafts";
import { parsePrRoute } from "../core/route";
import { SubmissionCoordinator } from "../core/submission";
import { SerialExecutor } from "../core/serial-executor";
import type { PrRoute, PullRequestContext, ReviewCompletionTrigger, ReviewDecision, SubmissionReceipt } from "../core/types";
import { resolveFeature } from "../features/registry";
import { ChromeSettingsStorage, SettingsService } from "../features/settings-service";
import { NativeCopilotClient } from "./native-copilot";

chrome.action.onClicked.addListener(() => {
  void openExtensionOptions();
});

const api = new AdoApi(new FetchHttpClient());
const store = new ChromeBrowserStore(false);
const settings = new SettingsService(new ChromeSettingsStorage());
const writes = new SerialExecutor();
const copilot = new NativeCopilotClient();
settings.subscribe((current) => {
  if (!current.masterEnabled || (!resolveFeature(current, "copilotSemanticGroups").enabled && !resolveFeature(current, "copilotChat").enabled)) copilot.disconnect();
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
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
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "ADO Boost write failed" }));
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
    const data = await copilot.request("health") as { auth?: { isAuthenticated?: boolean; login?: string; statusMessage?: string } };
    return { connected: true, authenticated: data.auth?.isAuthenticated === true, ...(data.auth?.login ? { login: data.auth.login } : {}), ...(data.auth?.statusMessage ? { detail: data.auth.statusMessage } : {}) };
  }
  const files = Array.isArray(payload.files) ? payload.files : null;
  const excerpts = Array.isArray(payload.excerpts) ? payload.excerpts : null;
  if (!files || !excerpts) throw new Error("Missing bounded changed-file context");
  if (kind === "semantic-groups") {
    requireFeature(currentSettings, "copilotSemanticGroups");
    const cacheKey = `copilot-groups:${current.identity}`;
    const cached = await chrome.storage.local.get(cacheKey);
    if (payload.regenerate !== true && Array.isArray(cached[cacheKey])) return cached[cacheKey];
    const data = await copilot.request("semantic-groups", { title: current.title, comparisonIdentity: current.identity, files, excerpts }) as { groups?: unknown };
    const proposals = parseGroupProposals(data.groups);
    validateProposalPaths(proposals, files);
    await chrome.storage.local.set({ [cacheKey]: proposals });
    return proposals;
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

function parseGroupProposals(value: unknown): Array<{ title: string; rationale: string; paths: string[] }> {
  if (!Array.isArray(value)) throw new Error("Copilot returned invalid groups");
  return value.map((group) => {
    if (!group || typeof group !== "object") throw new Error("Copilot returned an invalid group");
    const candidate = group as Record<string, unknown>;
    if (typeof candidate.title !== "string" || typeof candidate.rationale !== "string" || !Array.isArray(candidate.paths) || !candidate.paths.every((path) => typeof path === "string")) {
      throw new Error("Copilot returned an invalid group");
    }

    return { title: candidate.title, rationale: candidate.rationale, paths: candidate.paths as string[] };
  });
}

function validateProposalPaths(proposals: Array<{ paths: string[] }>, files: unknown[]): void {
  const allowed = new Set(files.map((file) => file && typeof file === "object" ? (file as { path?: unknown }).path : undefined).filter((path): path is string => typeof path === "string"));
  const seen = new Set<string>();
  for (const proposal of proposals) {
    for (const path of proposal.paths) {
      if (!allowed.has(path)) throw new Error(`Copilot returned unknown path ${path}`);
      if (seen.has(path)) throw new Error(`Copilot returned duplicate path ${path}`);
      seen.add(path);
    }
  }
}
