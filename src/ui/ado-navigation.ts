import { NAVIGATION_CHANNEL, navigationResultSchema } from "../native-tree/navigation";

export function adoFileUrl(path: string, currentUrl = location.href): string {
  const url = new URL(currentUrl);
  url.searchParams.set("_a", "files");
  url.searchParams.set("path", path);
  return url.toString();
}

export function navigateToAdoFile(path: string, documentRef = document, windowRef = window): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const page = windowRef.location.origin + windowRef.location.pathname;
    let sent = false;
    const cleanup = () => {
      observer.disconnect();
      windowRef.clearTimeout(timeout);
      windowRef.removeEventListener("message", onMessage);
    };
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== windowRef || event.origin !== windowRef.location.origin) return;
      const result = navigationResultSchema.safeParse(event.data);
      if (!result.success || result.data.id !== id) return;
      cleanup();
      if (result.data.error) reject(new Error(result.data.error));
      else resolve();
    };
    const send = () => {
      if (sent || !documentRef.querySelector(".repos-file-explorer-tree")) return;
      sent = true;
      windowRef.postMessage({ channel: NAVIGATION_CHANNEL, kind: "navigate", id, page, path }, windowRef.location.origin);
    };
    const observer = new MutationObserver(send);
    const timeout = windowRef.setTimeout(() => {
      cleanup();
      reject(new Error("Couldn't open this file in Azure DevOps. Try selecting it from the Files tab."));
    }, 5000);
    windowRef.addEventListener("message", onMessage);
    observer.observe(documentRef.body, { childList: true, subtree: true });
    if (!documentRef.querySelector(".repos-file-explorer-tree")) {
      const filesTab = findFilesTab(documentRef, windowRef);
      if (!filesTab) {
        cleanup();
        reject(new Error("Couldn't open Azure DevOps' Files tab."));
        return;
      }
      filesTab.click();
    }
    send();
  });
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
  const comments = [...new Set(times.map((time) => time.closest<HTMLElement>(".repos-discussion-comment")).filter((comment) => comment !== null))];
  return comments.length === 1 ? comments[0] : undefined;
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

function findFilesTab(documentRef: Document, windowRef: Window): HTMLAnchorElement | undefined {
  return [...documentRef.querySelectorAll<HTMLAnchorElement>("a[href]")].find((candidate) => {
    try {
      const url = new URL(candidate.href, windowRef.location.href);
      return candidate.getAttribute("role") === "tab" && candidate.textContent?.trim() === "Files"
        && (!candidate.target || candidate.target.toLowerCase() === "_self")
        && url.origin === windowRef.location.origin && url.pathname === windowRef.location.pathname
        && url.searchParams.get("_a") === "files";
    } catch {
      return false;
    }
  });
}
