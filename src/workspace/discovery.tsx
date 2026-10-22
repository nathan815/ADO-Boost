import React, { useEffect, useState } from "react";
import type { WorkspaceDependencies } from "./app";
import type { Page, Person, Preferences, Project, Repository, WorkspaceSession } from "./protocol";
import { Action, Errors, PersonLink, WorkspaceIcon } from "./components";

interface Props extends WorkspaceDependencies {
  session: WorkspaceSession; save: (preferences: Preferences) => Promise<void>; saving: boolean;
}

export function Projects({ session, queries, save, saving }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [continuation, setContinuation] = useState<string | undefined>();
  const [more, setMore] = useState(false);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = async (append = false) => {
    setLoading(true);
    try {
      const page = await queries.read<Page<Project>>({ kind: "projects", ...(append && continuation ? { continuation } : {}) });
      setProjects((previous) => append ? [...new Map([...previous, ...page.items].map((project) => [project.id, project])).values()] : page.items);
      setMore(page.more); setContinuation(page.continuation); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Projects unavailable"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <section className="discovery-view"><div className="page-heading"><div><span className="eyebrow">Make this workspace yours</span><h1>Projects</h1>
    <p className="page-description">Choose up to 10 projects in {session.context.organization} for your dashboard, profiles, and feed.</p></div>
    <span className="selection-count">{session.preferences.projects.length} / 10 selected</span></div>
    <Errors errors={error ? [error] : []} />
    <section className="surface"><h2><WorkspaceIcon name="projects" /> Your projects</h2>
    <div className="project-list project-grid">{projects.map((project) => <label key={project.id} data-selected={session.preferences.projects.some((selected) => selected.id === project.id)}><input type="checkbox" disabled={saving}
      checked={session.preferences.projects.some((selected) => selected.id === project.id)}
      onChange={(event) => {
        const next = event.target.checked ? [...session.preferences.projects, project] : session.preferences.projects.filter((selected) => selected.id !== project.id);
        if (next.length > 10) { setError("Select at most 10 projects to keep requests bounded."); return; }
        void save({ ...session.preferences, projects: next });
      }} /><WorkspaceIcon name="projects" /><span>{project.name}</span></label>)}</div>
    {loading && <p role="status">Loading projects...</p>}
    {more && <Action disabled={loading} onClick={() => void load(true)}>Load more projects</Action>}
    {!session.preferences.projects.length && <p className="muted">Select a project to start. Your choices are saved only in this browser.</p>}</section>
    {!!session.preferences.projects.length && <section className="surface"><h2>Repository favorites</h2>
      <p className="muted">Favorites are optional. PR queries work without loading repository lists.</p>
      <div className="controls">{session.preferences.projects.map((project) => <Action key={project.id} disabled={loading} onClick={() => {
        setLoading(true);
        void queries.read<Repository[]>({ kind: "repositories", project: project.name }).then((value) => { setRepos(value); setError(""); })
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Repositories unavailable")).finally(() => setLoading(false));
      }}>{`Browse ${project.name}`}</Action>)}</div>
      <RepositoryList repos={repos} favorites={session.preferences.favorites} saving={saving} toggle={(id) => void save({
        ...session.preferences, favorites: session.preferences.favorites.includes(id) ? session.preferences.favorites.filter((item) => item !== id) : [...session.preferences.favorites, id]
      })} /></section>}
  </section>;
}

function RepositoryList({ repos, favorites, saving, toggle }: { repos: Repository[]; favorites: string[]; saving: boolean; toggle: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(100);
  const filtered = repos.filter((repo) => repo.name.toLowerCase().includes(search.toLowerCase()));
  return <><label className="field">Filter repositories<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(100); }} /></label>
    <div className="project-list">{filtered.slice(0, limit).map((repo) => <label key={repo.id}><input type="checkbox" disabled={saving} checked={favorites.includes(repo.id)} onChange={() => toggle(repo.id)} />{repo.name}</label>)}</div>
    {filtered.length > limit && <Action onClick={() => setLimit(limit + 100)}>Show more repositories</Action>}</>;
}

export function People({ session, queries, save, saving, openPerson }: Props & { openPerson: (person: Person) => void }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setResults([]); setError("");
    if (search.trim().length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      void queries.read<Person[]>({ kind: "people", query: search.trim() }).then((people) => {
        if (active) { setResults(people); setError(""); }
      }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "People search unavailable"); })
        .finally(() => { if (active) setLoading(false); });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [search, queries]);
  const toggle = (person: Person) => {
    const follows = session.preferences.follows.some((follow) => follow.id === person.id) ? session.preferences.follows.filter((follow) => follow.id !== person.id) : [...session.preferences.follows, person];
    if (follows.length > 50) { setError("Follow at most 50 people. The feed loads people progressively."); return; }
    void save({ ...session.preferences, follows });
  };
  return <section className="discovery-view"><div className="page-heading"><div><span className="eyebrow">Stay connected to your team</span><h1>People</h1>
    <p className="page-description">Find a teammate, explore their contributions, and follow their activity.</p></div><span className="selection-count">{session.preferences.follows.length} following</span></div>
    <div className="surface people-search"><WorkspaceIcon name="people" /><label className="field">Search by name or alias
      <input type="search" placeholder="Find a teammate..." value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <p className="muted">Follows stay in this browser. Azure DevOps subscriptions are unchanged.</p></div>
    <Errors errors={error ? [error] : []} />{loading && <p role="status">Searching people...</p>}
    <section className="surface"><h2>{search.trim().length >= 2 ? "Search results" : "Following"} <span className="count">{search.trim().length >= 2 ? results.length : session.preferences.follows.length}</span></h2>
    <ul className="people-list">{(search.trim().length >= 2 ? results : session.preferences.follows).map((person) => <li key={person.id}>
      <PersonLink person={person} context={session.context} open={openPerson} size={36} />
      <Action disabled={saving} onClick={() => toggle(person)}>{session.preferences.follows.some((follow) => follow.id === person.id) ? "Unfollow" : "Follow"}</Action>
    </li>)}</ul>
    {!loading && search.length >= 2 && !results.length && !error && <p>No matching people. Try a name or alias.</p>}
    {!search && !session.preferences.follows.length && <div className="empty-state"><WorkspaceIcon name="people" /><strong>Keep your team in view</strong>
      <p>Search for a teammate to open their profile or follow them.</p></div>}
  </section></section>;
}
