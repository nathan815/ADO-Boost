import { recentPrUrl, type RecentPr } from "./recent-prs";
import type { AnnouncementCompletion, AnnouncementRecord, PrRoute } from "./types";

export type ReviewStatus = "reviewing" | "reviewed";
export type ReviewActivity = RecentPr & { reviewStatus: ReviewStatus };
export const reviewStatusLabels: Record<ReviewStatus, string> = { reviewing: "Reviewing", reviewed: "Review complete" };
type ActivityRecord = Pick<AnnouncementRecord, "key" | "status"> & {
  pullRequest?: RecentPr | undefined;
  completions?: Pick<AnnouncementCompletion, "status">[] | undefined;
};

export function reviewActivity(records: ActivityRecord[], recent: RecentPr[]): ReviewActivity[] {
  const entries = new Map<string, ReviewActivity>();
  for (const record of records) {
    if (record.status !== "posted") continue;
    const pr = recent.find((entry) => announcementMatches(record, entry)) ?? record.pullRequest;
    if (!pr) continue;
    const reviewStatus = record.completions?.some((completion) => completion.status === "closed") ? "reviewed" : "reviewing";
    const entry: ReviewActivity = { ...pr, url: recentPrUrl(pr), reviewStatus };
    const key = JSON.stringify([pr.organization.toLowerCase(), pr.repositoryId.toLowerCase(), pr.pullRequestId]);
    const previous = entries.get(key);
    // Multiple signed-in reviewers can share this browser's local history.
    if (!previous || previous.reviewStatus === "reviewed") entries.set(key, entry);
  }
  return [...entries.values()].sort((a, b) => b.viewedAt - a.viewedAt);
}

function announcementMatches(record: ActivityRecord, pr: RecentPr): boolean {
  const key = record.key.toLowerCase();
  if (record.pullRequest && record.pullRequest.organization.toLowerCase() !== pr.organization.toLowerCase()) return false;
  const suffix = `${pr.repositoryId}/${pr.pullRequestId}/`.toLowerCase();
  return key.startsWith(`https://dev.azure.com/${suffix}`)
    || key.startsWith(`https://${pr.organization.toLowerCase()}.visualstudio.com/${suffix}`);
}

export function reviewStatusFor(route: Pick<PrRoute, "organization" | "project" | "repository" | "pullRequestId">, entries: ReviewActivity[]): ReviewStatus | undefined {
  const url = recentPrUrl(route).toLowerCase();
  return entries.find((entry) => entry.url.toLowerCase() === url)?.reviewStatus;
}
