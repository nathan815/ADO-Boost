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

export async function navigateToAdoComment(publishedDate: string, documentRef = document, windowRef = window): Promise<void> {
  const timestamp = Date.parse(publishedDate);
  if (!Number.isFinite(timestamp)) throw new Error("This comment has no valid publication time to locate it in Azure DevOps.");
  const findComment = () => [...documentRef.querySelectorAll<HTMLTimeElement>(".repos-discussion-comment-header time[datetime]")]
    .find((time) => Date.parse(time.dateTime) === timestamp)?.closest<HTMLElement>(".repos-discussion-comment");
  let comment = findComment();
  if (!comment) {
    const overview = documentRef.querySelector<HTMLAnchorElement>('a[role="tab"][href*="_a=overview"]');
    if (!overview && !documentRef.querySelector(".activity-feed-list")) throw new Error("Open the PR Overview tab to jump to this comment.");
    comment = await waitForNativeComment(findComment, documentRef, windowRef, () => {
      if (!documentRef.querySelector(".activity-feed-list")) overview?.click();
    });
  }
  comment.scrollIntoView({ block: "center" });
  const tabindex = comment.getAttribute("tabindex");
  comment.tabIndex = -1;
  comment.addEventListener("blur", () => {
    if (tabindex === null) comment.removeAttribute("tabindex");
    else comment.setAttribute("tabindex", tabindex);
  }, { once: true });
  comment.focus({ preventScroll: true });
}

function waitForNativeComment(findComment: () => HTMLElement | null | undefined, documentRef: Document, windowRef: Window, navigate: () => void): Promise<HTMLElement> {
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
      reject(new Error("This comment is not visible in Azure DevOps. Show all discussion threads in Overview and try again."));
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
