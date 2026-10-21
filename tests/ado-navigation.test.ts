// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://dev.azure.com/org/project/_git/repo/pullrequest/7"}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigateToAdoComment, navigateToAdoFile } from "../src/ui/ado-navigation";
import { NAVIGATION_CHANNEL, navigationRequestSchema, selectNativeFile } from "../src/native-tree/navigation";

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

    it("treats native and augmented timestamps in the same comment as one navigation target", async () => {
      const comment = addComment();
      const created = document.createElement("time");
      created.dateTime = date;
      comment.querySelector(".repos-discussion-comment-header")!.append(created);
      await navigateToAdoComment(date);
      expect(document.activeElement).toBe(comment);
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

    it("reports an unmatched comment without assuming it is hidden and disconnects after timeout", async () => {
      vi.useFakeTimers();
      document.body.innerHTML = '<a role="tab" href="?_a=overview">Overview</a>';
      document.querySelector("a")!.addEventListener("click", (event) => event.preventDefault());
      const result = expect(navigateToAdoComment(date)).rejects.toThrow("ADO Boost couldn't match it");
      await vi.advanceTimersByTimeAsync(5000);
      await result;
      const comment = addComment();
      await Promise.resolve();
      expect(comment.scrollIntoView).not.toHaveBeenCalled();
    });

    it("rejects invalid timestamps instead of navigating elsewhere", async () => {
      await expect(navigateToAdoComment("invalid")).rejects.toThrow("no valid publication time");
    });

    function addViewer(threadId: number, publishedDate: string, displayedDate?: string) {
      const thread = document.createElement("div");
      thread.className = "repos-discussion-thread";
      const viewer = document.createElement("div");
      viewer.className = "repos-comment-viewer";
      viewer.id = String(Math.floor(Date.parse(publishedDate) / 1000));
      viewer.scrollIntoView = vi.fn();
      thread.append(viewer);
      const reply = document.createElement("input");
      reply.className = `threadId-${threadId}`;
      thread.append(reply);
      document.body.append(thread);
      let comment: HTMLElement | undefined;
      if (displayedDate) {
        comment = addComment();
        comment.querySelector("time")!.dateTime = displayedDate;
        viewer.append(comment);
      }
      return { thread, viewer, comment };
    }

    it("finds a visible edited comment by its original viewer ID, not its displayed edit time", async () => {
      const publishedDate = "2026-10-14T01:15:14.02Z";
      const { comment } = addViewer(42, publishedDate, "2026-10-14T01:15:33.543Z");
      await navigateToAdoComment(publishedDate, document, window, { id: 42 });
      expect(comment!.scrollIntoView).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(comment);
    });

    it("disambiguates original publication seconds using the native thread identity", async () => {
      const other = addViewer(41, date, "2026-10-15T12:10:00Z");
      const target = addViewer(42, date, "2026-10-15T12:20:00Z");
      await navigateToAdoComment(date, document, window, { id: 42 });
      expect(document.activeElement).toBe(target.comment);
      expect(other.comment!.scrollIntoView).not.toHaveBeenCalled();
    });

    it("jumps directly to the stable lazy viewer without requiring a rendered timestamp", async () => {
      const { viewer } = addViewer(42, date);
      await navigateToAdoComment(date, document, window, { id: 42 });
      expect(document.activeElement).toBe(viewer);
      expect(viewer.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    });

    const anchor = { id: 42, path: "/src/app.ts", line: 12 };

    function addFileLink(id = 42, path = anchor.path) {
      const link = document.createElement("a");
      link.className = "comment-file-header-link";
      const url = new URL(location.href);
      url.search = new URLSearchParams({ _a: "files", path, discussionId: String(id) }).toString();
      link.href = url.href;
      document.body.append(link);
      return link;
    }

    function showInlineComment() {
      const host = document.createElement("div");
      host.className = "repos-editor-discussion-host";
      const comment = addComment();
      host.append(comment);
      document.body.append(host);
      return comment;
    }

    it("uses the exact native thread link instead of jumping to a matching Overview comment", async () => {
      const overviewComment = addComment();
      const unrelated = addFileLink(43);
      const wrongFile = addFileLink(42, "/src/other.ts");
      const link = addFileLink();
      const unrelatedClick = vi.fn((event: Event) => event.preventDefault());
      unrelated.addEventListener("click", unrelatedClick);
      wrongFile.addEventListener("click", unrelatedClick);
      let inlineComment: HTMLElement | undefined;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        history.pushState({}, "", link.href);
        inlineComment = showInlineComment();
      });
      await navigateToAdoComment(date, document, window, anchor);
      expect(new URL(location.href).searchParams.get("discussionId")).toBe("42");
      expect(inlineComment!.scrollIntoView).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(inlineComment);
      expect(overviewComment.scrollIntoView).not.toHaveBeenCalled();
      expect(unrelatedClick).not.toHaveBeenCalled();
    });

    it("reveals the native file link through Overview when starting from another file", async () => {
      document.body.innerHTML = '<a role="tab" href="?_a=overview">Overview</a>';
      let inlineComment: HTMLElement | undefined;
      document.querySelector("a")!.addEventListener("click", (event) => {
        event.preventDefault();
        queueMicrotask(() => {
          const link = addFileLink();
          link.addEventListener("click", (event) => {
            event.preventDefault();
            queueMicrotask(() => {
              history.pushState({}, "", link.href);
              inlineComment = showInlineComment();
            });
          });
        });
      });
      await navigateToAdoComment(date, document, window, anchor);
      expect(document.activeElement).toBe(inlineComment);
    });

    it("keeps native collapsed presentation after selecting the file and discussion", async () => {
      const link = addFileLink();
      const expand = vi.fn();
      link.addEventListener("click", (event) => {
        event.preventDefault();
        history.pushState({}, "", link.href);
        const host = document.createElement("div");
        host.className = "repos-editor-discussion-host";
        host.innerHTML = '<button class="repos-editor-discussion-expand"></button>';
        host.querySelector("button")!.addEventListener("click", expand);
        document.body.append(host);
      });
      await navigateToAdoComment(date, document, window, anchor);
      expect(expand).not.toHaveBeenCalled();
      expect(new URL(location.href).searchParams.get("path")).toBe(anchor.path);
    });

    it("focuses an already selected inline reply without navigating through Overview", async () => {
      const link = addFileLink();
      history.replaceState({}, "", link.href);
      const navigate = vi.fn((event: Event) => event.preventDefault());
      link.addEventListener("click", navigate);
      const comment = showInlineComment();
      await navigateToAdoComment(date, document, window, anchor);
      expect(document.activeElement).toBe(comment);
      expect(navigate).not.toHaveBeenCalled();
    });

    it("reports inline navigation failure without focusing the Overview copy", async () => {
      vi.useFakeTimers();
      const link = addFileLink();
      link.addEventListener("click", (event) => event.preventDefault());
      const overviewComment = addComment();
      const result = expect(navigateToAdoComment(date, document, window, anchor)).rejects.toThrow("Couldn't jump to this file discussion");
      await vi.advanceTimersByTimeAsync(5000);
      await result;
      history.replaceState({}, "", link.href);
      showInlineComment();
      await Promise.resolve();
      expect(overviewComment.scrollIntoView).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("reveals lazy native comments by scrolling the timeline and restores scroll on failure", async () => {
      vi.useFakeTimers();
      const page = document.createElement("div");
      page.className = "repos-pr-details-page";
      page.innerHTML = '<div class="activity-feed-list"></div>';
      Object.defineProperties(page, { clientHeight: { value: 500 }, scrollHeight: { value: 1800 } });
      page.scrollTop = 200;
      document.body.append(page);
      const failed = expect(navigateToAdoComment(date)).rejects.toThrow("ADO Boost couldn't match it");
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

  describe("same-tab native file selection", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    function mockBridge(error?: string) {
      return vi.spyOn(window, "postMessage").mockImplementation((data: unknown) => {
        const request = navigationRequestSchema.parse(data);
        window.dispatchEvent(new MessageEvent("message", {
          source: window, origin: location.origin,
          data: { channel: NAVIGATION_CHANNEL, kind: "result", id: request.id, ...(error ? { error } : {}) }
        }));
      });
    }

    it("ignores arbitrary matching links, including new-tab, cross-origin, and discussion links", async () => {
      document.body.innerHTML = `
        <a target="_blank" href="?_a=files&path=/src/app.ts">PR description link</a>
        <a href="https://other.example/repo?_a=files&path=/src/app.ts">Other host</a>
        <a class="comment-file-header-link" href="?_a=files&path=/src/app.ts&discussionId=42">Discussion</a>
        <div class="repos-file-explorer-tree"></div>`;
      const clicked = vi.fn((event: Event) => event.preventDefault());
      document.querySelectorAll("a").forEach((link) => link.addEventListener("click", clicked));
      const post = mockBridge();
      await navigateToAdoFile("/src/app.ts");
      expect(clicked).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        kind: "navigate", path: "/src/app.ts", page: location.origin + location.pathname
      }), location.origin);
      expect(location.search).toBe("");
    });

    it.each(["Files", 'Files<span data-adopp-files-tab-count="true">12</span>'])("opens the same-PR native Files tab (%s) and waits for the tree to render", async (label) => {
      document.body.innerHTML = `<a role="tab" target="_blank" href="?_a=files">Files</a><a role="tab" href="?_a=files">${label}</a>`;
      const links = document.querySelectorAll("a");
      const external = vi.fn((event: Event) => event.preventDefault());
      links[0]!.addEventListener("click", external);
      links[1]!.addEventListener("click", (event) => {
        event.preventDefault();
        queueMicrotask(() => {
          const tree = document.createElement("div");
          tree.className = "repos-file-explorer-tree";
          document.body.append(tree);
        });
      });
      const post = mockBridge();
      await navigateToAdoFile("/src/app.ts");
      expect(external).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledOnce();
    });

    it("reports native navigation errors instead of silently falling back to a URL change", async () => {
      document.body.innerHTML = '<div class="repos-file-explorer-tree"></div>';
      mockBridge("The file is not in this comparison.");
      await expect(navigateToAdoFile("/missing.ts")).rejects.toThrow("not in this comparison");
      expect(location.search).toBe("");
    });

    it("rejects missing Files tabs without following other PR or cross-origin links", async () => {
      document.body.innerHTML = '<a role="tab" href="https://other.example/?_a=files">Files</a><a role="tab" href="/org/project/_git/repo/pullrequest/8?_a=files">Files</a>';
      const post = mockBridge();
      await expect(navigateToAdoFile("/src/app.ts")).rejects.toThrow("Couldn't open Azure DevOps' Files tab");
      expect(post).not.toHaveBeenCalled();
    });

    it("ignores unrelated or untrusted responses and cleans up after a timeout", async () => {
      vi.useFakeTimers();
      document.body.innerHTML = '<div class="repos-file-explorer-tree"></div>';
      const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
      const failure = expect(navigateToAdoFile("/src/app.ts")).rejects.toThrow("Couldn't open this file");
      const request = navigationRequestSchema.parse(post.mock.calls[0]![0]);
      for (const [origin, source, id] of [
        ["https://other.example", window, request.id],
        [location.origin, null, request.id],
        [location.origin, window, crypto.randomUUID()]
      ] as const) {
        window.dispatchEvent(new MessageEvent("message", {
          origin, source, data: { channel: NAVIGATION_CHANNEL, kind: "result", id }
        }));
      }
      await vi.advanceTimersByTimeAsync(5000);
      await failure;
      expect(vi.getTimerCount()).toBe(0);
    });

    function nativeTree() {
      const tree = document.createElement("div");
      tree.className = "repos-file-explorer-tree";
      const item = { path: "/src/app.ts", isFolder: false };
      const setSelectedItem = vi.fn();
      const items = { [item.path]: item, "/src": { path: "/src", isFolder: true } };
      const navigationService = { setSelectedItem, changes: { value: { changesByPath: items } } };
      Reflect.set(tree, "__reactFiber$test", {
        return: { memoizedProps: { value: { navigationService } } }
      });
      document.body.append(tree);
      return { item, items, setSelectedItem };
    }

    it("selects the exact native model item, independent of rendered rows and links", () => {
      const { item, setSelectedItem } = nativeTree();
      selectNativeFile(item.path, document);
      expect(setSelectedItem).toHaveBeenCalledExactlyOnceWith(item);
    });

    it("rejects folders, missing paths, and incompatible host contracts", () => {
      const { setSelectedItem } = nativeTree();
      expect(() => selectNativeFile("/src", document)).toThrow("not available in the current");
      expect(() => selectNativeFile("/missing.ts", document)).toThrow("not available in the current");
      expect(setSelectedItem).not.toHaveBeenCalled();
      document.body.innerHTML = '<div class="repos-file-explorer-tree"></div>';
      expect(() => selectNativeFile("/src/app.ts", document)).toThrow("native file navigation is unavailable");
    });
  });
});
