// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://dev.azure.com/org/project/_git/repo/pullrequest/7"}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigateToAdoComment, navigateToAdoFile } from "../src/ui/ado-navigation";

describe("ADO file navigation", () => {
  beforeEach(() => {
    history.replaceState({}, "", "/org/project/_git/repo/pullrequest/7");
    document.body.innerHTML = "";
  });

  describe("ADO comment navigation", () => {
    const date = "2026-10-15T12:00:00.23Z";

    beforeEach(() => {
      document.body.innerHTML = "";
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function addComment() {
      const comment = document.createElement("div");
      comment.className = "repos-discussion-comment";
      comment.innerHTML = '<div class="repos-discussion-comment-header"><time datetime="2026-10-15T12:00:00.230Z"></time></div>';
      comment.scrollIntoView = vi.fn();
      document.body.append(comment);
      return comment;
    }

    it("scrolls to and focuses an existing native comment, normalizing timestamp precision", async () => {
      const comment = addComment();
      await navigateToAdoComment(date);
      expect(comment.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
      expect(document.activeElement).toBe(comment);
      expect(comment.tabIndex).toBe(-1);
      comment.blur();
      expect(comment.hasAttribute("tabindex")).toBe(false);
    });

    it("opens the native Overview tab and waits for its comment to render", async () => {
      document.body.innerHTML = '<a role="tab" href="?_a=overview">Overview</a>';
      let comment: HTMLElement | undefined;
      document.querySelector("a")!.addEventListener("click", (event) => {
        event.preventDefault();
        queueMicrotask(() => { comment = addComment(); });
      });
      await navigateToAdoComment(date);
      expect(comment!.scrollIntoView).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(comment);
    });

    it("reports hidden comments and disconnects its observer after the navigation timeout", async () => {
      vi.useFakeTimers();
      document.body.innerHTML = '<a role="tab" href="?_a=overview">Overview</a>';
      document.querySelector("a")!.addEventListener("click", (event) => event.preventDefault());
      const result = expect(navigateToAdoComment(date)).rejects.toThrow("Show all discussion threads");
      await vi.advanceTimersByTimeAsync(5000);
      await result;
      const comment = addComment();
      await Promise.resolve();
      expect(comment.scrollIntoView).not.toHaveBeenCalled();
    });

    it("rejects invalid timestamps instead of navigating elsewhere", async () => {
      await expect(navigateToAdoComment("invalid")).rejects.toThrow("no valid publication time");
    });

    it("reveals lazy native comments by scrolling the timeline and restores scroll on failure", async () => {
      vi.useFakeTimers();
      const page = document.createElement("div");
      page.className = "repos-pr-details-page";
      page.innerHTML = '<div class="activity-feed-list"></div>';
      Object.defineProperties(page, { clientHeight: { value: 500 }, scrollHeight: { value: 1800 } });
      page.scrollTop = 200;
      document.body.append(page);
      const failed = expect(navigateToAdoComment(date)).rejects.toThrow("not visible");
      await vi.advanceTimersByTimeAsync(5000);
      await failed;
      expect(page.scrollTop).toBe(200);

      const jumped = navigateToAdoComment(date);
      await vi.advanceTimersByTimeAsync(200);
      expect(page.scrollTop).toBe(400);
      const comment = addComment();
      await jumped;
      expect(document.activeElement).toBe(comment);
    });
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
