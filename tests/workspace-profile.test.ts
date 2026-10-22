import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceQueries } from "../src/workspace/client";
import { WorkspaceService } from "../src/workspace/service";
import { WorkspaceStorage } from "../src/workspace/storage";
import { prSchema } from "../src/workspace/protocol";
import { contributionCalendar, profileContributions, profileDay, profileMonths, profilePeriod, profileRanges, profileStats, reviewedPrs, settledPr } from "../src/workspace/profile";

const pr = (id: number) => prSchema.parse({
  pullRequestId: id, title: `PR ${id}`, status: "completed",
  creationDate: new Date(2025, 0, 15).toISOString(), closedDate: new Date(2025, 0, 20).toISOString(),
  repository: { id: "r", name: "Repo", project: { id: "p", name: "Project" } },
  createdBy: { id: "author", displayName: "Author" }, reviewers: []
});

describe("PRScope profile semantics", () => {
  it("counts non-self non-zero votes, not assignments or individual thread events", () => {
    const reviewed = pr(2); reviewed.createdBy.id = "other";
    reviewed.reviewers = [{ id: "author", displayName: "Author", vote: -5 }];
    const assigned = pr(3); assigned.createdBy.id = "other";
    assigned.reviewers = [{ id: "author", displayName: "Author", vote: 0 }];
    const self = pr(4); self.reviewers = [{ id: "author", displayName: "Author", vote: 10 }];
    expect(reviewedPrs([reviewed, assigned, self], "author")).toEqual([reviewed]);
    reviewed.closedDate = new Date(2025, 2, 20).toISOString();
    const days = profileContributions([pr(1), pr(1)], [reviewed, reviewed]);
    expect(days).toEqual([{ day: profileDay(reviewed.creationDate), created: 1, reviewed: 1 }]);
  });

  it("matches PRScope's stats and upper median, with N/A when merge data is absent", () => {
    const created = [pr(1), pr(2), pr(3), pr(4)];
    created[0]!.status = "active";
    created[1]!.closedDate = new Date(2025, 0, 16).toISOString();
    created[2]!.closedDate = new Date(2025, 0, 18).toISOString();
    created[3]!.closedDate = new Date(2025, 0, 25).toISOString();
    expect(profileStats(created, [pr(5)])).toEqual({ created: 4, reviewed: 1, active: 1, mergeTime: "3d" });
    expect(profileStats([], []).mergeTime).toBe("N/A");
  });

  it("defaults to a calendar-aware past year and supplies the original ranges and calendar years", () => {
    const now = new Date(2024, 1, 29, 12);
    expect(profileDay(profilePeriod("last-1y", now).since)).toBe("2023-02-28");
    expect(profileDay(profilePeriod("last-6m", now).since)).toBe("2023-08-29");
    expect(profileRanges(now).map((range) => range.value)).toEqual(["last-1y", "last-6m", "last-1m", "2024", "2023", "2022", "2021", "2020"]);
    const year = profilePeriod("2024", now);
    expect(profileDay(year.since)).toBe("2024-01-01");
    expect(profileDay(year.until)).toBe("2024-12-31");
    expect(contributionCalendar(year, 896).days).toContain("2024-02-29");
    expect(() => profilePeriod("bad", now)).toThrow();
  });

  it("uses reusable whole-month query boundaries even when selected ranges overlap only part of a month", () => {
    const months = profileMonths({
      since: new Date(2025, 0, 20).toISOString(),
      until: new Date(2025, 2, 5).toISOString()
    });
    expect(months.map((month) => profileDay(month.since))).toEqual(["2025-01-01", "2025-02-01", "2025-03-01"]);
    expect(months.map((month) => profileDay(month.until))).toEqual(["2025-01-31", "2025-02-28", "2025-03-31"]);
    expect(Date.parse(months[0]!.until) + 1).toBe(Date.parse(months[1]!.since));
  });

  it("uses PRScope's Sunday-aligned, responsive 10-16px cells and 2px gaps", () => {
    const period = profilePeriod("last-1y", new Date(2026, 9, 22));
    const narrow = contributionCalendar(period, 400);
    const regular = contributionCalendar(period, 896);
    const wide = contributionCalendar(period, 1800);
    expect(new Date(`${narrow.days[0]}T00:00:00`).getDay()).toBe(0);
    expect(narrow.days.length).toBeGreaterThanOrEqual(366);
    expect(narrow.cell).toBe(10);
    expect(regular.cell).toBe(14);
    expect(regular.width).toBe(878);
    expect(wide.cell).toBe(16);
    expect(narrow.width).toBeGreaterThan(400);
  });

  it("does not freeze active or recently closed PR metadata", () => {
    const item = pr(1);
    const now = new Date(2025, 0, 22).getTime();
    expect(settledPr(item, now)).toBe(false);
    expect(settledPr(item, now + 30 * 86400_000)).toBe(true);
    item.status = "active";
    expect(settledPr(item, now + 30 * 86400_000)).toBe(false);
  });
});

