// @vitest-environment jsdom

import React from "react";
import { act } from "react-dom/test-utils";
import { render, unmountComponentAtNode } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityView } from "../src/workspace/views";
import { ProfileView } from "../src/workspace/profile-view";
import { contributionCalendar, profilePeriod } from "../src/workspace/profile";
import { WorkspaceApp } from "../src/workspace/app";
import { WorkspaceQueries, type WorkspaceClient } from "../src/workspace/client";
import { WorkspaceService } from "../src/workspace/service";
import { prSchema, type WorkspaceSession } from "../src/workspace/protocol";

let root: HTMLDivElement;
beforeEach(() => { root = document.createElement("div"); document.body.append(root); });
afterEach(() => {
  act(() => { unmountComponentAtNode(root); }); root.remove();
  document.documentElement.style.removeProperty("--background-color");
  document.documentElement.style.removeProperty("color-scheme");
  vi.restoreAllMocks(); vi.useRealTimers();
});

function setup(view: "profile" | "feed") {
  const person = { id: "me", displayName: "Me" };
  const session: WorkspaceSession = {
    context: { origin: "https://dev.azure.com", organization: "org", base: "https://dev.azure.com/org" },
    viewer: person, subject: person, view, theme: {},
    preferences: { projects: [{ id: "p", name: "Project" }], follows: [{ id: "other", displayName: "Other" }], favorites: [] }
  };
  const transport = { request: vi.fn().mockResolvedValue(null) };
  const queries = new WorkspaceQueries(transport);
  const service = new WorkspaceService(queries);
  const pr = prSchema.parse({
    pullRequestId: 1, title: "A real contribution", status: "active", creationDate: new Date().toISOString(),
    createdBy: person, repository: { id: "r", name: "Repo", project: { id: "p", name: "Project" } }, reviewers: []
  });
  vi.spyOn(service, "prs").mockResolvedValue({ created: [pr], assigned: [], errors: [], more: false });
  vi.spyOn(service, "profile").mockResolvedValue({ created: [pr], assigned: [], errors: [], more: false });
  vi.spyOn(service, "reviews").mockResolvedValue({ events: [], errors: [], analyzed: [] });
  const feed = vi.spyOn(service, "feed").mockResolvedValue({ prs: [], events: [], errors: [], more: false });
  return { session, service, queries, client: transport as unknown as WorkspaceClient, save: vi.fn(), openPerson: vi.fn(), feed };
}

