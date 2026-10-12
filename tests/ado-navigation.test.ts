// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://dev.azure.com/org/project/_git/repo/pullrequest/7"}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigateToAdoFile } from "../src/ui/ado-navigation";

describe("ADO file navigation", () => {
  beforeEach(() => {
    history.replaceState({}, "", "/org/project/_git/repo/pullrequest/7");
    document.body.innerHTML = "";
  });

  it("uses an existing native file link instead of assigning the page location", () => {
    const native = document.createElement("a");
    native.href = "https://dev.azure.com/org/project/_git/repo/pullrequest/7?_a=files&path=%2Fsrc%2Fapp.ts";
    const clicked = vi.fn((event: Event) => event.preventDefault());
    native.addEventListener("click", clicked);
    document.body.append(native);

    navigateToAdoFile("/src/app.ts");

    expect(clicked).toHaveBeenCalledOnce();
    expect(location.pathname).toContain("/pullrequest/7");
  });

  it("falls back to a history navigation event without reloading", () => {
    const popstate = vi.fn();
    window.addEventListener("popstate", popstate, { once: true });

    navigateToAdoFile("/src/app.ts");

    expect(location.search).toContain("_a=files");
    expect(new URLSearchParams(location.search).get("path")).toBe("/src/app.ts");
    expect(popstate).toHaveBeenCalledOnce();
  });
});