describe("complete profile loading and persistent range reuse", () => {
  it("versions settled thread snapshots by closure date so a reclosed PR cannot reuse its old review history", async () => {
    const now = () => new Date(2026, 9, 22).getTime();
    const storage = new WorkspaceStorage(new IDBFactory(), now);
    const reads: string[] = [];
    const request = vi.fn().mockImplementation(async (request) => {
      if (request.type === "cache") return storage.cache("org-viewer", request.key, request.value, {
        retention: request.retention ?? "recent", permanent: request.permanent ?? false
      });
      reads.push(request.query.closedDate);
      return [];
    });
    const service = new WorkspaceService(new WorkspaceQueries({ request }, now), now);
    const original = pr(1);
    const reclosed = { ...original, closedDate: new Date(2026, 0, 10).toISOString() };
    const signal = new AbortController().signal;
    await service.reviews([original], signal);
    await service.reviews([reclosed], signal);
    await service.reviews([original, reclosed], signal);
    expect(reads).toEqual([original.closedDate, reclosed.closedDate]);
  });

  it("loads beyond 500 authored and 50 reviewed PRs, retains historical pages across years, and refreshes reopened PRs", async () => {
    let now = new Date(2026, 9, 22).getTime();
    const storage = new WorkspaceStorage(new IDBFactory(), () => now);
    const created = Array.from({ length: 601 }, (_, index) => pr(index + 1));
    const reviewed = Array.from({ length: 75 }, (_, index) => {
      const item = pr(index + 1001);
      item.createdBy.id = "other";
      item.reviewers = [{ id: "author", displayName: "Author", vote: 10 }];
      return item;
    });
    const reads: Array<{ skip: number; creator?: string }> = [];
    const request = vi.fn().mockImplementation(async (request) => {
      if (request.type === "cache") return storage.cache("org-viewer", request.key, request.value, {
        retention: request.retention ?? "recent", permanent: request.permanent ?? false
      });
      const query = request.query;
      reads.push(query);
      const source = query.creator ? created : reviewed;
      const items = source.slice(query.skip, query.skip + query.top);
      return { items, more: items.length === query.top };
    });
    const makeService = () => new WorkspaceService(new WorkspaceQueries({ request }, () => now), () => now);
    const person = { id: "author", displayName: "Author" };
    const projects = [{ id: "p", name: "Project" }];
    const period = { since: new Date(2025, 0, 10).toISOString(), until: new Date(2025, 0, 30).toISOString() };
    const signal = new AbortController().signal;
    const first = await makeService().profile(person, projects, period, signal);
    expect(first.created).toHaveLength(601);
    expect(first.assigned).toHaveLength(75);
    expect(first.errors).toEqual([]);
    expect(first.more).toBe(false);
    expect(reads).toHaveLength(3);
    expect(reads.some((query) => query.skip === 500)).toBe(true);
    now += 366 * 86400_000;
    await makeService().profile(person, projects, period, signal);
    expect(reads).toHaveLength(3);
    created[0]!.status = "active";
    const refreshed = await makeService().profile(person, projects, period, signal, true);
    expect(refreshed.created.find((item) => item.pullRequestId === 1)?.status).toBe("active");
    expect(reads).toHaveLength(6);
    now += 5 * 60_000;
    await makeService().profile(person, projects, period, signal);
    expect(reads).toHaveLength(7);
  });

  it("keeps every month independent, filters partial months, and reports incomplete pagination", async () => {
    const request = vi.fn().mockImplementation(async (request) => {
      if (request.type === "cache") return null;
      if (request.query.reviewer) throw new Error("Access denied");
      return { items: [pr(1)], more: true };
    });
    const service = new WorkspaceService(new WorkspaceQueries({ request }));
    const result = await service.profile({ id: "author", displayName: "Author" }, [{ id: "p", name: "Project" }],
      { since: new Date(2025, 0, 20).toISOString(), until: new Date(2025, 0, 31).toISOString() }, new AbortController().signal);
    expect(result.created).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.join(" ")).toContain("pagination did not advance");
    expect(result.errors.join(" ")).toContain("Access denied");
  });
});
