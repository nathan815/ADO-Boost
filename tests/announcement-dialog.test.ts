// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { AdoApi } from "../src/adapters/ado-api";
import { MemoryBrowserStore } from "../src/adapters/browser";
import type { PullRequestAnalysis } from "../src/core/types";
import { defaultSettings } from "../src/features/registry";
import { MemorySettingsStorage, SettingsService } from "../src/features/settings-service";
import { AnnouncementDialog } from "../src/ui/announcement-dialog";
import { ReviewPanel } from "../src/ui/review-panel";

let dialog: AnnouncementDialog | null = null;
let panel: ReviewPanel | null = null;

afterEach(() => {
  dialog?.close();
  panel?.destroy();
  dialog = null;
  panel = null;
  document.body.innerHTML = "";
});

function openDialog(onConfirm: () => Promise<void> = async () => undefined, onClose = vi.fn()): AnnouncementDialog {
  dialog = new AnnouncementDialog({
    pullRequestId: 7,
    body: "**Me** has started reviewing.\n\n[ADO Boost](https://github.com/nathan815/ADO-Boost) browser extension.\n\n<!-- ado-boost:hidden -->",
    onConfirm,
    onClose
  });
  dialog.open();
  return dialog;
}

function button(action: "confirm" | "cancel"): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`[data-adopp-announcement-dialog] [data-action="${action}"]`)!;
}

function key(value: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true });
  document.activeElement!.dispatchEvent(event);
  return event;
}

