import { prKey, type WorkspacePr } from "./protocol";

export interface ProfilePeriod { since: string; until: string }
export interface ProfileContribution { day: string; created: number; reviewed: number }

export function profileDay(date: Date | string): string {
  const value = typeof date === "string" ? new Date(date) : date;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function profileRanges(now = new Date()): Array<{ value: string; label: string }> {
  return [
    { value: "last-1y", label: "Past year" },
    { value: "last-6m", label: "Past 6 months" },
    { value: "last-1m", label: "Past month" },
    ...Array.from({ length: 5 }, (_, offset) => {
      const year = String(now.getFullYear() - offset);
      return { value: year, label: year };
    })
  ];
}

export function profilePeriod(range: string, now = new Date()): ProfilePeriod {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range.startsWith("last-")) {
    const months = range === "last-1y" ? 12 : range === "last-6m" ? 6 : range === "last-1m" ? 1 : null;
    if (months === null) throw new Error("Unsupported profile period.");
    const day = start.getDate();
    start.setDate(1);
    start.setMonth(start.getMonth() - months);
    start.setDate(Math.min(day, new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()));
  } else {
    if (!/^\d{4}$/.test(range)) throw new Error("Unsupported profile year.");
    const year = Number(range);
    start.setFullYear(year, 0, 1);
    end.setFullYear(year, 11, 31);
  }
  return { since: start.toISOString(), until: end.toISOString() };
}

export function profileMonths(period: ProfilePeriod): ProfilePeriod[] {
  const month = new Date(period.since);
  month.setDate(1);
  month.setHours(0, 0, 0, 0);
  const months: ProfilePeriod[] = [];
  while (month.getTime() <= Date.parse(period.until)) {
    const next = new Date(month);
    next.setMonth(next.getMonth() + 1);
    months.push({ since: month.toISOString(), until: new Date(next.getTime() - 1).toISOString() });
    month.setMonth(month.getMonth() + 1);
  }
  return months;
}

export function settledPr(pr: WorkspacePr, now = Date.now()): boolean {
  return (pr.status === "completed" || pr.status === "abandoned") && Boolean(pr.closedDate) &&
    Date.parse(pr.closedDate!) <= now - 7 * 86400_000;
}

export function reviewedPrs(prs: WorkspacePr[], person: string): WorkspacePr[] {
  return prs.filter((pr) => pr.createdBy.id !== person && pr.reviewers.some((reviewer) => reviewer.id === person && reviewer.vote !== 0));
}

export function profileContributions(created: WorkspacePr[], reviewed: WorkspacePr[]): ProfileContribution[] {
  const days = new Map<string, ProfileContribution>();
  for (const [kind, prs] of [["created", created], ["reviewed", reviewed]] as const) {
    for (const pr of new Map(prs.map((pr) => [prKey(pr), pr])).values()) {
      const day = profileDay(pr.creationDate);
      const entry = days.get(day) ?? { day, created: 0, reviewed: 0 };
      entry[kind]++;
      days.set(day, entry);
    }
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function profileStats(created: WorkspacePr[], reviewed: WorkspacePr[]) {
  const durations = created.filter((pr) => pr.status === "completed" && pr.closedDate)
    .map((pr) => (Date.parse(pr.closedDate!) - Date.parse(pr.creationDate)) / 86400_000)
    .filter((duration) => Number.isFinite(duration) && duration >= 0).sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor(durations.length / 2)]! : null;
  return {
    created: created.length, reviewed: reviewed.length,
    active: created.filter((pr) => pr.status === "active").length,
    mergeTime: median === null ? "N/A" : median < 1 ? `${Math.round(median * 24)}h` : `${Math.round(median)}d`
  };
}

export function contributionCalendar(period: ProfilePeriod, width: number) {
  const start = new Date(period.since);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(period.until);
  const days: string[] = [];
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) days.push(profileDay(date));
  const weeks = Math.ceil(days.length / 7);
  const cell = Math.max(10, Math.min(16, Math.floor((width > 0 ? width - 30 : 800) / weeks) - 2));
  return { days, weeks, cell, width: weeks * (cell + 2) + 30, height: 7 * (cell + 2) + 20 };
}
