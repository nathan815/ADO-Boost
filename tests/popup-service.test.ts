import { describe, expect, it, vi } from "vitest";
import { PopupService, isPopupMessage } from "../src/background/popup-service";
import { RecentPrService, type RecentPr, type PrSummary } from "../src/core/recent-prs";
import { parsePrRoute } from "../src/core/route";
import type { PrRoute } from "../src/core/types";

const prUrl = "https://dev.azure.com/org/project/_git/repo/pullrequest/42";
const route = parsePrRoute(new URL(prUrl))!;
const popupUrl = "chrome-extension://test-id/popup.html";
const popupSender: chrome.runtime.MessageSender = { id: "test-id", url: popupUrl };
const contentSender: chrome.runtime.MessageSender = { id: "test-id", url: prUrl, frameId: 0, tab: { id: 1, url: prUrl, index: 0, pinned: false, highlighted: false, windowId: 1, active: true, incognito: false, selected: true, discarded: false, autoDiscardable: true, frozen: false, groupId: -1 } };
const recordMessage = { channel: "adopp-popup", kind: "record-visit", route } as const;

function setup() {
  let entries: RecentPr[] | undefined;
  const history = new RecentPrService({
    load: async () => entries,
    save: async (value) => { entries = value; }
  });
  const enabled = vi.fn(async () => true);
  const summary = vi.fn(async (input: PrRoute): Promise<PrSummary> => ({ ...input, repositoryId: "repo-id", title: "PR title", author: "PR Author" }));
  const health = vi.fn(async () => ({ connected: true, authenticated: false }));
  const now = vi.fn(() => 100);
  const service = new PopupService({ extensionId: "test-id", popupUrl, history, enabled, summary, health, now });
  return { service, history, enabled, summary, health, now };
}

describe("popup runtime service", () => {
  it("permits health from the popup without a PR or enabled Copilot features", async () => {
    const { service, enabled, summary, health } = setup();
    enabled.mockResolvedValue(false);
    await expect(service.handle({ channel: "adopp-popup", kind: "health" }, popupSender)).resolves.toEqual({ connected: true, authenticated: false });
    expect(health).toHaveBeenCalledOnce();
    expect(enabled).not.toHaveBeenCalled();
    expect(summary).not.toHaveBeenCalled();
  });

  it("records only matching content-script routes and returns history only to the popup", async () => {
    const { service, summary } = setup();
    await service.handle(recordMessage, contentSender);
    expect(summary).toHaveBeenCalledWith(route);
    await expect(service.handle({ channel: "adopp-popup", kind: "list-recent" }, popupSender)).resolves.toMatchObject([{ title: "PR title", author: "PR Author", viewedAt: 100 }]);
    await expect(service.handle({ channel: "adopp-popup", kind: "list-recent" }, contentSender)).rejects.toThrow("only from the extension popup");
  });

  it("rejects external senders, options-page status probes, mismatched routes, and popup recording", async () => {
    const { service, summary, health } = setup();
    await expect(service.handle(recordMessage, { ...contentSender, id: "other-id" })).rejects.toThrow();
    await expect(service.handle({ ...recordMessage, route: { ...route, pullRequestId: 99 } }, contentSender)).rejects.toThrow();
    await expect(service.handle(recordMessage, popupSender)).rejects.toThrow();
    await expect(service.handle(recordMessage, { ...contentSender, frameId: 1 })).rejects.toThrow();
    await expect(service.handle({ channel: "adopp-popup", kind: "health" }, { ...popupSender, url: popupUrl.replace("popup", "options") })).rejects.toThrow();
    expect(summary).not.toHaveBeenCalled();
    expect(health).not.toHaveBeenCalled();
  });

  it("skips metadata and storage while disabled and rechecks after fetching", async () => {
    const { service, enabled, summary, history } = setup();
    enabled.mockResolvedValue(false);
    await service.handle(recordMessage, contentSender);
    expect(summary).not.toHaveBeenCalled();
    enabled.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await service.handle(recordMessage, contentSender);
    expect(await history.list()).toEqual([]);
  });

  it("serializes visits from concurrent tabs and captures time before metadata work", async () => {
    const { service, summary, now, history } = setup();
    let complete!: (value: PrSummary) => void;
    summary.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    now.mockReturnValueOnce(10).mockReturnValueOnce(20);
    const first = service.handle(recordMessage, contentSender);
    const second = service.handle(recordMessage, contentSender);
    await vi.waitFor(() => expect(summary).toHaveBeenCalledTimes(1));
    complete({ ...route, repositoryId: "repo-id", title: "Old title" });
    await Promise.all([first, second]);
    expect(await history.list()).toMatchObject([{ viewedAt: 20, title: "PR title" }]);
  });

  it("serializes clear after an in-flight visit so history is not resurrected", async () => {
    const { service, summary, history } = setup();
    let complete!: (value: PrSummary) => void;
    summary.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const recording = service.handle(recordMessage, contentSender);
    const clearing = service.handle({ channel: "adopp-popup", kind: "clear-recent" }, popupSender);
    await vi.waitFor(() => expect(summary).toHaveBeenCalledOnce());
    complete({ ...route, repositoryId: "repo-id", title: "PR title" });
    await Promise.all([recording, clearing]);
    expect(await history.list()).toEqual([]);
  });

  it("reads saved history without waiting for an in-flight metadata request", async () => {
    const { service, summary } = setup();
    let complete!: (value: PrSummary) => void;
    summary.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const recording = service.handle(recordMessage, contentSender);
    await vi.waitFor(() => expect(summary).toHaveBeenCalledOnce());
    await expect(service.handle({ channel: "adopp-popup", kind: "list-recent" }, popupSender)).resolves.toEqual([]);
    complete({ ...route, repositoryId: "repo-id", title: "PR title" });
    await recording;
  });

  it("surfaces failed metadata reads and recognizes only supported messages", async () => {
    const { service, summary } = setup();
    summary.mockRejectedValue(new Error("ADO unavailable"));
    await expect(service.handle(recordMessage, contentSender)).rejects.toThrow("ADO unavailable");
    expect(isPopupMessage({ channel: "adopp-popup", kind: "health" })).toBe(true);
    expect(isPopupMessage({ channel: "adopp-popup", kind: "run-command" })).toBe(false);
    expect(isPopupMessage(null)).toBe(false);
  });
});