describe("workspace views", () => {
  it("applies the host theme and renders the shell before revealing the frame", async () => {
    const props = setup("profile");
    props.session.theme = { "--background-color": "rgb(27, 27, 27)" };
    let ready = false;
    vi.mocked(props.client.request).mockImplementation(async (request) => {
      if (request.type === "preferences") return props.session;
      if (request.type === "ready") {
        expect(document.documentElement.style.colorScheme).toBe("dark");
        expect(document.documentElement.style.getPropertyValue("--background-color")).toBe("rgb(27, 27, 27)");
        expect(root.querySelector(".workspace-header")).not.toBeNull();
        ready = true;
      }
      return null;
    });
    await act(async () => { render(<WorkspaceApp {...props} />, root); });
    expect(ready).toBe(true);
    expect([...root.querySelectorAll(".workspace-tabs > div > button")].map((button) => button.textContent)).toEqual([
      "My PRs", "Activity feed", "Profile", "Projects", "People"
    ]);
  });

  it("requests the host theme and reveals the session error rather than leaving a hidden frame", async () => {
    const props = setup("profile");
    vi.mocked(props.client.request).mockImplementation(async (request) => {
      if (request.type === "preferences") throw new Error("Session expired");
      return null;
    });
    await act(async () => { render(<WorkspaceApp {...props} />, root); });
    expect(root.textContent).toContain("Session expired");
    expect(vi.mocked(props.client.request).mock.calls.map(([request]) => request.type)).toEqual(["preferences", "ping", "ready"]);
  });

  it("coalesces focus and visibility session checks instead of restarting verification on every event", async () => {
    const props = setup("profile");
    vi.mocked(props.client.request).mockImplementation(async (request) => request.type === "preferences" ? props.session : null);
    await act(async () => { render(<WorkspaceApp {...props} />, root); });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let complete!: (session: WorkspaceSession) => void;
    vi.mocked(props.client.request).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    act(() => {
      window.dispatchEvent(new Event("focus"));
      for (let index = 0; index < 10; index++) document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(vi.mocked(props.client.request).mock.calls.filter(([request]) => request.type === "preferences")).toHaveLength(2);
    await act(async () => complete(props.session));
    expect(props.service.profile).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a newer history route with a late session response", async () => {
    const props = setup("profile");
    let complete!: (session: WorkspaceSession) => void;
    vi.mocked(props.client.request).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    act(() => { render(<WorkspaceApp {...props} />, root); });
    act(() => { document.dispatchEvent(new CustomEvent("workspace-route", { detail: { view: "people", subject: null } })); });
    await act(async () => complete(props.session));
    expect(root.querySelector("h1")?.textContent).toBe("People");
  });

  it("updates the current view without remounting the workspace shell or reconnecting", async () => {
    const props = setup("profile");
    vi.mocked(props.client.request).mockImplementation(async (request) => request.type === "preferences" ? props.session : null);
    await act(async () => { render(<WorkspaceApp {...props} />, root); });
    const header = root.querySelector(".workspace-header");
    expect(root.querySelector("h1")?.textContent).toBe("Me");
    await act(async () => {
      [...root.querySelectorAll<HTMLButtonElement>(".workspace-tabs button")].find((button) => button.textContent === "People")!.click();
      document.dispatchEvent(new CustomEvent("workspace-route", { detail: { view: "people", subject: null } }));
    });
    expect(props.client.request).toHaveBeenCalledWith({ type: "navigate", view: "people" });
    expect(root.querySelector("h1")?.textContent).toBe("People");
    expect(root.querySelector(".workspace-header")).toBe(header);
    expect(vi.mocked(props.client.request).mock.calls.filter(([request]) => request.type === "preferences")).toHaveLength(1);
    await act(async () => {
      document.dispatchEvent(new CustomEvent("workspace-route", { detail: { view: "dashboard", subject: null } }));
    });
    expect(root.querySelector("h1")?.textContent).toBe("My pull requests");
    expect(props.service.prs).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.anything(), 0, "active", expect.anything(), false);
    await act(async () => {
      document.dispatchEvent(new CustomEvent("workspace-route", { detail: { view: "profile", subject: { id: "other", displayName: "Other" } } }));
    });
    expect(root.querySelector("h1")?.textContent).toBe("Other");
    expect(props.service.profile).toHaveBeenLastCalledWith(expect.objectContaining({ id: "other" }), expect.anything(), expect.anything(), expect.anything(), false);
  });

  it("keeps the loaded PR cards visible while refreshing", async () => {
    const props = setup("profile");
    await act(async () => { render(<ProfileView {...props} />, root); });
    let complete!: (value: Awaited<ReturnType<WorkspaceService["profile"]>>) => void;
    vi.mocked(props.service.profile).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const card = root.querySelector(".pr-list li");
    const refresh = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Refresh history")!;
    await act(async () => refresh.click());
    expect(root.querySelector(".pr-list li")).toBe(card);
    expect(root.textContent).toContain("Previous results remain visible");
    await act(async () => complete({ created: [], assigned: [], more: false, errors: [] }));
    expect(root.querySelector(".pr-list li")).toBeNull();
  });

  it("defaults to a full past-year graph and links days to PRScope's PR creation-day lists", async () => {
    const props = setup("profile");
    await act(async () => { render(<ProfileView {...props} />, root); });
    expect(root.querySelector("select")?.value).toBe("last-1y");
    expect(root.querySelectorAll(".profile-calendar rect")).toHaveLength(contributionCalendar(profilePeriod("last-1y"), 800).days.length);
    const day = root.querySelector<SVGRectElement>('.profile-calendar rect[data-active="true"]')!;
    expect(day).not.toBeNull();
    act(() => { day.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(day.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector(".pr-list")?.textContent).toContain("A real contribution");
    expect(root.textContent).not.toContain("sample");
    expect(root.textContent).not.toContain("Load more PRs");
  });

  it("loads review details for every reviewed PR, not a sample, and does not force cached ranges after changing the period", async () => {
    const props = setup("profile");
    const reviewed = Array.from({ length: 75 }, (_, index) => prSchema.parse({
      pullRequestId: index + 1, title: `Reviewed ${index}`, status: "completed", creationDate: new Date().toISOString(),
      createdBy: { id: "other", displayName: "Other" }, repository: { id: "r", name: "Repo", project: { id: "p", name: "Project" } },
      reviewers: [{ id: "me", displayName: "Me", vote: 10 }]
    }));
    vi.mocked(props.service.profile).mockResolvedValue({ created: [], assigned: reviewed, errors: [], more: false });
    await act(async () => { render(<ProfileView {...props} />, root); });
    expect(props.service.reviews).toHaveBeenCalledWith(reviewed, expect.anything(), false);
    expect(root.querySelectorAll(".pr-list li")).toHaveLength(50);
    expect(root.querySelector(".pr-section:nth-child(2) .count")?.textContent).toBe("75");
    const refresh = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Refresh history")!;
    await act(async () => refresh.click());
    expect(props.service.profile).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.anything(), true);
    const range = root.querySelector("select")!;
    await act(async () => { range.value = "last-6m"; range.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(props.service.profile).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.anything(), false);
    const more = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Show more PRs")!;
    await act(async () => more.click());
    expect(root.querySelectorAll(".pr-list li")).toHaveLength(75);
  });

  it("refreshes the feed only while visible and stops after unmount", async () => {
    vi.useFakeTimers();
    let visibility = "hidden";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility as DocumentVisibilityState);
    const props = setup("feed");
    await act(async () => { render(<ActivityView {...props} />, root); });
    expect(props.feed).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(props.feed).toHaveBeenCalledTimes(1);
    visibility = "visible";
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(props.feed).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(props.feed).toHaveBeenCalledTimes(3);
    act(() => { unmountComponentAtNode(root); });
    vi.advanceTimersByTime(240_000);
    expect(props.feed).toHaveBeenCalledTimes(3);
  });

  it("does not render a late profile response after a filter change", async () => {
    const props = setup("profile");
    let complete!: (value: Awaited<ReturnType<WorkspaceService["profile"]>>) => void;
    vi.mocked(props.service.profile).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await act(async () => { render(<ProfileView {...props} />, root); });
    const select = root.querySelector("select")!;
    await act(async () => { select.value = "last-1m"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { complete({ created: [], assigned: [], errors: ["Late error"], more: false }); });
    expect(root.textContent).not.toContain("Late error");
    expect(root.textContent).toContain("A real contribution");
  });
});
