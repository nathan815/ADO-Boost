// @vitest-environment jsdom

import React from "react";
import { act, Simulate } from "react-dom/test-utils";
import { render, unmountComponentAtNode } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepositorySelector } from "../src/workspace/repository-selector";
import { WorkspaceQueries } from "../src/workspace/client";
import type { Project, Repository } from "../src/workspace/protocol";

let root: HTMLDivElement;
beforeEach(() => { root = document.createElement("div"); document.body.append(root); });
afterEach(() => { act(() => { unmountComponentAtNode(root); }); root.remove(); vi.restoreAllMocks(); });

const one = { id: "one", name: "One" };
const other = { id: "other", name: "Other" };
const repo = (id: string, project: Project = one): Repository => ({ id, name: id, project });
const names = () => [...root.querySelectorAll(".repository-list label")].map((label) => label.textContent);
function setup() {
  const queries = new WorkspaceQueries({ request: vi.fn().mockResolvedValue(null) });
  const read = vi.spyOn(queries, "read");
  return {
    queries, read, projects: [other, one], currentProject: one, suggestions: [] as Repository[],
    suggestionsLoading: false, favorites: [] as string[], saving: false, toggle: vi.fn()
  };
}
function choose(project: string) {
  const select = root.querySelector("select")!;
  select.value = project;
  Simulate.change(select);
}

describe("repository selector", () => {
  it("defaults to the current project and shows every suggestion before paginated repository results", async () => {
    const props = setup();
    const repos = Array.from({ length: 16_001 }, (_, index) => repo(`Repo ${String(index).padStart(5, "0")}`));
    props.suggestions = [repos[16_000]!, repo("Suggested elsewhere", other)];
    props.favorites = [repos[0]!.id];
    props.read.mockResolvedValue(repos);
    await act(async () => { render(<RepositorySelector {...props} />, root); });
    expect(root.querySelector("select")?.value).toBe("one");
    expect(props.read).toHaveBeenCalledExactlyOnceWith({ kind: "repositories", project: "One" });
    expect(root.querySelectorAll(".repository-list label")).toHaveLength(102);
    expect(names().slice(0, 3)).toEqual([
      "One / Repo 16000 · Your PR activity", "Other / Suggested elsewhere · Your PR activity", "One / Repo 00000"
    ]);
    expect(root.querySelector(".repository-count")?.textContent).toBe("2 suggested · 100 of 16,000 other repositories");
    await act(async () => { root.querySelector<HTMLButtonElement>("button")!.click(); });
    expect(root.querySelectorAll(".repository-list label")).toHaveLength(202);
    expect(props.read).toHaveBeenCalledTimes(1);
    const filter = root.querySelector<HTMLInputElement>("input[type=search]")!;
    act(() => { filter.value = "Repo 15999"; Simulate.change(filter); });
    expect(names()).toEqual(["One / Repo 15999"]);
    expect(root.querySelector("button")).toBeNull();
    act(() => { filter.value = ""; Simulate.change(filter); });
    expect(root.querySelectorAll(".repository-list label")).toHaveLength(102);
  });

  it("ignores late results from a different project and reuses loaded lists", async () => {
    const props = setup();
    let finishOne!: (repos: Repository[]) => void;
    props.read.mockImplementation(async (query) => {
      if (query.kind === "repositories" && query.project === "One") return new Promise<Repository[]>((resolve) => { finishOne = resolve; });
      return [repo("Other repo", other)];
    });
    await act(async () => { render(<RepositorySelector {...props} />, root); });
    expect(root.querySelector(".repository-list")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => { choose("other"); });
    expect(names()).toEqual(["Other / Other repo"]);
    await act(async () => { finishOne([repo("Late One repo")]); });
    expect(names()).toEqual(["Other / Other repo"]);
    props.read.mockResolvedValue([repo("One repo")]);
    await act(async () => { choose("one"); });
    expect(names()).toEqual(["One / One repo"]);
    await act(async () => { choose("other"); });
    expect(names()).toEqual(["Other / Other repo"]);
    expect(props.read).toHaveBeenCalledTimes(3);
  });

  it("shows request failures locally without hiding suggestions and recovers when switching projects", async () => {
    const props = setup();
    props.suggestions = [repo("Suggestion")];
    props.read.mockRejectedValueOnce(new Error("Repository access denied")).mockImplementation(async (query) =>
      query.kind === "repositories" && query.project === "One" ? [repo("One repo")] : [repo("Other repo", other)]);
    await act(async () => { render(<RepositorySelector {...props} />, root); });
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("Repository access denied");
    expect(names()).toEqual(["One / Suggestion · Your PR activity"]);
    await act(async () => { choose("other"); });
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(names()).toEqual(["One / Suggestion · Your PR activity", "Other / Other repo"]);
    props.projects = [one];
    await act(async () => { render(<RepositorySelector {...props} />, root); });
    expect(root.querySelector("select")?.value).toBe("one");
    expect(names()).toEqual(["One / Suggestion · Your PR activity", "One / One repo"]);
  });
});
