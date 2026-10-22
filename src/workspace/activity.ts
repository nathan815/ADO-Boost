import { prKey, type Person, type WorkspacePr, type WorkspaceThread } from "./protocol";

export interface ActivityEvent {
  id: string;
  kind: "created" | "completed" | "abandoned" | "commented" | "voted";
  actor: Person;
  date: string;
  pr: WorkspacePr;
  detail?: string;
}

export function authoredEvents(prs: WorkspacePr[]): ActivityEvent[] {
  return prs.flatMap((pr) => {
    const events: ActivityEvent[] = [{ id: `${prKey(pr)}:created`, kind: "created", actor: pr.createdBy, date: pr.creationDate, pr }];
    if (pr.closedDate && (pr.status === "completed" || pr.status === "abandoned")) {
      events.push({ id: `${prKey(pr)}:${pr.status}`, kind: pr.status, actor: pr.createdBy, date: pr.closedDate, pr });
    }
    return events;
  });
}

function property(value: unknown): unknown {
  return value && typeof value === "object" && "$value" in value ? value.$value : undefined;
}

export function reviewEvents(pr: WorkspacePr, threads: WorkspaceThread[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const thread of threads) {
    if (thread.isDeleted) continue;
    for (const comment of thread.comments) {
      if (comment.isDeleted || !comment.publishedDate || !comment.content || (comment.commentType !== "text" && comment.commentType !== 1)) continue;
      events.push({ id: `${prKey(pr)}:${thread.id}:${comment.id}`, kind: "commented", actor: comment.author, date: comment.publishedDate, pr, detail: comment.content.slice(0, 300) });
    }
    const actorId = property(thread.properties?.CodeReviewVotedByIdentity);
    const vote = property(thread.properties?.CodeReviewVoteResult);
    const identity = typeof actorId === "string" ? thread.identities?.[actorId] : undefined;
    const actor = identity ?? pr.reviewers.find((reviewer) => reviewer.id === actorId);
    if (actor && (typeof vote === "number" || typeof vote === "string") && thread.publishedDate) {
      const numeric = Number(vote);
      const labels: Record<number, string> = { 10: "Approved", 5: "Approved with suggestions", 0: "Vote reset", [-5]: "Waiting for author", [-10]: "Rejected" };
      if (labels[numeric]) events.push({
        id: `${prKey(pr)}:${thread.id}:vote`, kind: "voted", actor, date: thread.publishedDate, pr, detail: labels[numeric]
      });
    }
  }
  return events;
}

export function mergeEvents(events: ActivityEvent[], since: string, people?: Set<string>): ActivityEvent[] {
  return [...new Map(events.filter((event) => Number.isFinite(Date.parse(event.date)) && Date.parse(event.date) >= Date.parse(since) && (!people || people.has(event.actor.id)))
    .map((event) => [event.id, event])).values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

export function eventDay(date: string): string { return new Date(date).toISOString().slice(0, 10); }

export function contributionDays(events: ActivityEvent[], person: string): Array<{ day: string; count: number }> {
  const days = new Map<string, number>();
  for (const event of events) {
    if (event.actor.id !== person || event.kind === "completed" || event.kind === "abandoned") continue;
    const day = eventDay(event.date);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  return [...days].map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day));
}
