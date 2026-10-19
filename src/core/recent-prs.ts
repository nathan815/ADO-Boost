import { z } from "zod";
import type { PrRoute } from "./types";

export const RECENT_PRS_KEY = "recent-prs:v1";
export const RECENT_PRS_LIMIT = 100;

export const recentPrSchema = z.object({
  organization: z.string().min(1).max(256),
  project: z.string().min(1).max(256),
  repository: z.string().min(1).max(256),
  repositoryId: z.string().min(1).max(256),
  pullRequestId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  title: z.string().max(4096),
  author: z.string().min(1).max(256).optional(),
  viewedAt: z.number().int().nonnegative().max(8.64e15),
  url: z.string()
}).refine((pr) => pr.url === recentPrUrl(pr), { message: "Invalid recent PR URL" });

export type RecentPr = z.infer<typeof recentPrSchema>;
export type PrSummary = PrRoute & Pick<RecentPr, "repositoryId" | "title" | "author">;

export interface RecentPrStorage {
  load(): Promise<unknown>;
  save(entries: RecentPr[]): Promise<void>;
}

export function recentPrUrl(pr: Pick<PrRoute, "organization" | "project" | "repository" | "pullRequestId">): string {
  return `https://dev.azure.com/${encodeURIComponent(pr.organization)}/${encodeURIComponent(pr.project)}/_git/${encodeURIComponent(pr.repository)}/pullrequest/${pr.pullRequestId}`;
}

function identity(pr: RecentPr): string {
  return JSON.stringify([pr.organization.toLowerCase(), pr.repositoryId.toLowerCase(), pr.pullRequestId]);
}

export class RecentPrService {
  constructor(private readonly storage: RecentPrStorage, private readonly now: () => number = Date.now) {}

  async list(): Promise<RecentPr[]> {
    const value = await this.storage.load();
    if (value === undefined) return [];
    const entries = z.array(recentPrSchema).parse(value);
    return this.latest(entries);
  }

  async record(summary: PrSummary, viewedAt = this.now()): Promise<void> {
    const entry = recentPrSchema.parse({
      organization: summary.organization,
      project: summary.project,
      repository: summary.repository,
      repositoryId: summary.repositoryId,
      pullRequestId: summary.pullRequestId,
      title: summary.title,
      author: summary.author,
      viewedAt,
      url: recentPrUrl(summary)
    });
    await this.storage.save(this.latest([entry, ...await this.list()]));
  }

  clear(): Promise<void> {
    return this.storage.save([]);
  }

  private latest(entries: RecentPr[]): RecentPr[] {
    const unique = new Map<string, RecentPr>();
    for (const entry of [...entries].sort((a, b) => b.viewedAt - a.viewedAt)) {
      const key = identity(entry);
      if (!unique.has(key)) unique.set(key, entry);
    }
    return [...unique.values()].slice(0, RECENT_PRS_LIMIT);
  }
}
