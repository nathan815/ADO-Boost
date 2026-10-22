import React, { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceDependencies } from "./app";
import { Action, Avatar, Errors, EventList, LoadingCards, PrList, SampleStats } from "./components";
import { ContributionGraph } from "./contribution-graph";
import { mergeEvents, type ActivityEvent } from "./activity";
import { profileContributions, profileDay, profilePeriod, profileRanges, profileStats } from "./profile";
import { prKey, type Person, type Preferences, type WorkspacePr, type WorkspaceSession } from "./protocol";
import { uniquePrs, type PrResults, type ReviewResults } from "./service";

interface Props extends WorkspaceDependencies {
  session: WorkspaceSession; save: (preferences: Preferences) => Promise<void>; openPerson: (person: Person) => void;
}

export function ProfileView({ session, service, save, openPerson }: Props) {
  const subject = session.subject ?? session.viewer;
  const [range, setRange] = useState("last-1y");
  const [repository, setRepository] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedDay, setSelectedDay] = useState("");
  const [refresh, setRefresh] = useState(0);
  const lastRefresh = useRef(0);
  const [data, setData] = useState<PrResults>({ created: [], assigned: [], more: false, errors: [] });
  const [history, setHistory] = useState<ReviewResults>({ events: [], errors: [], analyzed: [] });
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [updated, setUpdated] = useState("");
  const [visibleEvents, setVisibleEvents] = useState(100);
  const period = useMemo(() => profilePeriod(range), [range, refresh]);
  const projectKey = session.preferences.projects.map((project) => project.id).join(",");
  useEffect(() => {
    const controller = new AbortController();
    const force = refresh !== lastRefresh.current;
    lastRefresh.current = refresh;
    setLoading(true); setAnalyzing(false);
    setHistory({ events: [], errors: [], analyzed: [] });
    void (async () => {
      const result = await service.profile(subject, session.preferences.projects, period, controller.signal, force);
      controller.signal.throwIfAborted();
      setData(result); setUpdated(new Date().toLocaleTimeString()); setLoading(false);
      if (result.assigned.length) {
        setAnalyzing(true);
        const details = await service.reviews(result.assigned, controller.signal, force);
        controller.signal.throwIfAborted();
        setHistory(details);
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) setHistory({ events: [], analyzed: [], errors: [error instanceof Error ? error.message : "Profile history unavailable"] });
    }).finally(() => { if (!controller.signal.aborted) { setLoading(false); setAnalyzing(false); } });
    return () => controller.abort();
  }, [service, subject.id, projectKey, period.since, period.until, refresh]);
  const prs = uniquePrs([...data.created, ...data.assigned]);
  const repositories = [...new Map(prs.map((pr) => [pr.repository.id, pr.repository])).values()];
  const matches = (pr: WorkspacePr) => (!repository || pr.repository.id === repository) && (!favoritesOnly || session.preferences.favorites.includes(pr.repository.id));
  const created = data.created.filter(matches);
  const reviewed = data.assigned.filter(matches);
  const stats = profileStats(created, reviewed);
  const contributions = profileContributions(created, reviewed);
  const events: ActivityEvent[] = mergeEvents(history.events.filter((event) => matches(event.pr)), "1970-01-01T00:00:00Z", new Set([subject.id]));
  const reviewedKeys = new Set(reviewed.map(prKey));
  const analyzed = history.analyzed.filter((key) => reviewedKeys.has(key)).length;
  const initialLoading = loading && !updated;
  const repoCounts = new Map<string, { name: string; created: number; reviewed: number }>();
  for (const [kind, items] of [["created", created], ["reviewed", reviewed]] as const) {
    for (const pr of items) {
      const key = `${pr.repository.project.id}/${pr.repository.id}`;
      const entry = repoCounts.get(key) ?? { name: `${pr.repository.project.name} / ${pr.repository.name}`, created: 0, reviewed: 0 };
      entry[kind]++; repoCounts.set(key, entry);
    }
  }
  const following = session.preferences.follows.some((person) => person.id === subject.id);
  const toggleFavorite = (id: string) => void save({ ...session.preferences,
    favorites: session.preferences.favorites.includes(id) ? session.preferences.favorites.filter((favorite) => favorite !== id) : [...session.preferences.favorites, id] });
  const listProps = { context: session.context, openPerson, favorites: session.preferences.favorites, toggleFavorite, subject: subject.id, pageSize: 50 };
  return <section className="activity-view profile-view" aria-busy={loading}>
    <div className="page-heading profile-heading"><Avatar person={subject} context={session.context} size={64} />
      <div><span className="eyebrow">Contribution profile</span><h1>{subject.displayName}</h1><p className="page-description">PR activity across your selected projects.</p></div>
      <Action disabled={session.preferences.follows.length >= 50 && !following} onClick={() => void save({ ...session.preferences,
        follows: following ? session.preferences.follows.filter((person) => person.id !== subject.id) : [...session.preferences.follows, subject]
      })}>{following ? "Unfollow" : "Follow locally"}</Action>
    </div>
    <SampleStats loading={initialLoading} items={[
      { label: "PRs Created", value: stats.created, icon: "dashboard" }, { label: "PRs Reviewed", value: stats.reviewed, icon: "people" },
      { label: "Active PRs", value: stats.active, icon: "dashboard" }, { label: "Median Merge Time", value: stats.mergeTime, icon: "completed" }
    ]} />
    <div className="controls filter-bar">
      <label className="field">Period<select value={range} onChange={(event) => { setRange(event.target.value); setSelectedDay(""); }}>
        {profileRanges().map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="field">Repository<select value={repository} onChange={(event) => { setRepository(event.target.value); setSelectedDay(""); }}>
        <option value="">All repositories</option>{repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.project.name} / {repo.name}</option>)}</select></label>
      <label><input type="checkbox" checked={favoritesOnly} onChange={(event) => { setFavoritesOnly(event.target.checked); setSelectedDay(""); }} /> Favorites only</label>
      <Action disabled={loading || analyzing} onClick={() => setRefresh((value) => value + 1)}>Refresh history</Action>
    </div>
    <div className="sample-status"><span>{session.preferences.projects.length} selected projects <span className="status-divider">/</span> {prs.length} unique PRs</span>
      <details className="coverage"><summary>Coverage &amp; freshness{updated && <span> · {updated}</span>}</summary><p>
        All matching PR pages are loaded for the selected period and projects, with no fetch cap. Reviewed means a non-self PR with a non-zero current vote, matching PRScope.
        {" "}The graph groups activity by PR creation date in your local time zone, not the timestamp of a review.
        {" "}Settled historical months and review details stay cached in this browser. Recent ranges and ranges with active or recently closed PRs refresh after 5 minutes.
        {" "}Refresh history rechecks cached snapshots too. Missing access and failed requests are reported below, not counted as zero activity.
      </p></details>
    </div>
    <Errors errors={[...data.errors, ...history.errors]} />
    {loading && <p role="status">{initialLoading ? "Loading complete profile history..." : "Updating profile. Previous results remain visible until loading finishes."}</p>}
    {initialLoading ? <LoadingCards label="Loading contribution data..." /> : <>
      <section className="surface contribution-panel"><h2>PR Activity</h2>
        <ContributionGraph period={period} contributions={contributions} selected={selectedDay} select={setSelectedDay} />
        {selectedDay && <div className="controls"><span>PRs created on {selectedDay}</span><Action onClick={() => setSelectedDay("")}>Show all days</Action></div>}
      </section>
      <section className="surface"><h2>Top Repositories</h2><div className="repo-summary">
        {[...repoCounts.values()].sort((a, b) => (b.created + b.reviewed) - (a.created + a.reviewed)).slice(0, 10).map((repo) => <div key={repo.name}>
          <span>{repo.name}</span><strong>{repo.created} <small>created</small> <span className="status-divider">/</span> {repo.reviewed} <small>reviewed</small></strong>
        </div>)}
      </div>{!repoCounts.size && <p className="muted">No matching repositories in this period.</p>}</section>
      <section className="surface timeline-panel"><h2>Review Impact</h2>
        <p className="muted">{analyzed} of {reviewed.length} reviewed PRs have loaded thread details. Review events below use their actual timestamps.</p>
        {analyzing && <p role="status">Loading complete review history...</p>}
        <div className="profile-review-totals"><span><strong>{events.filter((event) => event.kind === "commented").length}</strong> comments</span>
          <span><strong>{events.filter((event) => event.kind === "voted").length}</strong> vote events</span></div>
        <EventList events={events.slice(0, visibleEvents)} context={session.context} openPerson={openPerson} />
        {events.length > visibleEvents && <Action onClick={() => setVisibleEvents((count) => count + 100)}>Show more review events</Action>}
        {!analyzing && !events.length && <p className="muted">No review events found for these PRs.</p>}
      </section>
      <div className="pr-columns">
        <PrList key={`created:${range}:${repository}:${favoritesOnly}:${selectedDay}`} title="Authored" prs={created.filter((pr) => !selectedDay || profileDay(pr.creationDate) === selectedDay)} {...listProps} />
        <PrList key={`reviewed:${range}:${repository}:${favoritesOnly}:${selectedDay}`} title="Reviewed" prs={reviewed.filter((pr) => !selectedDay || profileDay(pr.creationDate) === selectedDay)} {...listProps} />
      </div>
    </>}
  </section>;
}
