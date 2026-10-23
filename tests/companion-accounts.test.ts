// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanionAccountsService } from "../src/background/companion-accounts";
import { CompanionAccountSettings } from "../src/ui/companion-accounts";
import { RuntimeCompanionAccountsGateway } from "../src/core/companion-accounts";

const personal = { host: "https://github.com", login: "personal" };
const work = { host: "https://github.com", login: "work_account" };
const state = { accounts: [personal, work], selected: personal };
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

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
  it("loads available accounts, shows the saved selection, and applies changes live", async () => {
    const gateway = { list: vi.fn().mockResolvedValue(state), select: vi.fn().mockResolvedValue({ ...state, selected: work }) };
    const control = new CompanionAccountSettings(gateway, document);
    document.body.append(control.element);
    await control.load();
    const select = control.element.querySelector("select")!;
    expect(select.value).toBe("0");
    select.value = "1";
    select.dispatchEvent(new Event("change"));
    expect(select.disabled).toBe(true);
    await vi.waitFor(() => expect(select.disabled).toBe(false));
    expect(gateway.select).toHaveBeenCalledWith(work);
    expect(select.value).toBe("1");
    expect(control.element.querySelector("output")?.textContent).toContain("Account saved");
  });

  describe("options page account initialization", () => {
    it("loads accounts on first render and preserves the selector when searching", async () => {
      const list = vi.spyOn(RuntimeCompanionAccountsGateway.prototype, "list").mockResolvedValue(state);
      vi.stubGlobal("chrome", {
        runtime: {
          getPlatformInfo: vi.fn().mockResolvedValue({ os: "win" }),
          sendMessage: vi.fn().mockResolvedValue({ ok: true, data: { connected: true, authenticated: true } })
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
        expect(document.querySelector("#connection-panel")?.lastElementChild?.id).toBe("companion-account-settings");
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
      } finally {
        list.mockRestore();
        vi.unstubAllGlobals();
      }
    });
  });

  it("retains the saved account on failed changes and supports refresh/recovery", async () => {
    const gateway = { list: vi.fn().mockResolvedValue(state), select: vi.fn().mockRejectedValue(new Error("Account is signed out")) };
    const control = new CompanionAccountSettings(gateway, document);
    await control.load();
    const select = control.element.querySelector("select")!;
    select.value = "1";
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(select.disabled).toBe(false));
    expect(select.value).toBe("0");
    expect(control.element.textContent).toContain("Account is signed out");
    gateway.list.mockResolvedValueOnce({ accounts: [], selected: personal });
    await control.load();
    expect(select.disabled).toBe(true);
    expect(control.element.textContent).toContain("No signed-in accounts");
    gateway.list.mockResolvedValueOnce(state);
    await control.load();
    expect(select.disabled).toBe(false);
  });

  it("surfaces missing hosts without rendering their messages as HTML", async () => {
    const control = new CompanionAccountSettings({
      list: vi.fn().mockRejectedValue(new Error("<img src=x> Host missing")),
      select: vi.fn()
    }, document);
    await control.load();
    expect(control.element.textContent).toContain("<img src=x> Host missing");
    expect(control.element.querySelector("img")).toBeNull();
    expect(control.element.querySelector("button.primary")).toBeNull();
    expect(control.element.querySelector("button")?.disabled).toBe(false);
  });

});
