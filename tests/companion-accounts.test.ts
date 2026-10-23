// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanionAccountsService } from "../src/background/companion-accounts";
import { CompanionAccountSettings } from "../src/ui/companion-accounts";

const personal = { host: "https://github.com", login: "personal" };
const work = { host: "https://github.com", login: "work_account" };
const state = { accounts: [personal, work], selected: personal };
afterEach(() => { window.dispatchEvent(new Event("pagehide")); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("companion account settings bridge", () => {
  it("lists and selects accounts without PR context or enabled inference features", async () => {
    const request = vi.fn().mockResolvedValue(state);
    const service = new CompanionAccountsService({ request }, "extension", "chrome-extension://extension/options.html");
    const sender = { id: "extension", url: "chrome-extension://extension/options.html" };
    await expect(service.handle({ kind: "accounts" }, sender)).resolves.toEqual(state);
    await service.handle({ kind: "select-account", account: work }, { ...sender, url: `${sender.url}#copilot-connection` });
    expect(request.mock.calls).toEqual([["accounts", {}], ["select-account", { account: work }]]);
  });

  it("rejects website, content-script, popup and other-extension senders before contacting the host", async () => {
    const request = vi.fn();
    const service = new CompanionAccountsService({ request }, "extension", "chrome-extension://extension/options.html");
    for (const sender of [
      { id: "other", url: "chrome-extension://extension/options.html" },
      { id: "extension", url: "https://dev.azure.com/org" },
      { id: "extension", url: "chrome-extension://extension/popup.html" },
      { id: "extension", url: "chrome-extension://extension/options.html?untrusted=true" },
      { id: "extension", tab: { url: "chrome-extension://extension/options.html" } }
    ]) await expect(service.handle({ kind: "accounts" }, sender as chrome.runtime.MessageSender)).rejects.toThrow("only");
    expect(request).not.toHaveBeenCalled();
  });

  it("validates request and response shapes", async () => {
    const request = vi.fn().mockResolvedValue({ accounts: "bad", selected: null });
    const service = new CompanionAccountsService({ request }, "extension", "chrome-extension://extension/options.html");
    const sender = { id: "extension", url: "chrome-extension://extension/options.html" };
    await expect(service.handle({ kind: "select-account", account: {} }, sender)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    await expect(service.handle({ kind: "accounts" }, sender)).rejects.toThrow();
  });
});

describe("companion account selector", () => {
  it("does not disable or rebuild an unchanged selector during background polling", async () => {
    const gateway = { list: vi.fn().mockResolvedValue(state), select: vi.fn() };
    const control = new CompanionAccountSettings(gateway, document);
    await control.load();
    const select = control.element.querySelector("select")!;
    const options = [...select.options];
    let complete!: (value: typeof state) => void;
    gateway.list.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const pending = control.load(true);
    expect(select.disabled).toBe(false);
    complete(state);
    await pending;
    expect([...select.options]).toEqual(options);
    expect(select.options[0]).toBe(options[0]);
  });
  it("loads available accounts, shows the saved selection, and applies changes live", async () => {
    const gateway = { list: vi.fn().mockResolvedValue(state), select: vi.fn().mockResolvedValue({ ...state, selected: work }) };
    const onAccountChange = vi.fn().mockResolvedValue(undefined);
    const control = new CompanionAccountSettings(gateway, document, onAccountChange);
    document.body.append(control.element);
    await control.load();
    const select = control.element.querySelector("select")!;
    expect(select.value).toBe("0");
    select.value = "1";
    select.dispatchEvent(new Event("change"));
    expect(select.disabled).toBe(true);
    await vi.waitFor(() => expect(select.disabled).toBe(false));
    expect(gateway.select).toHaveBeenCalledWith(work);
    expect(onAccountChange).toHaveBeenCalledOnce();
    expect(select.value).toBe("1");
    expect(control.element.querySelector<HTMLOutputElement>("output")?.hidden).toBe(true);
    expect(control.element.querySelector("button")).toBeNull();
  });

  describe("options page account initialization", () => {
    it("automatically updates the header, banner and accounts after setup and pauses when the page closes", async () => {
      vi.useFakeTimers();
      vi.resetModules();
      const { RuntimeCompanionAccountsGateway } = await import("../src/core/companion-accounts");
      const list = vi.spyOn(RuntimeCompanionAccountsGateway.prototype, "list").mockResolvedValue(state);
      const sendMessage = vi.fn()
        .mockResolvedValueOnce({ ok: true, data: { connected: false, authenticated: false } })
        .mockResolvedValue({ ok: true, data: { connected: true, authenticated: true, login: personal.login } });
      vi.stubGlobal("chrome", {
        runtime: { getPlatformInfo: vi.fn().mockResolvedValue({ os: "win" }), sendMessage },
        storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() }, onChanged: { addListener: vi.fn() } }
      });
      document.body.innerHTML = '<div id="app"></div>';
      try {
        await import("../src/options/index");
        await vi.advanceTimersByTimeAsync(0);
        expect(document.querySelector(".companion-header-status")?.textContent).toBe("Copilot not set up");
        expect(document.querySelector<HTMLElement>(".setup-required")?.hidden).toBe(false);
        const option = document.querySelector("#companion-account option");
        await vi.advanceTimersByTimeAsync(5_000);
        expect(list).toHaveBeenCalledTimes(2);
        expect(document.querySelector(".companion-header-status")?.textContent).toBe(personal.login);
        expect(document.querySelector<HTMLElement>(".setup-required")?.hidden).toBe(true);
        expect(document.querySelector<HTMLElement>(".connection-success")?.hidden).toBe(false);
        expect(document.querySelector("#companion-account option")).toBe(option);
        window.dispatchEvent(new Event("pagehide"));
        await vi.advanceTimersByTimeAsync(10_000);
        expect(sendMessage).toHaveBeenCalledTimes(2);
        window.dispatchEvent(new Event("pageshow"));
        await vi.advanceTimersByTimeAsync(0);
        expect(sendMessage).toHaveBeenCalledTimes(3);
      } finally {
        window.dispatchEvent(new Event("pagehide"));
      }
    });

    it("loads accounts on first render and preserves the selector when searching", async () => {
      vi.resetModules();
      const { RuntimeCompanionAccountsGateway } = await import("../src/core/companion-accounts");
      const list = vi.spyOn(RuntimeCompanionAccountsGateway.prototype, "list").mockResolvedValue(state);
      const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: { connected: true, authenticated: true, login: personal.login } });
      vi.stubGlobal("chrome", {
        runtime: {
          getPlatformInfo: vi.fn().mockResolvedValue({ os: "win" }),
          sendMessage
        },
        storage: {
          local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() },
          onChanged: { addListener: vi.fn() }
        }
      });
      document.body.innerHTML = `<div id="app"></div>`;
      try {
        await import("../src/options/index");
        await vi.waitFor(() => expect(document.querySelector<HTMLSelectElement>("#companion-account")?.disabled).toBe(false));
        expect(list).toHaveBeenCalledOnce();
        const card = document.querySelector(".connection-status")!;
        const selector = document.querySelector("#companion-account");
        expect(card.contains(selector)).toBe(true);
        expect(card.closest('[role="tabpanel"]')?.id).toBe("connection-panel");
        expect(document.querySelector<HTMLElement>("#connection-panel")?.hidden).toBe(true);
        await vi.waitFor(() => expect(document.querySelector(".companion-header-status")?.textContent).toBe(personal.login));
        expect(document.querySelector("#connection-panel")?.firstElementChild?.className).toBe("copilot-connection");
        const search = document.querySelector<HTMLInputElement>("#search")!;
        search.value = "account";
        search.setSelectionRange(7, 7);
        search.dispatchEvent(new Event("input"));
        expect(document.querySelector("#companion-account")).not.toBeNull();
        expect(list).toHaveBeenCalledOnce();
        const currentSearch = () => document.querySelector<HTMLInputElement>("#search")!;
        expect(document.activeElement).toBe(currentSearch());
        expect(currentSearch().selectionStart).toBe(7);
        expect(currentSearch().selectionEnd).toBe(7);
        for (const [start, end, direction] of [[3, 3, "none"], [1, 5, "backward"], [0, 0, "none"]] as const) {
          currentSearch().setSelectionRange(start, end, direction);
          currentSearch().dispatchEvent(new Event("input"));
          expect(document.activeElement).toBe(currentSearch());
          expect(currentSearch().selectionStart).toBe(start);
          expect(currentSearch().selectionEnd).toBe(end);
          expect(currentSearch().selectionDirection).toBe(direction);
          expect(currentSearch().value).toBe("account");
        }
        document.querySelector<HTMLButtonElement>(".companion-header-status")!.click();
        expect(document.querySelector(".connection-status")).toBe(card);
        expect(document.querySelector("#companion-account")).toBe(selector);
        expect(document.querySelectorAll("#companion-account")).toHaveLength(1);
        expect(document.querySelector<HTMLElement>("#connection-panel")?.hidden).toBe(false);
        document.querySelector<HTMLButtonElement>("#refresh")!.click();
        await vi.waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2));
        expect(list).toHaveBeenCalledTimes(2);
        expect(document.querySelector(".companion-account-setting")?.textContent).not.toContain("refreshed");
        expect(document.querySelector(".companion-account-setting button")).toBeNull();
        const select = selector as HTMLSelectElement;
        list.mockResolvedValue({ ...state, selected: work });
        sendMessage.mockResolvedValue({ ok: true, data: { connected: true, authenticated: true, login: work.login } });
        vi.spyOn(RuntimeCompanionAccountsGateway.prototype, "select").mockResolvedValueOnce({ ...state, selected: work });
        select.value = "1";
        select.dispatchEvent(new Event("change"));
        await vi.waitFor(() => expect(select.disabled).toBe(false));
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(3);
        await vi.waitFor(() => expect(document.querySelector(".companion-header-status")?.textContent).toBe(work.login));
        expect(select.value).toBe("1");
      } finally {
        list.mockRestore();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
      }
    });
  });

  it("retains the saved account on failed changes and supports refresh/recovery", async () => {
    const gateway = { list: vi.fn().mockResolvedValue(state), select: vi.fn().mockRejectedValue(new Error("Account is signed out")) };
    const onAccountChange = vi.fn();
    const control = new CompanionAccountSettings(gateway, document, onAccountChange);
    await control.load();
    const select = control.element.querySelector("select")!;
    select.value = "1";
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(select.disabled).toBe(false));
    expect(select.value).toBe("0");
    expect(control.element.textContent).toContain("Account is signed out");
    expect(onAccountChange).not.toHaveBeenCalled();
    gateway.list.mockResolvedValueOnce({ accounts: [], selected: personal });
    await control.load();
    expect(select.disabled).toBe(true);
    expect(select.textContent).toContain("Pinned: personal");
    expect(control.element.querySelector<HTMLOutputElement>("output")?.hidden).toBe(true);
    gateway.list.mockResolvedValueOnce(state);
    await control.load();
    expect(select.disabled).toBe(false);
  });

  it("passes list failures to connection status without duplicating errors in the account selector", async () => {
    const control = new CompanionAccountSettings({
      list: vi.fn().mockRejectedValue(new Error("<img src=x> Host missing")),
      select: vi.fn()
    }, document);
    await expect(control.load()).rejects.toThrow("<img src=x> Host missing");
    expect(control.element.textContent).not.toContain("Host missing");
    expect(control.element.querySelector("img")).toBeNull();
    expect(control.element.querySelector("button.primary")).toBeNull();
    expect(control.element.querySelector("button")).toBeNull();
    expect(control.element.querySelector<HTMLOutputElement>("output")?.hidden).toBe(true);
    expect(control.element.querySelector("select")?.disabled).toBe(true);
  });

});
