export function adoFileUrl(path: string, currentUrl = location.href): string {
  const url = new URL(currentUrl);
  url.searchParams.set("_a", "files");
  url.searchParams.set("path", path);
  return url.toString();
}

export function navigateToAdoFile(path: string, documentRef = document, windowRef = window): void {
  if (clickNativeFileLink(path, documentRef)) return;

  const filesTab = findFilesTab(documentRef);
  if (filesTab) {
    filesTab.click();
    waitForNativeFileLink(path, documentRef, windowRef);
    return;
  }

  updateSpaLocation(path, windowRef);
}

export interface AdoCommentAnchor {
  id: number;
  path?: string;
  line?: number;
}

const commentJumpFailure = "Couldn't jump to this comment. ADO Boost couldn't match it to the Azure DevOps page. Try again, or open the discussion in Overview.";

export async function navigateToAdoComment(publishedDate: string, documentRef = document, windowRef = window, anchor?: AdoCommentAnchor): Promise<void> {
  const timestamp = Date.parse(publishedDate);
  if (!Number.isFinite(timestamp)) throw new Error("This comment has no valid publication time to locate it in Azure DevOps.");
  if (anchor?.path && anchor.line) {
    await navigateToInlineComment(timestamp, anchor, documentRef, windowRef);
    return;
  }
  const findComment = () => findNativeComment(timestamp, documentRef, anchor);
  let comment = findComment();
  if (!comment) {
    const overview = documentRef.querySelector<HTMLAnchorElement>('a[role="tab"][href*="_a=overview"]');
    if (!overview && !documentRef.querySelector(".activity-feed-list")) throw new Error("Couldn't open the discussion. Open the PR Overview tab, then try again.");
    comment = await waitForNativeComment(findComment, documentRef, windowRef, () => {
      if (!documentRef.querySelector(".activity-feed-list")) overview?.click();
    });
  }
  focusComment(comment);
}

function findNativeComment(timestamp: number, scope: ParentNode, anchor?: AdoCommentAnchor): HTMLElement | undefined {
  const thread = anchor ? scope.querySelector(`.threadId-${anchor.id}`)?.closest(".repos-discussion-thread") : null;
  const root = thread ?? scope;
  // ADO's visible time changes after edits, but the viewer ID retains the original publication second.
  const viewers = [...root.querySelectorAll<HTMLElement>(".repos-comment-viewer[id]")]
    .filter((viewer) => viewer.id === String(Math.floor(timestamp / 1000)));
  if (viewers.length === 1) {
    const viewer = viewers[0]!;
    return viewer.querySelector(".repos-discussion-comment-header")?.closest<HTMLElement>(".repos-discussion-comment") ?? viewer;
  }
  const times = [...root.querySelectorAll<HTMLTimeElement>(".repos-discussion-comment-header time[datetime]")]
    .filter((time) => Date.parse(time.dateTime) === timestamp);
  return times.length === 1 ? times[0]!.closest<HTMLElement>(".repos-discussion-comment") ?? undefined : undefined;
}

function focusComment(comment: HTMLElement): void {
  comment.scrollIntoView({ block: "center" });
  const tabindex = comment.getAttribute("tabindex");
  comment.tabIndex = -1;
  comment.addEventListener("blur", () => {
    if (tabindex === null) comment.removeAttribute("tabindex");
    else comment.setAttribute("tabindex", tabindex);
  }, { once: true });
  comment.focus({ preventScroll: true });
}

async function navigateToInlineComment(timestamp: number, anchor: AdoCommentAnchor, documentRef: Document, windowRef: Window): Promise<void> {
  const isSelected = () => {
    const url = new URL(windowRef.location.href);
    return url.searchParams.get("_a") === "files"
      && url.searchParams.get("path") === anchor.path
      && url.searchParams.get("discussionId") === String(anchor.id);
  };
  if (!isSelected()) {
    const findLink = () => [...documentRef.querySelectorAll<HTMLAnchorElement>("a.comment-file-header-link[href]")].find((link) => {
      const url = new URL(link.href, windowRef.location.href);
      return url.searchParams.get("_a") === "files"
        && url.searchParams.get("path") === anchor.path
        && url.searchParams.get("discussionId") === String(anchor.id);
    });
    let link = findLink();
    if (!link) {
      const overview = documentRef.querySelector<HTMLAnchorElement>('a[role="tab"][href*="_a=overview"]');
      if (!overview && !documentRef.querySelector(".activity-feed-list")) throw new Error("Couldn't open the file discussion. Open the PR Overview tab, then try again.");
      link = await waitForNativeComment(findLink, documentRef, windowRef, () => {
        if (!documentRef.querySelector(".activity-feed-list")) overview?.click();
      });
    }
    await waitForInlineDiscussion(isSelected, documentRef, windowRef, () => link.click());
  }
  const comment = [...documentRef.querySelectorAll(".repos-editor-discussion-host")]
    .map((host) => findNativeComment(timestamp, host, anchor)).find((candidate) => candidate);
  if (comment) focusComment(comment);
}

