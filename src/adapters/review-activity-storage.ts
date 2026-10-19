import { z } from "zod";
import { reviewActivity, type ReviewActivity } from "../core/review-activity";
import { RECENT_PRS_KEY, RecentPrService, recentPrSchema } from "../core/recent-prs";
import { ChromeRecentPrStorage } from "./recent-pr-storage";

const activityRecordSchema = z.object({
  key: z.string(),
  status: z.enum(["posting", "posted", "ambiguous"]),
  pullRequest: recentPrSchema.optional(),
  completions: z.array(z.object({ status: z.enum(["posting", "posted", "ambiguous", "closed"]) })).optional()
});

export class ChromeReviewActivityStorage {
  async list(): Promise<ReviewActivity[]> {
    const keys = (await chrome.storage.local.getKeys()).filter((key) => key.startsWith("announcement:"));
    const [records, recent] = await Promise.all([
      chrome.storage.local.get(keys),
      new RecentPrService(new ChromeRecentPrStorage()).list()
    ]);
    return reviewActivity(z.array(activityRecordSchema).parse(Object.values(records)), recent);
  }

  subscribe(listener: () => void): () => void {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && Object.keys(changes).some((key) => key.startsWith("announcement:") || key === RECENT_PRS_KEY)) listener();
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }
}