describe("Native announcement dialog", () => {
  it("overrides the native portal's pointer pass-through and dismisses backdrop clicks", () => {
    const nativeStyle = document.createElement("style");
    nativeStyle.textContent = ".bolt-portal { pointer-events: none; }";
    document.body.append(nativeStyle);
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    openDialog(onConfirm, onClose);
    const portal = document.querySelector<HTMLElement>("[data-adopp-announcement-dialog]")!;
    expect(getComputedStyle(portal).pointerEvents).toBe("auto");
    const pageClick = vi.fn();
    document.addEventListener("click", pageClick);
    try {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      portal.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(pageClick).not.toHaveBeenCalled();
      expect(onConfirm).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledOnce();
      expect(document.querySelector("[data-adopp-announcement-dialog]")).toBeNull();
      expect(document.activeElement).toBe(opener);
    } finally {
      document.removeEventListener("click", pageClick);
    }
  });

  it("dismisses clicks on the callout margin but not inside the dialog content", () => {
    const onClose = vi.fn();
    openDialog(undefined, onClose);
    document.querySelector<HTMLElement>(".adopp-announcement-preview")!.click();
    document.querySelector<HTMLElement>(".bolt-callout-content")!.click();
    expect(onClose).not.toHaveBeenCalled();
    document.querySelector<HTMLElement>(".bolt-dialog-callout")!.click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(["pointerdown", "pointerup", "mousedown", "mouseup"])("contains %s events inside the modal", (type) => {
    openDialog();
    const pageHandler = vi.fn();
    document.addEventListener(type, pageHandler);
    try {
      document.querySelector(".adopp-announcement-preview")!.dispatchEvent(new MouseEvent(type, { bubbles: true }));
      expect(pageHandler).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener(type, pageHandler);
    }
  });

  it("uses native Bolt markup outside the shadow root and inherits page styles", () => {
    const nativeStyle = document.createElement("style");
    nativeStyle.textContent = `
      .bolt-dialog { color: rgb(220, 220, 220); }
      .bolt-header-condensed { padding-top: 8px; padding-bottom: 8px; }
      .bolt-header-title.s { padding-top: 6px; padding-bottom: 6px; }
      p { margin-top: 16px; }
    `;
    document.body.append(nativeStyle);
    const onConfirm = vi.fn();
    const instance = openDialog(onConfirm);
    const portal = document.querySelector<HTMLElement>("[data-adopp-announcement-dialog]")!;
    expect(portal.parentElement).toBe(document.body);
    expect(portal.getRootNode()).toBe(document);
    expect(portal.querySelector(".bolt-dialog-callout-content.bolt-callout-shadow")).not.toBeNull();
    expect(portal.querySelector(".bolt-panel-header .bolt-header-title")?.textContent).toBe("Announce review start?");
    expect(portal.querySelector('[role="dialog"]')?.getAttribute("aria-labelledby")).toBe(portal.querySelector('[role="heading"]')?.id);
    expect(portal.querySelector(".bolt-header-content-area .bolt-header-title-row .bolt-header-title.title-xs.s")).not.toBeNull();
    expect(portal.querySelector(".bolt-panel-footer .bolt-button.primary")).toBe(button("confirm"));
    expect(portal.querySelector(".adopp-announcement-preview")?.textContent).not.toContain("ado-boost:");
    expect(portal.textContent).not.toContain("Includes hidden ADO Boost metadata");
    expect(portal.querySelector("a")?.getAttribute("href")).toBe("https://github.com/nathan815/ADO-Boost");

    expect(getComputedStyle(portal.querySelector(".bolt-dialog")!).color).toBe("rgb(220, 220, 220)");
    const headerStyle = getComputedStyle(portal.querySelector(".bolt-panel-header")!);
    expect(headerStyle.paddingTop).toBe("8px");
    expect(headerStyle.paddingBottom).toBe("8px");
    expect(getComputedStyle(portal.querySelector(".bolt-header-title")!).paddingTop).toBe("6px");
    expect(getComputedStyle(portal.querySelector(".bolt-dialog-content>p:first-child")!).marginTop).toBe("0px");
    expect(document.activeElement).toBe(button("cancel"));
    instance.open();
    expect(document.querySelectorAll("[data-adopp-announcement-dialog]")).toHaveLength(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("contains keyboard focus and restores the opener on Escape", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    openDialog(undefined, onClose);
    const link = document.querySelector<HTMLAnchorElement>("[data-adopp-announcement-dialog] a")!;
    link.focus();
    expect(key("Tab", true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button("confirm"));
    key("Tab");
    expect(document.activeElement).toBe(link);
    opener.focus();
    expect(document.activeElement).toBe(button("cancel"));
    key("Escape");
    expect(document.querySelector("[data-adopp-announcement-dialog]")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not send native PR keyboard shortcuts through the modal", () => {
    const pageShortcut = vi.fn();
    document.addEventListener("keydown", pageShortcut);
    try {
      openDialog();
      key("n");
      key("R", true);
      expect(pageShortcut).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", pageShortcut);
    }
  });

  it("disables actions while posting, prevents duplicates, and closes after success", async () => {
    let complete!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const onClose = vi.fn();
    openDialog(onConfirm, onClose);
    button("confirm").click();
    expect(button("confirm").disabled).toBe(true);
    expect(button("cancel").disabled).toBe(true);
    expect(button("confirm").classList.contains("enabled")).toBe(false);
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-busy")).toBe("true");
    button("confirm").click();
    key("Escape");
    document.querySelector<HTMLElement>("[data-adopp-announcement-dialog]")!.click();
    document.querySelector<HTMLElement>(".bolt-dialog-callout")!.click();
    expect(document.querySelector("[data-adopp-announcement-dialog]")).not.toBeNull();
    expect(onConfirm).toHaveBeenCalledOnce();
    complete();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(document.querySelector("[data-adopp-announcement-dialog]")).toBeNull();
  });

  it("shows write errors without losing the preview and permits an explicit retry", async () => {
    const onConfirm = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("Network failed")).mockResolvedValue(undefined);
    openDialog(onConfirm);
    button("confirm").click();
    await vi.waitFor(() => expect(button("confirm").disabled).toBe(false));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Network failed");
    expect(document.querySelector<HTMLElement>('[role="alert"]')?.hidden).toBe(false);
    expect(document.querySelector(".adopp-announcement-preview strong")?.textContent).toBe("Me");
    expect(button("confirm").textContent).toBe("Retry after checking");
    expect(document.activeElement).toBe(button("confirm"));
    button("confirm").click();
    await vi.waitFor(() => expect(document.querySelector("[data-adopp-announcement-dialog]")).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it("removes focus and keyboard listeners when disposed", () => {
    const instance = openDialog();
    instance.close();
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);
    expect(key("Tab").defaultPrevented).toBe(false);
  });

  it("survives review panel rendering and is cleaned up when disabled or destroyed", () => {
    const settings = defaultSettings();
    const analysis: PullRequestAnalysis = {
      context: {
        origin: "https://dev.azure.com", organization: "org", project: "project", repository: "repo",
        repositoryId: "repo-id", pullRequestId: 7, title: "PR", sourceCommit: "source", targetCommit: "target",
        mergeBaseCommit: "base", iterationId: 3, identity: "identity", reviewer: { id: "me", displayName: "Me" }
      },
      files: [], groups: [], threads: { state: "available", active: 0, resolved: 0, total: 0 }, completedTrackingIds: new Set()
    };
    panel = new ReviewPanel({
      analysis,
      api: new AdoApi({ fetch: async () => new Response(JSON.stringify({ value: [] }), { status: 200 }) }),
      store: new MemoryBrowserStore(),
      settingsService: new SettingsService(new MemorySettingsStorage()),
      settings,
      reviewKey: "review",
      writes: { postAnnouncement: vi.fn(), submitReview: vi.fn(), retryDecision: vi.fn(), setThreadStatus: vi.fn() },
      copilot: { health: vi.fn(), semanticGroups: vi.fn(), chat: vi.fn() },
      openSettings: vi.fn()
    });
    panel.startReviewing();
    const portal = document.querySelector("[data-adopp-announcement-dialog]");
    panel.openDiscussions();
    panel.startReviewing();
    expect(document.querySelector("[data-adopp-announcement-dialog]")).toBe(portal);
    expect(document.querySelectorAll("[data-adopp-announcement-dialog]")).toHaveLength(1);
    settings.features.startReviewing = false;
    panel.updateSettings(settings);
    expect(document.querySelector("[data-adopp-announcement-dialog]")).toBeNull();
    settings.features.startReviewing = true;
    panel.updateSettings(settings);
    panel.startReviewing();
    panel.destroy();
    expect(document.querySelector("[data-adopp-announcement-dialog]")).toBeNull();
  });
});
