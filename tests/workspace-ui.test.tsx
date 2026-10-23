// @vitest-environment jsdom

import React from "react";
import { act, Simulate } from "react-dom/test-utils";
import { render, unmountComponentAtNode } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityView } from "../src/workspace/views";
import { ProfileView } from "../src/workspace/profile-view";
import { contributionCalendar, profilePeriod } from "../src/workspace/profile";
import { WorkspaceApp } from "../src/workspace/app";
import { Projects } from "../src/workspace/discovery";
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
  it("collapses only after the initial confirmation is saved and remembers confirmation after reopening", async () => {
    const props = setup("profile");
    props.session.view = "projects";
    const extra = { id: "extra", name: "Extra" };
    const read = vi.spyOn(props.queries, "read").mockImplementation(async (query) =>
      query.kind === "projects" ? { items: [extra], more: true, continuation: "next" } : []);
    let stored = props.session;
    let complete!: () => void;
    vi.mocked(props.client.request).mockImplementation(async (request) => {
      if (request.type === "preferences") {
        if (request.value) {
          const preferences = request.value;
          return new Promise<WorkspaceSession>((resolve) => { complete = () => {
            stored = { ...stored, preferences }; resolve(stored);
          }; });
        }
        return stored;
      }
      if (request.type === "workspace-suggestions") return { projects: [], repositories: [] };
      return null;
    });
    await act(async () => { render(<WorkspaceApp {...props} />, root); });
    const repositories = root.querySelector(".repository-selector");
    const confirm = [...root.querySelectorAll<HTMLButtonElement>(".projects-surface button")]
      .find((button) => button.textContent === "Confirm selections")!;
    expect(root.querySelectorAll(".project-grid input:checked")).toHaveLength(1);
    expect(root.querySelector(".selected-projects")).toBeNull();
    await act(async () => { confirm.click(); });
    expect(props.client.request).toHaveBeenCalledWith({ type: "preferences", value: { ...props.session.preferences, projectsConfirmed: true } });
    expect(root.querySelector(".project-grid")).not.toBeNull();
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    await act(async () => { complete(); });
    expect(root.querySelector(".project-grid")).toBeNull();
    expect(root.querySelector(".projects-surface input")).toBeNull();
    expect([...root.querySelectorAll(".selected-projects li")].map((item) => item.textContent)).toEqual(["Project"]);
    expect(root.querySelector(".projects-surface button")?.textContent).toBe("Edit projects");
    expect(root.querySelector(".projects-surface")?.textContent).not.toContain("Load more projects");
    expect(root.querySelector(".repository-selector")).toBe(repositories);
    act(() => { unmountComponentAtNode(root); });
    await act(async () => { render(<WorkspaceApp {...props} />, root); });
    expect(root.querySelector(".project-grid")).toBeNull();
    expect(root.querySelector(".selected-projects")?.textContent).toBe("Project");
    expect(read.mock.calls.filter(([query]) => query.kind === "projects")).toHaveLength(1);
  });

  it("opens the complete project editor explicitly and returns to a read-only selection summary", async () => {
    const props = setup("profile");
    props.session.preferences.projectsConfirmed = true;
    const extra = { id: "extra", name: "Extra" };
    const read = vi.spyOn(props.queries, "read").mockImplementation(async (query) =>
      query.kind === "projects" ? { items: [extra], more: true, continuation: "next" } : []);
    vi.mocked(props.client.request).mockResolvedValue({ projects: [extra], repositories: [] });
    const renderProjects = () => render(<Projects {...props} saving={false} />, root);
    await act(async () => { renderProjects(); });
    expect(root.querySelector(".projects-surface input")).toBeNull();
    expect(root.querySelector(".selected-projects")?.textContent).toBe("Project");
    expect(read.mock.calls.some(([query]) => query.kind === "projects")).toBe(false);
    await act(async () => { root.querySelector<HTMLButtonElement>(".projects-surface button")!.click(); });
    expect(root.querySelector(".projects-surface button")?.textContent).toBe("Done");
    expect(root.querySelectorAll(".project-grid input")).toHaveLength(2);
    await act(async () => { root.querySelector<HTMLInputElement>(".project-grid input:not(:checked)")!.click(); });
    expect(props.save).toHaveBeenCalledWith({ ...props.session.preferences, projects: [...props.session.preferences.projects, extra] });
    props.session.preferences.projects.push(extra);
    await act(async () => { renderProjects(); });
    expect(root.querySelector(".project-grid")).not.toBeNull();
    await act(async () => { root.querySelector<HTMLButtonElement>(".projects-surface button")!.click(); });
    expect(root.querySelector(".projects-surface input")).toBeNull();
    expect([...root.querySelectorAll(".selected-projects li")].map((item) => item.textContent)).toEqual(["Extra", "Project"]);
    await act(async () => { root.querySelector<HTMLButtonElement>(".projects-surface button")!.click(); });
    expect(root.querySelector(".project-grid")).not.toBeNull();
    expect(read.mock.calls.filter(([query]) => query.kind === "projects")).toHaveLength(1);
  });

  it("keeps the editor open when confirmation fails and reports the save error", async () => {
    const props = setup("profile");
    props.session.view = "projects";
    vi.spyOn(props.queries, "read").mockImplementation(async (query) => query.kind === "projects" ? { items: [], more: false } : []);
    vi.mocked(props.client.request).mockImplementation(async (request) => {
      if (request.type === "preferences") {
        if (request.value) throw new Error("Preferences could not be saved");
        return props.session;
      }
      if (request.type === "workspace-suggestions") return { projects: [], repositories: [] };
      return null;
    });
    await act(async () => { render(<WorkspaceApp {...props} />, root); });
    await act(async () => { root.querySelector<HTMLButtonElement>(".projects-surface button")!.click(); });
    expect(root.querySelector(".project-grid")).not.toBeNull();
    expect(root.querySelector(".selected-projects")).toBeNull();
    expect(root.querySelector(".projects-surface button")?.textContent).toBe("Confirm selections");
    expect(root.querySelector('[role=alert]')?.textContent).toContain("Preferences could not be saved");
  });

  it("requires a nonempty selection before closing the editor", async () => {
    const props = setup("profile");
    props.session.preferences.projects = [];
    props.session.preferences.projectsConfirmed = true;
    vi.spyOn(props.queries, "read").mockImplementation(async (query) =>
      query.kind === "projects" ? { items: [{ id: "extra", name: "Extra" }], more: false } : []);
    vi.mocked(props.client.request).mockResolvedValue({ projects: [], repositories: [] });
    await act(async () => { render(<Projects {...props} saving={false} />, root); });
    expect(root.querySelector(".project-grid")).not.toBeNull();
    expect(root.querySelector(".projects-surface button")?.getAttribute("aria-disabled")).toBe("true");
    await act(async () => { root.querySelector<HTMLButtonElement>(".projects-surface button")!.click(); });
    expect(props.save).not.toHaveBeenCalled();
    expect(root.querySelector(".selected-projects")).toBeNull();
    props.session.preferences.projects = [{ id: "extra", name: "Extra" }];
    await act(async () => { render(<Projects {...props} saving={false} />, root); });
    expect(root.querySelector(".project-grid")).not.toBeNull();
    expect(root.querySelector(".projects-surface button")?.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("keeps the project form mounted and saving feedback out of layout during preference saves", async () => {
    const props = setup("profile");
    props.session.view = "projects";
    const extra = { id: "extra", name: "Extra" };
    vi.spyOn(props.queries, "read").mockImplementation(async (query) => query.kind === "projects" ? { items: [extra], more: false } : []);
    let complete!: (value: WorkspaceSession) => void;
    vi.mocked(props.client.request).mockImplementation(async (request) => {
      if (request.type === "preferences") {
        if (request.value) return new Promise<WorkspaceSession>((resolve) => { complete = resolve; });
        return props.session;
      }
      if (request.type === "workspace-suggestions") return { projects: [], repositories: [] };
      return null;
    });
    await act(async () => { render(<WorkspaceApp {...props} />, root); });
    const form = root.querySelector(".discovery-view");
    const grid = root.querySelector(".project-grid");
    const mainChildren = () => [...root.querySelector("main")!.children];
    const initialChildren = mainChildren();
    await act(async () => { root.querySelector<HTMLInputElement>(".project-grid input:not(:checked)")!.click(); });
    expect(root.querySelector(".discovery-view")).toBe(form);
    expect(root.querySelector(".project-grid")).toBe(grid);
    expect(mainChildren()).toEqual(initialChildren);
    const saving = root.querySelector("main > [role=status]")!;
    expect(saving.textContent).toBe("Saving local preferences...");
    expect(saving.classList.contains("sr-only")).toBe(true);
    expect([...root.querySelectorAll<HTMLInputElement>(".project-grid input")].every((input) => input.disabled)).toBe(true);
    await act(async () => { complete({
      ...props.session, preferences: { ...props.session.preferences, projects: [...props.session.preferences.projects, extra] }
    }); });
    expect(root.querySelector(".discovery-view")).toBe(form);
    expect(mainChildren()).toEqual(initialChildren);
    expect(saving.textContent).toBe("");
    expect(root.querySelectorAll(".project-grid input:checked")).toHaveLength(2);
  });

  it("shows selected projects first, even outside the loaded page, then current and PR-activity suggestions", async () => {
    const props = setup("profile");
    props.session.currentProject = { id: "one", name: "One" };
    props.session.preferences.projects = [{ id: "z", name: "Zulu" }, { id: "a", name: "Alpha" }];
    const read = vi.spyOn(props.queries, "read").mockImplementation(async (query) => query.kind === "projects" ? {
      items: [{ id: "b", name: "Beta" }, { id: "a", name: "Alpha" }], more: true, continuation: "next"
    } : []);
    vi.mocked(props.client.request).mockResolvedValue({ projects: [{ id: "s", name: "Suggested" }, { id: "one", name: "One" }], repositories: [] });
    const renderProjects = () => render(<Projects {...props} saving={false} />, root);
    await act(async () => { renderProjects(); });
    const names = () => [...root.querySelectorAll(".project-grid label > span")].map((label) => label.textContent);
    expect(names()).toEqual(["Alpha", "Zulu", "One · Current project", "Suggested · Your PR activity", "Beta"]);
    expect(root.querySelectorAll(".project-grid input:checked")).toHaveLength(2);
    expect(props.client.request).toHaveBeenCalledWith({ type: "workspace-suggestions" });
    await act(async () => { root.querySelectorAll<HTMLInputElement>(".project-grid input")[2]!.click(); });
    expect(props.save).toHaveBeenCalledWith({ ...props.session.preferences, projects: [
      ...props.session.preferences.projects, { id: "one", name: "One" }
    ] });
    props.session.preferences.projects.push({ id: "one", name: "One" });
    await act(async () => { renderProjects(); });
    expect(names()).toEqual(["Alpha", "One · Current project", "Zulu", "Suggested · Your PR activity", "Beta"]);
    read.mockResolvedValueOnce({ items: [{ id: "c", name: "Charlie" }, { id: "a", name: "Alpha" }], more: false });
    await act(async () => {
      [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Load more projects")!.click();
    });
    expect(read).toHaveBeenLastCalledWith({ kind: "projects", continuation: "next" });
    expect(names()).toEqual(["Alpha", "One · Current project", "Zulu", "Suggested · Your PR activity", "Beta", "Charlie"]);
    expect(read.mock.calls.filter(([query]) => query.kind === "repositories")).toHaveLength(1);
  });

  it("keeps project selection available when suggestions fail and enforces the selection cap", async () => {
    const props = setup("profile");
    props.session.preferences.projects = Array.from({ length: 10 }, (_, id) => ({ id: String(id), name: `Selected ${id}` }));
    vi.spyOn(props.queries, "read").mockImplementation(async (query) => query.kind === "projects" ? { items: [{ id: "extra", name: "Extra" }], more: false } : []);
    vi.mocked(props.client.request).mockRejectedValue(new Error("Project suggestions unavailable"));
    await act(async () => { render(<Projects {...props} saving={false} />, root); });
    expect(root.textContent).toContain("Project suggestions unavailable");
    expect(root.querySelectorAll(".project-grid input:checked")).toHaveLength(10);
    await act(async () => { root.querySelector<HTMLInputElement>(".project-grid input:not(:checked)")!.click(); });
    expect(props.save).not.toHaveBeenCalled();
    expect(root.textContent).toContain("Select at most 10 projects");
  });

  it("loads project repositories automatically while keeping suggestions first and saving favorites", async () => {
    const props = setup("profile");
    const project = props.session.preferences.projects[0]!;
    const alpha = { id: "alpha", name: "Alpha", project };
    const zulu = { id: "zulu", name: "Zulu", project };
    const beta = { id: "beta", name: "Beta", project };
    const read = vi.spyOn(props.queries, "read").mockImplementation(async (query) =>
      query.kind === "projects" ? { items: [project], more: false } : [alpha, beta]);
    vi.mocked(props.client.request).mockResolvedValue({ projects: [], repositories: [
      alpha, zulu, { id: "private", name: "Not selected", project: { id: "elsewhere", name: "Elsewhere" } }
    ] });
    const renderProjects = (saving = false) => render(<Projects {...props} saving={saving} />, root);
    await act(async () => { renderProjects(); });
    const labels = () => [...root.querySelectorAll(".repository-list label")].map((label) => label.textContent);
    expect(labels()).toEqual(["Project / Alpha · Your PR activity", "Project / Zulu · Your PR activity", "Project / Beta"]);
    expect(read).toHaveBeenCalledWith({ kind: "repositories", project: "Project" });
    expect(root.querySelector(".repository-selector select")?.textContent).toBe("Project");
    expect(root.textContent).not.toContain("Browse Project");
    expect(root.querySelectorAll(".repository-list input:checked")).toHaveLength(0);
    await act(async () => { root.querySelectorAll<HTMLInputElement>(".repository-list input")[1]!.click(); });
    expect(props.save).toHaveBeenLastCalledWith({ ...props.session.preferences, favorites: ["zulu"] });
    props.session.preferences.favorites = ["zulu"];
    await act(async () => { renderProjects(); });
    expect(labels()).toEqual(["Project / Alpha · Your PR activity", "Project / Zulu · Your PR activity", "Project / Beta"]);
    expect(read.mock.calls.filter(([query]) => query.kind === "repositories")).toHaveLength(1);
    const filter = root.querySelector<HTMLInputElement>(".surface input[type=search]")!;
    act(() => { filter.value = "project / alpha"; Simulate.change(filter); });
    expect(labels()).toEqual(["Project / Alpha · Your PR activity"]);
    act(() => { filter.value = ""; Simulate.change(filter); });
    await act(async () => { root.querySelector<HTMLInputElement>(".repository-list input:checked")!.click(); });
    expect(props.save).toHaveBeenLastCalledWith({ ...props.session.preferences, favorites: [] });
    await act(async () => { renderProjects(true); });
    expect([...root.querySelectorAll<HTMLInputElement>(".repository-list input")].every((input) => input.disabled)).toBe(true);
    props.session.preferences.projects = [];
    await act(async () => { renderProjects(); });
    expect(root.querySelector(".repository-list")).toBeNull();
    expect(props.client.request).toHaveBeenCalledTimes(2);
  });

  it("explains empty repository results and bounds favorite selection", async () => {
    const props = setup("profile");
    vi.spyOn(props.queries, "read").mockImplementation(async (query) => query.kind === "projects" ? { items: [], more: false } : []);
    vi.mocked(props.client.request).mockResolvedValue({ projects: [], repositories: [] });
    await act(async () => { render(<Projects {...props} saving={false} />, root); });
    expect(root.textContent).toContain("No repositories found in this project");
    act(() => { unmountComponentAtNode(root); });
    props.session.preferences.favorites = Array.from({ length: 1000 }, (_, id) => String(id));
    vi.mocked(props.client.request).mockResolvedValue({ projects: [], repositories: [
      { id: "extra", name: "Extra", project: props.session.preferences.projects[0]! }
    ] });
    await act(async () => { render(<Projects {...props} saving={false} />, root); });
    await act(async () => { root.querySelector<HTMLInputElement>(".repository-list input")!.click(); });
    expect(props.save).not.toHaveBeenCalled();
    expect(root.textContent).toContain("Select at most 1000 repository favorites");
  });

  it("does not show an empty-suggestions message before the activity cache has loaded", async () => {
    const props = setup("profile");
    vi.spyOn(props.queries, "read").mockImplementation(async (query) => query.kind === "projects" ? { items: [], more: false } : []);
    let complete!: (value: { projects: []; repositories: [] }) => void;
    vi.mocked(props.client.request).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    await act(async () => { render(<Projects {...props} saving={false} />, root); });
    expect(root.textContent).toContain("Loading repository suggestions");
    expect([...root.querySelectorAll('[role="status"]')].filter((element) => element.textContent?.includes("Loading"))
      .every((element) => element.classList.contains("sr-only"))).toBe(true);
    expect(root.textContent).not.toContain("No repositories found in this project");
    await act(async () => { complete({ projects: [], repositories: [] }); });
    expect(root.textContent).not.toContain("Loading repository suggestions");
    expect(root.textContent).toContain("No repositories found in this project");
  });

  it("keeps repository loading and failures separate from the projects tile", async () => {
    const props = setup("profile");
    let fail!: (reason: Error) => void;
    vi.spyOn(props.queries, "read").mockImplementation(async (query) => query.kind === "projects" ?
      { items: [], more: true, continuation: "next" } : new Promise((_, reject) => { fail = reject; }));
    vi.mocked(props.client.request).mockResolvedValue({ projects: [], repositories: [] });
    await act(async () => { render(<Projects {...props} saving={false} />, root); });
    const projectsTile = root.querySelector(".project-grid")!.closest("section")!;
    expect(projectsTile.querySelector('[role="status"]')?.textContent).toBe("");
    expect([...projectsTile.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Load more projects")?.disabled).toBe(false);
    expect(root.querySelector(".repository-count")?.textContent).toBe("Loading repositories...");
    await act(async () => { fail(new Error("Repository access denied")); });
    expect(root.querySelector(".repository-selector [role=alert]")?.textContent).toContain("Repository access denied");
    expect(projectsTile.querySelector('[role="alert"]')).toBeNull();
  });

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
    expect(root.querySelector(".brand")?.textContent).toBe("PR Home");
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
