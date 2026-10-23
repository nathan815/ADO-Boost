// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://dev.azure.com/org/project"}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceHost } from "../src/workspace/host";
import { WorkspaceApi } from "../src/workspace/api";

let host: WorkspaceHost;
let messages: Array<(message: unknown) => void>;
let disconnect: ReturnType<typeof vi.fn>;
let postMessage: ReturnType<typeof vi.fn>;
beforeEach(() => {
  history.replaceState(null, "", "/org/project");
  document.body.innerHTML = '<div class="project-navigation"></div><div class="content-parent"><main class="region-content"><input aria-label="Native input"><div id="native">Native content</div></main></div>';
  messages = [];
  disconnect = vi.fn();
  postMessage = vi.fn();
  vi.stubGlobal("chrome", { runtime: {
    getURL: (path: string) => `chrome-extension://test/${path}`,
    connect: vi.fn(() => ({ onMessage: { addListener: (listener: (message: unknown) => void) => messages.push(listener) },
      onDisconnect: { addListener: vi.fn() }, postMessage, disconnect }))
  } });
  host = new WorkspaceHost();
  host.start(); host.update(true);
});
afterEach(() => { host.stop(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("workspace host lifecycle", () => {
  it("includes the resolved current project in the authenticated workspace session", async () => {
    history.replaceState(null, "", "/org/Project%20Space?adoBoostPrHome=projects");
    const read = vi.spyOn(WorkspaceApi.prototype, "read").mockImplementation(async (query) =>
      query.kind === "identity" ? { id: "me", displayName: "Me" } : { id: "p", name: "Project Space" });
    host.update(true);
    messages[0]!({ id: "session", kind: "session" });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: "session", ok: true, data: expect.objectContaining({
        currentProject: { id: "p", name: "Project Space" }, viewer: { id: "me", displayName: "Me" }, view: "projects"
      })
    })));
    expect(read).toHaveBeenCalledWith({ kind: "project", project: "Project Space" }, expect.any(AbortSignal));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("collapses native submenus and accessibility state while open, including remounts, then restores on exit", async () => {
    const group = document.createElement("div");
    group.className = "hub-group-container displayed-container expanded-container";
    group.innerHTML = '<a class="hub-group displayed" aria-expanded="true">Overview</a><div role="menu"><a href="/org/project">Summary</a><a href="/org/project/_dashboards">Dashboards</a></div>';
    document.querySelector(".project-navigation")!.append(group);
    const toggle = group.querySelector<HTMLElement>(".hub-group")!;
    const menu = group.querySelector<HTMLElement>('[role="menu"]')!;
    document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!.click();
    const frame = document.querySelector("iframe");
    expect(getComputedStyle(menu).display).toBe("none");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(group.classList.contains("expanded-container")).toBe(true);
    toggle.setAttribute("aria-expanded", "true");
    await vi.waitFor(() => expect(toggle.getAttribute("aria-expanded")).toBe("false"));
    const replacement = toggle.cloneNode(true) as HTMLElement;
    replacement.setAttribute("aria-expanded", "true");
    toggle.replaceWith(replacement);
    await vi.waitFor(() => expect(replacement.getAttribute("aria-expanded")).toBe("false"));
    expect(document.querySelector("iframe")).toBe(frame);
    messages[0]!({ kind: "close" });
    expect(getComputedStyle(menu).display).toBe("block");
    expect(replacement.getAttribute("aria-expanded")).toBe("true");
    document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!.click();
    host.update(false);
    expect(getComputedStyle(menu).display).toBe("block");
    expect(replacement.getAttribute("aria-expanded")).toBe("true");
  });

  it("does not re-expand groups that ADO collapsed while the workspace was open", () => {
    const group = document.createElement("div");
    group.className = "hub-group-container expanded-container";
    group.innerHTML = '<a class="hub-group" aria-expanded="true">Overview</a><div role="menu">Summary</div>';
    document.querySelector(".project-navigation")!.append(group);
    document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!.click();
    group.classList.remove("expanded-container");
    messages[0]!({ kind: "close" });
    expect(group.querySelector(".hub-group")?.getAttribute("aria-expanded")).toBe("false");
  });

  it.each([
    ["https://dev.azure.com/org/Project%20Space/_git/repo/pullrequest/42?_a=files&path=old#diff", "https://dev.azure.com/org/Project%20Space?adoBoostPrHome=dashboard"],
    ["https://dev.azure.com/org/project/_workitems/edit/42?query=old", "https://dev.azure.com/org/project?adoBoostPrHome=dashboard"],
    ["https://org.visualstudio.com/Project%20Space/_git/repo/pullrequests?_a=mine", "https://org.visualstudio.com/Project%20Space?adoBoostPrHome=dashboard"]
  ])("opens PR Home at project Overview from %s", (source, destination) => {
    vi.stubGlobal("location", new URL(source));
    host.update(true);
    const entry = document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!;
    expect(entry.href).toBe(destination);
    const overview = document.createElement("a");
    overview.id = "__bolt-ms-vss-web-home-hub-group-link";
    overview.href = destination.split("?")[0]!;
    const nativeNavigate = vi.fn((event: MouseEvent) => event.preventDefault());
    overview.addEventListener("click", nativeNavigate);
    document.querySelector(".project-navigation")!.append(overview);
    const replace = vi.spyOn(history, "replaceState").mockImplementation((_state, _unused, url) => {
      vi.stubGlobal("location", new URL(String(url)));
    });
    let browserNavigation = false;
    entry.addEventListener("click", (event) => { browserNavigation = !event.defaultPrevented; event.preventDefault(); });
    entry.click();
    expect(browserNavigation).toBe(false);
    expect(nativeNavigate).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
    vi.stubGlobal("location", new URL(overview.href));
    host.update(true);
    expect(replace).not.toHaveBeenCalled();
    overview.classList.add("displayed");
    host.update(true);
    expect(replace).toHaveBeenCalledExactlyOnceWith(history.state, "", new URL(destination));
    expect(location.href).toBe(destination);
    expect(document.querySelector("iframe")).not.toBeNull();
  });

  it("reports a missing native Overview link instead of reloading or fabricating its route", () => {
    history.replaceState(null, "", "/org/project/_git/repo");
    host.update(true);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!.click();
    expect(location.pathname).toBe("/org/project/_git/repo");
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not find");
    expect(error).toHaveBeenCalledTimes(1);
  });

  it.each(["timeout", "other page", "disable"])("bounds a pending native transition and handles %s", async (outcome) => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    history.replaceState(null, "", "/org/project/_git/repo");
    const overview = document.createElement("a");
    overview.id = "__bolt-ms-vss-web-home-hub-group-link";
    overview.href = "/org/project";
    overview.addEventListener("click", (event) => event.preventDefault());
    document.querySelector(".project-navigation")!.append(overview);
    host.update(true);
    document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!.click();
    if (outcome === "other page") {
      history.replaceState(null, "", "/org/project/_workitems");
      host.update(true);
    }
    if (outcome === "disable") host.update(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(document.querySelector("iframe")).toBeNull();
    expect(error).toHaveBeenCalledTimes(outcome === "timeout" ? 1 : 0);
    expect(document.querySelector('[role="alert"]') !== null).toBe(outcome === "timeout");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps modified PR Home clicks as normal canonical links", () => {
    history.replaceState(null, "", "/org/project/_git/repo");
    host.update(true);
    const entry = document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!;
    let prevented = true;
    entry.addEventListener("click", (event) => { prevented = event.defaultPrevented; event.preventDefault(); });
    entry.dispatchEvent(new MouseEvent("click", { ctrlKey: true, bubbles: true, cancelable: true }));
    expect(prevented).toBe(false);
    expect(entry.href).toBe("https://dev.azure.com/org/project?adoBoostPrHome=dashboard");
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("matches the native background before showing the themed frame and follows theme changes", () => {
    const content = document.querySelector<HTMLElement>(".region-content")!;
    content.style.setProperty("--background-color", "rgb(27, 27, 27)");
    document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!.click();
    const frame = document.querySelector("iframe")!;
    const surface = document.querySelector<HTMLElement>('[data-ado-boost-workspace="surface"]')!;
    expect(frame.style.backgroundColor).toBe("rgb(27, 27, 27)");
    expect(surface.style.backgroundColor).toBe("rgb(27, 27, 27)");
    expect(frame.style.colorScheme).toBe("dark");
    expect(frame.style.visibility).toBe("hidden");
    messages[0]!({ kind: "theme", id: "theme" });
    expect(frame.style.visibility).toBe("hidden");
    messages[0]!({ kind: "ready", id: "ready" });
    expect(frame.style.visibility).toBe("visible");
    expect(postMessage).toHaveBeenLastCalledWith({ id: "ready", ok: true, data: null });
    content.style.setProperty("--background-color", "rgb(255, 255, 255)");
    messages[0]!({ kind: "theme", id: "light-theme" });
    expect(frame.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(surface.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(frame.style.colorScheme).toBe("light");
    messages[0]!({ kind: "close" });
    expect(document.querySelector('[data-ado-boost-workspace="surface"]')).toBeNull();
  });

  it("opens in place on Overview and clears unrelated route parameters without reloading the frame", () => {
    history.replaceState(null, "", "/org/project?old=1#section");
    host.update(true);
    const entry = document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!;
    entry.click();
    expect(location.href).toBe("https://dev.azure.com/org/project?adoBoostPrHome=dashboard");
    const frame = document.querySelector("iframe");
    messages[0]!({ kind: "navigate", view: "people" });
    entry.click();
    expect(location.href).toBe("https://dev.azure.com/org/project?adoBoostPrHome=dashboard");
    expect(document.querySelector("iframe")).toBe(frame);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("preserves native URL parameters on existing deep workspace links through tab changes and closing", () => {
    history.replaceState(null, "", "/org/project/_git/repo/pullrequests?_a=mine&keep=1&adoBoostPrHome=dashboard");
    host.update(true);
    const frame = document.querySelector("iframe");
    messages[0]!({ kind: "navigate", view: "people" });
    expect(document.querySelector("iframe")).toBe(frame);
    messages[0]!({ kind: "close" });
    expect(location.href).toBe("https://dev.azure.com/org/project/_git/repo/pullrequests?_a=mine&keep=1");
  });

  it("suppresses native selection only while PR Home is open and restores native styles on exit", async () => {
    const nativeStyles = document.createElement("style");
    nativeStyles.textContent = ".project-navigation .displayed-container, .project-navigation .navigation-link.displayed { background-color: rgb(200, 200, 200); } .project-navigation .navigation-link.displayed .navigation-text { font-weight: 600; }";
    document.body.append(nativeStyles);
    const group = document.createElement("div");
    group.className = "hub-group-container displayed-container";
    group.innerHTML = '<a class="navigation-link hub-group displayed"><span class="navigation-text">Repos</span></a><a class="navigation-link hub displayed"><span class="navigation-text">Files</span></a>';
    document.querySelector(".project-navigation")!.append(group);
    const link = group.querySelector<HTMLElement>(".hub")!;
    const label = link.querySelector<HTMLElement>(".navigation-text")!;
    expect(getComputedStyle(link).backgroundColor).toBe("rgb(200, 200, 200)");
    document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!.click();
    expect(getComputedStyle(group).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(link).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(label).fontWeight).toBe("400");
    expect(link.classList.contains("displayed")).toBe(true);
    const replacement = link.cloneNode(true) as HTMLElement;
    link.replaceWith(replacement);
    await vi.waitFor(() => expect(getComputedStyle(replacement).backgroundColor).toBe("rgba(0, 0, 0, 0)"));
    messages[0]!({ kind: "close" });
    expect(getComputedStyle(group).backgroundColor).toBe("rgb(200, 200, 200)");
    expect(getComputedStyle(replacement).backgroundColor).toBe("rgb(200, 200, 200)");
    expect(getComputedStyle(replacement.querySelector(".navigation-text")!).fontWeight).toBe("600");
    document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!.click();
    host.update(false);
    expect(getComputedStyle(replacement).backgroundColor).toBe("rgb(200, 200, 200)");
  });

  it("puts PR Home before native navigation links with the ADO Boost icon", async () => {
    document.querySelector(".project-navigation")!.innerHTML = '<div class="navigation-section" role="menubar"><a href="/org/project">Overview</a></div>';
    await vi.waitFor(() => expect(document.querySelector(".navigation-section")?.firstElementChild?.textContent).toBe("PR Home"));
    const entry = document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!;
    expect(entry.querySelector("img")?.src).toBe("chrome-extension://test/icons/ado-boost.svg");
    expect(entry.getAttribute("role")).toBe("menuitem");
    expect(entry.querySelector(".expanded-only")?.textContent).toBe("PR Home");
    entry.click();
    expect(entry.getAttribute("aria-current")).toBe("page");
    messages[0]!({ kind: "close" });
    expect(entry.hasAttribute("aria-current")).toBe(false);
  });

  it("mounts one entry and frame without replacing native content; closes reversibly", async () => {
    const native = document.getElementById("native");
    const input = document.querySelector("input")!;
    input.focus();
    document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!.click();
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(document.querySelector(".region-content")?.classList.contains("ado-boost-workspace-hidden")).toBe(true);
    expect(document.getElementById("native")).toBe(native);
    expect(location.href).toBe("https://dev.azure.com/org/project?adoBoostPrHome=dashboard");
    host.update(true);
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    messages[0]!({ kind: "close" });
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector(".region-content")?.classList.contains("ado-boost-workspace-hidden")).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(disconnect).toHaveBeenCalled();
  });

  it("remounts after native replacement and restores on master disable", async () => {
    document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!.click();
    const original = document.querySelector("iframe");
    const content = document.querySelector(".region-content")!;
    const replacement = document.createElement("main"); replacement.className = "region-content";
    content.replaceWith(replacement);
    await vi.waitFor(() => expect(document.querySelector("iframe")).not.toBe(original));
    expect(replacement.classList.contains("ado-boost-workspace-hidden")).toBe(true);
    host.update(false);
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("[data-ado-boost-workspace=entry]")).toBeNull();
    expect(replacement.classList.contains("ado-boost-workspace-hidden")).toBe(false);
    host.update(true);
    expect(document.querySelectorAll("[data-ado-boost-workspace=entry]")).toHaveLength(1);
  });

  it("handles extension route Back/Forward without reusing the wrong view", async () => {
    document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!.click();
    const first = document.querySelector("iframe");
    history.replaceState(null, "", `${location.pathname}?adoBoostPrHome=feed&_a=mine`);
    dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(document.querySelector<HTMLIFrameElement>("iframe")?.dataset.route).toBe("feed|"));
    expect(document.querySelector("iframe")).toBe(first);
    expect(disconnect).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({ kind: "route", view: "feed", subject: null });
    expect(document.querySelector<HTMLIFrameElement>("iframe")?.dataset.route).toBe("feed|");
    history.replaceState(null, "", `${location.pathname}?_a=mine`);
    dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeNull());
    expect(document.querySelector("#native")?.textContent).toBe("Native content");
  });

  it("keeps the frame, host connection, and native visibility stable through tab and profile navigation", () => {
    document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!.click();
    const frame = document.querySelector("iframe");
    const person = { id: "teammate", displayName: "Teammate" };
    for (const view of ["people", "projects", "feed", "dashboard"]) {
      messages[0]!({ kind: "navigate", view });
      expect(document.querySelector("iframe")).toBe(frame);
      expect(document.querySelector(".region-content")?.classList.contains("ado-boost-workspace-hidden")).toBe(true);
      expect(postMessage).toHaveBeenLastCalledWith({ kind: "route", view, subject: null });
    }
    messages[0]!({ kind: "navigate", view: "profile", person: JSON.stringify(person) });
    expect(postMessage).toHaveBeenLastCalledWith({ kind: "route", view: "profile", subject: person });
    expect(new URL(document.querySelector<HTMLAnchorElement>("[data-ado-boost-workspace=entry]")!.href).searchParams.has("adoBoostPerson")).toBe(false);
    expect(document.querySelector("iframe")).toBe(frame);
    expect(disconnect).not.toHaveBeenCalled();
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
    const length = history.length;
    messages[0]!({ kind: "navigate", view: "profile", person: JSON.stringify(person) });
    expect(history.length).toBe(length);
  });
});
