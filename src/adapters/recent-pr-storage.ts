import { RECENT_PRS_KEY, type RecentPr, type RecentPrStorage } from "../core/recent-prs";

export class ChromeRecentPrStorage implements RecentPrStorage {
  async load(): Promise<unknown> {
    return (await chrome.storage.local.get(RECENT_PRS_KEY))[RECENT_PRS_KEY];
  }

  save(entries: RecentPr[]): Promise<void> {
    return chrome.storage.local.set({ [RECENT_PRS_KEY]: entries });
  }
}
