import React, { useEffect, useMemo, useState } from "react";
import type { WorkspaceDependencies } from "./app";
import { Action, Errors, EventList, LoadingCards, PrList, SampleStats } from "./components";
import { authoredEvents, mergeEvents, type ActivityEvent } from "./activity";
import { type Person, type Preferences, type WorkspacePr, type WorkspaceSession } from "./protocol";
import { uniquePrs, type PrResults } from "./service";

interface Props extends WorkspaceDependencies {
  session: WorkspaceSession; save: (preferences: Preferences) => Promise<void>; openPerson: (person: Person) => void;
}
const blankResults = (): PrResults => ({ created: [], assigned: [], more: false, errors: [] });

export function ActivityView({ session, service, save, openPerson }: Props) {
  const feed = session.view === "feed";
  const subject = session.subject ?? session.viewer;
  const [days, setDays] = useState(90);
  const [status, setStatus] = useState<"all" | "active" | "completed" | "abandoned">(feed ? "all" : "active");
  const [repository, setRepository] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [pages, setPages] = useState(1);
  const [peopleLimit, setPeopleLimit] = useState(5);
  const [includeSelf, setIncludeSelf] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<PrResults>(blankResults);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [reviews, setReviews] = useState<ActivityEvent[]>([]);
  const [reviewErrors, setReviewErrors] = useState<string[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [reviewLimit, setReviewLimit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [updated, setUpdated] = useState("");
  const since = useMemo(() => {
    const date = new Date(Date.now() - (days - 1) * 86400_000);
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString();
  }, [days]);
  const projectKey = session.preferences.projects.map((project) => project.id).join(",");
  const followsKey = session.preferences.follows.map((person) => person.id).join(",");
  const people = useMemo(() => {
    const followed = session.preferences.follows.filter((person) => person.id !== session.viewer.id);
    return [...(includeSelf ? [session.viewer] : []), ...followed.slice(0, peopleLimit)];
  }, [includeSelf, peopleLimit, followsKey, session.viewer.id]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setAnalyzing(false);
    void (async () => {
      let combined = blankResults();
      let allEvents: ActivityEvent[] = [];
      for (let page = 0; page < pages; page++) {
        if (feed) {
          const result = await service.feed(people, session.preferences.projects, since, page * 50, controller.signal, refresh > 0);
          combined = { created: uniquePrs([...combined.created, ...result.prs]), assigned: [], more: result.more, errors: [...combined.errors, ...result.errors] };
          allEvents.push(...result.events);
        } else {
          const result = await service.prs(subject, session.preferences.projects, since, page * 50, status, controller.signal, refresh > 0);
          combined = { created: uniquePrs([...combined.created, ...result.created]), assigned: uniquePrs([...combined.assigned, ...result.assigned]),
            more: result.more, errors: [...combined.errors, ...result.errors] };
        }
      }
      controller.signal.throwIfAborted();
      setReviews([]); setReviewCount(0); setReviewErrors([]);
      setData(combined); setEvents(feed ? mergeEvents(allEvents, since) : authoredEvents(combined.created));
      setUpdated(new Date().toLocaleTimeString());
      if (feed && combined.created.length) {
        setAnalyzing(true);
        const history = await service.reviews(combined.created.slice(0, reviewLimit), controller.signal, refresh > 0);
        controller.signal.throwIfAborted();
        setReviews(history.events); setReviewErrors(history.errors); setReviewCount(history.analyzed.length);
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) { setData({ ...blankResults(), errors: [error instanceof Error ? error.message : "Activity unavailable"] }); setEvents([]); }
    }).finally(() => { if (!controller.signal.aborted) { setLoading(false); setAnalyzing(false); } });
    return () => controller.abort();
  }, [service, session.viewer.id, subject.id, projectKey, followsKey, days, status, pages, feed, refresh, peopleLimit, includeSelf, feed ? reviewLimit : 0]);

  useEffect(() => {
    if (!feed) return;
    const update = () => { if (document.visibilityState === "visible") setRefresh((value) => value + 1); };
    const interval = setInterval(update, 120_000);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", update); };
  }, [feed]);

  const prs = uniquePrs([...data.created, ...data.assigned]);
  const reviewCandidates = data.assigned.filter((pr) => pr.createdBy.id !== subject.id);
  const repositories = [...new Map(prs.map((pr) => [pr.repository.id, pr.repository])).values()];
  const matches = (pr: WorkspacePr) => (!repository || pr.repository.id === repository) && (!favoritesOnly || session.preferences.favorites.includes(pr.repository.id));
  const visibleEvents = mergeEvents([...events, ...reviews], since, new Set((feed ? people : [subject]).map((person) => person.id)))
    .filter((event) => matches(event.pr));
  const toggleFavorite = (id: string) => void save({ ...session.preferences,
    favorites: session.preferences.favorites.includes(id) ? session.preferences.favorites.filter((favorite) => favorite !== id) : [...session.preferences.favorites, id] });
  const listProps = { context: session.context, openPerson, favorites: session.preferences.favorites, toggleFavorite, subject: subject.id };
  const initialLoading = loading && !updated;
  return <section className={`activity-view ${feed ? "feed-view" : "dashboard-view"}`}>
    <div className="page-heading">
      <div><span className="eyebrow">{feed ? "Your team, across projects" : "Your review workspace"}</span>
        <h1>{feed ? "Activity feed" : "My pull requests"}</h1>
        <p className="page-description">{feed ?
          "Keep up with the people and repositories you follow." : "What you're building. What's waiting for your review."}</p></div>
    </div>
    {!feed && <SampleStats loading={initialLoading} items={[
      { label: "Authored in sample", value: data.created.length, icon: "dashboard" },
      { label: "Assigned to review", value: reviewCandidates.length, icon: "people" },
      { label: "Draft PRs", value: prs.filter((pr) => pr.isDraft).length, icon: "dashboard" },
      { label: "Repositories in sample", value: repositories.length, icon: "projects" }
    ]} />}
    <div className="controls filter-bar">
      <label className="field">Period<select value={days} onChange={(event) => { setDays(Number(event.target.value)); setPages(1); }}>
        <option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last year</option></select></label>
      {!feed && <label className="field">PR status<select value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPages(1); }}>
        <option value="active">Active</option><option value="all">All statuses</option><option value="completed">Completed</option><option value="abandoned">Abandoned</option></select></label>}
      <label className="field">Repository<select value={repository} onChange={(event) => setRepository(event.target.value)}>
        <option value="">All loaded repositories</option>{repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.project.name} / {repo.name}</option>)}</select></label>
      <label><input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} /> Favorites only</label>
      {feed && <label><input type="checkbox" checked={includeSelf} onChange={(event) => setIncludeSelf(event.target.checked)} /> Include my activity</label>}
      <Action disabled={loading || analyzing} onClick={() => setRefresh((value) => value + 1)}>Refresh</Action>
    </div>
    <div className="sample-status"><span>{session.preferences.projects.length} selected {session.preferences.projects.length === 1 ? "project" : "projects"}
      <span className="status-divider" aria-hidden="true"> / </span>{prs.length} PRs in the loaded sample</span>
      <details className="coverage"><summary>Coverage &amp; freshness{updated && <span> · {updated}</span>}</summary><p>{session.preferences.projects.length} selected projects. {prs.length} unique PRs loaded; up to {pages * 50} PRs per query and project.
      {" "}Date filters use PR creation dates{feed ? " plus completed PR closure dates" : ""}, not every historical review date.
      {updated && ` Loaded at ${updated}. Cached results may be up to 5 minutes old.`}
      {" "}Missing access or failed queries are not counted as zero activity.</p></details></div>
    <Errors errors={[...data.errors, ...reviewErrors]} />
    {initialLoading && <LoadingCards label="Loading activity..." />}
    {loading && !initialLoading && <p className="loading-status" role="status">Updating activity. Showing the previous sample until it's ready.</p>}
    <div aria-busy={loading}>
    {feed && <>
      <p className="muted">Showing {people.length} people, including at most {peopleLimit} followed teammates. Refresh runs only while this workspace is open and visible.
        {" "}{reviewCount} of {prs.length} candidate PRs have available review events; current votes are not presented as dated events.</p>
      {!people.length && <div className="empty-state surface"><strong>Your team's activity starts here</strong><p>Follow teammates from People, or enable Include my activity.</p></div>}
      <div className="controls">
        {session.preferences.follows.length > peopleLimit && <Action disabled={loading} onClick={() => setPeopleLimit((limit) => limit + 5)}>Load more people</Action>}
        {prs.length > reviewLimit && <Action disabled={loading} onClick={() => setReviewLimit((limit) => limit + 20)}>Load more review events</Action>}
      </div>
    </>}
    {analyzing && <p role="status">Loading bounded review details...</p>}
    {feed && !initialLoading && <section className="surface timeline-panel"><h2>Observed activity <span className="count">{visibleEvents.length}</span></h2>
      <EventList events={visibleEvents} context={session.context} openPerson={openPerson} />
      {!loading && !visibleEvents.length && <div className="empty-state"><strong>No observed activity yet</strong><p>Load more PRs or review details to expand coverage.</p></div>}</section>}
    {!feed && !initialLoading && <div className="pr-columns">
      <PrList title="Authored" prs={data.created.filter(matches)} {...listProps} />
      <PrList title="Assigned to review" prs={data.assigned.filter((pr) => matches(pr) && pr.createdBy.id !== subject.id)} {...listProps} />
    </div>}
    </div>
    {data.more && <div className="controls"><Action disabled={loading || analyzing} onClick={() => setPages((value) => value + 1)}>Load more PRs</Action></div>}
  </section>;
}