function waitForInlineDiscussion(isSelected: () => boolean, documentRef: Document, windowRef: Window, navigate: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      observer.disconnect();
      windowRef.clearInterval(poll);
      windowRef.clearTimeout(timeout);
    };
    const check = () => {
      if (!isSelected() || !documentRef.querySelector(".repos-editor-discussion-host")) return;
      cleanup();
      resolve();
    };
    const observer = new MutationObserver(check);
    observer.observe(documentRef.body, { childList: true, subtree: true });
    const poll = windowRef.setInterval(check, 100);
    const timeout = windowRef.setTimeout(() => {
      cleanup();
      reject(new Error("Couldn't jump to this file discussion. Try again, or open the file and thread directly in Azure DevOps."));
    }, 5000);
    navigate();
    check();
  });
}

function waitForNativeComment<T extends HTMLElement>(findComment: () => T | null | undefined, documentRef: Document, windowRef: Window, navigate: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let scrollRoot: HTMLElement | null = null;
    let originalScrollTop = 0;
    const cleanup = () => {
      observer.disconnect();
      windowRef.clearInterval(reveal);
      windowRef.clearTimeout(timeout);
    };
    const check = () => {
      const target = findComment();
      if (!target) return;
      cleanup();
      resolve(target);
    };
    const observer = new MutationObserver(check);
    observer.observe(documentRef.body, { childList: true, subtree: true });
    // ADO lazily renders offscreen comment bodies, including their timestamp headers.
    const reveal = windowRef.setInterval(() => {
      if (!documentRef.querySelector(".activity-feed-list")) return;
      if (!scrollRoot) {
        scrollRoot = documentRef.querySelector<HTMLElement>(".repos-pr-details-page");
        if (!scrollRoot) return;
        originalScrollTop = scrollRoot.scrollTop;
        scrollRoot.scrollTop = 0;
      } else {
        scrollRoot.scrollTop = Math.min(scrollRoot.scrollTop + scrollRoot.clientHeight * 0.8, scrollRoot.scrollHeight - scrollRoot.clientHeight);
      }
      check();
    }, 100);
    const timeout = windowRef.setTimeout(() => {
      cleanup();
      if (scrollRoot) scrollRoot.scrollTop = originalScrollTop;
      reject(new Error(commentJumpFailure));
    }, 5000);
    navigate();
    check();
  });
}

function clickNativeFileLink(path: string, documentRef: Document): boolean {
  const link = [...documentRef.querySelectorAll<HTMLAnchorElement>("a[href]")].find((candidate) => {
    try {
      const url = new URL(candidate.href, location.href);
      return url.searchParams.get("_a") === "files" && url.searchParams.get("path") === path;
    } catch {
      return false;
    }
  });
  if (!link) return false;
  link.click();
  return true;
}

function findFilesTab(documentRef: Document): HTMLAnchorElement | undefined {
  return [...documentRef.querySelectorAll<HTMLAnchorElement>("a[href]")].find((candidate) => {
    try {
      const url = new URL(candidate.href, location.href);
      return candidate.textContent?.trim() === "Files" && url.searchParams.get("_a") === "files";
    } catch {
      return false;
    }
  });
}

function waitForNativeFileLink(path: string, documentRef: Document, windowRef: Window): void {
  let settled = false;
  const observer = new MutationObserver(() => {
    if (!clickNativeFileLink(path, documentRef)) return;
    settled = true;
    observer.disconnect();
    windowRef.clearTimeout(timeout);
  });
  observer.observe(documentRef.body, { childList: true, subtree: true });
  const timeout = windowRef.setTimeout(() => {
    observer.disconnect();
    if (!settled) updateSpaLocation(path, windowRef);
  }, 3000);
}

function updateSpaLocation(path: string, windowRef: Window): void {
  const url = adoFileUrl(path, windowRef.location.href);
  windowRef.history.pushState(windowRef.history.state, "", url);
  windowRef.dispatchEvent(new PopStateEvent("popstate", { state: windowRef.history.state }));
}
