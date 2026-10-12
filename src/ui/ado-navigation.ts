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

