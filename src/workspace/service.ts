import { WorkspaceQueries } from "./client";
import { authoredEvents, mergeEvents, reviewEvents, type ActivityEvent } from "./activity";
import { prKey, type Page, type Person, type Project, type WorkspacePr, type WorkspaceThread } from "./protocol";
import { profileMonths, reviewedPrs, settledPr, type ProfilePeriod } from "./profile";

export interface PrResults {
  created: WorkspacePr[];
  assigned: WorkspacePr[];
  more: boolean;
  errors: string[];
}
export interface ReviewResults { events: ActivityEvent[]; errors: string[]; analyzed: string[] }

export async function boundedMap<T, R>(items: readonly T[], operation: (item: T) => Promise<R>, signal: AbortSignal, concurrency = 3): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      signal.throwIfAborted();
      const index = next++;
      results[index] = await operation(items[index]!);
    }
  }));
  signal.throwIfAborted();
  return results;
}

export function uniquePrs(prs: WorkspacePr[]): WorkspacePr[] {
  return [...new Map(prs.map((pr) => [prKey(pr), pr])).values()].sort((a, b) => b.creationDate.localeCompare(a.creationDate));
}

export class WorkspaceService {
  constructor(private readonly queries: WorkspaceQueries, private readonly now: () => number = Date.now) {}

  async profile(person: Person, projects: readonly Project[], period: ProfilePeriod, signal: AbortSignal, refresh = false): Promise<PrResults> {
    const tasks = projects.flatMap((project) => profileMonths(period).flatMap((month) =>
      (["created", "assigned"] as const).map((kind) => ({ project, month, kind }))));
    const results = await boundedMap(tasks, async ({ project, month, kind }) => {
      const items: WorkspacePr[] = [];
      const seen = new Set<string>();
      try {
        let skip = 0;
        let more = true;
        while (more) {
          signal.throwIfAborted();
          const page = await this.queries.read<Page<WorkspacePr>>({
            kind: "prs", project: project.name, status: "all", range: "created",
            ...(kind === "created" ? { creator: person.id } : { reviewer: person.id }),
            since: month.since, until: month.until, top: 500, skip
          }, refresh, Date.parse(month.until) <= this.now() - 7 * 86400_000 ? "history" : "recent");
          const previous = seen.size;
          for (const pr of page.items) seen.add(prKey(pr));
          items.push(...page.items);
          more = page.more;
          if (more && seen.size === previous) throw new Error("Azure DevOps PR pagination did not advance. Refresh to retry.");
          skip += page.items.length;
        }
        return { kind, items, error: null };
      } catch (error) {
        signal.throwIfAborted();
        return { kind, items, error: `${project.name} (${kind}, ${month.since.slice(0, 7)}): ${error instanceof Error ? error.message : "Profile history unavailable"}` };
      }
    }, signal);
    const inPeriod = (pr: WorkspacePr) => Date.parse(pr.creationDate) >= Date.parse(period.since) && Date.parse(pr.creationDate) <= Date.parse(period.until);
    const created = uniquePrs(results.filter((result) => result.kind === "created").flatMap((result) => result.items)).filter(inPeriod);
    const assigned = uniquePrs(results.filter((result) => result.kind === "assigned").flatMap((result) => result.items)).filter(inPeriod);
    return { created, assigned: reviewedPrs(assigned, person.id), more: false, errors: results.flatMap((result) => result.error ? [result.error] : []) };
  }

  async prs(person: Person, projects: readonly Project[], since: string, skip: number, status: "all" | "active" | "completed" | "abandoned", signal: AbortSignal, refresh = false, includeClosed = false): Promise<PrResults> {
    const tasks = projects.flatMap((project) => [
      { project, kind: "created" as const, range: "created" as const },
      { project, kind: "assigned" as const, range: "created" as const },
      ...(includeClosed ? [{ project, kind: "created" as const, range: "closed" as const }] : [])
    ]);
    const pages = await boundedMap(tasks, async (task) => {
      try {
        const page = await this.queries.read<Page<WorkspacePr>>({
          kind: "prs", project: task.project.name, status: task.range === "closed" ? "completed" : status,
          ...(task.kind === "created" ? { creator: person.id } : { reviewer: person.id }),
          since, skip, range: task.range
        }, refresh);
        return { ...task, page, error: null };
      } catch (error) {
        return { ...task, page: null, error: `${task.project.name} (${task.kind}): ${error instanceof Error ? error.message : "Request failed"}` };
      }
    }, signal);
    return {
      created: uniquePrs(pages.filter((page) => page.kind === "created").flatMap((page) => page.page?.items ?? [])),
      assigned: uniquePrs(pages.filter((page) => page.kind === "assigned").flatMap((page) => page.page?.items ?? [])),
      more: pages.some((page) => page.page?.more), errors: pages.flatMap((page) => page.error ? [page.error] : [])
    };
  }

  async reviews(prs: WorkspacePr[], signal: AbortSignal, refresh = false): Promise<ReviewResults> {
    const results = await boundedMap(uniquePrs(prs), async (pr) => {
      try {
        const historical = settledPr(pr, this.now());
        const threads = await this.queries.read<WorkspaceThread[]>({
          kind: "threads", project: pr.repository.project.name, repository: pr.repository.id, pr: pr.pullRequestId,
          ...(historical && pr.closedDate ? { closedDate: pr.closedDate } : {})
        }, refresh, historical ? "history" : "recent");
        return { key: prKey(pr), events: reviewEvents(pr, threads), error: null };
      } catch (error) {
        return { key: null, events: [], error: `${pr.title}: ${error instanceof Error ? error.message : "Review history unavailable"}` };
      }
    }, signal);
    return { events: results.flatMap((result) => result.events), analyzed: results.flatMap((result) => result.key ? [result.key] : []),
      errors: results.flatMap((result) => result.error ? [result.error] : []) };
  }

  async feed(people: readonly Person[], projects: readonly Project[], since: string, skip: number, signal: AbortSignal, refresh = false): Promise<{ prs: WorkspacePr[]; events: ActivityEvent[]; more: boolean; errors: string[] }> {
    const results: PrResults[] = [];
    for (const person of people) results.push(await this.prs(person, projects, since, skip, "all", signal, refresh, true));
    const prs = uniquePrs(results.flatMap((result) => [...result.created, ...result.assigned]));
    const events = mergeEvents(authoredEvents(prs), since, new Set(people.map((person) => person.id)));
    return { prs, events, more: results.some((result) => result.more), errors: results.flatMap((result) => result.errors) };
  }
}
