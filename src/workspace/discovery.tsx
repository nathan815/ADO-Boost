import React, { useEffect, useState } from "react";
import type { WorkspaceDependencies } from "./app";
import type { Page, Person, Preferences, Project, WorkspaceSession, WorkspaceSuggestions } from "./protocol";
import { Action, Errors, PersonLink, WorkspaceIcon } from "./components";
import { RepositorySelector } from "./repository-selector";

interface Props extends WorkspaceDependencies {
  session: WorkspaceSession; save: (preferences: Preferences) => Promise<void>; saving: boolean;
}

export function Projects({ session, client, queries, save, saving }: Props) {
  const [editing, setEditing] = useState(!session.preferences.projectsConfirmed || !session.preferences.projects.length);
  const [projects, setProjects] = useState<Project[]>([]);
  const [suggestions, setSuggestions] = useState<WorkspaceSuggestions>({ projects: [], repositories: [] });
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [suggestionError, setSuggestionError] = useState("");
  const [continuation, setContinuation] = useState<string | undefined>();
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(false);
  const showEditor = editing || !session.preferences.projects.length;
  const projectKey = session.preferences.projects.map((project) => project.id).sort().join(",");
  const load = async (append = false) => {
    setProjectsLoading(true);
    try {
      const page = await queries.read<Page<Project>>({ kind: "projects", ...(append && continuation ? { continuation } : {}) });
      setProjects((previous) => append ? [...new Map([...previous, ...page.items].map((project) => [project.id, project])).values()] : page.items);
      setMore(page.more); setContinuation(page.continuation); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Projects unavailable"); }
    finally { setProjectsLoading(false); }
  };
  useEffect(() => {
    if (session.preferences.projectsConfirmed && session.preferences.projects.length) setEditing(false);
  }, [session.preferences.projectsConfirmed]);
  useEffect(() => { if (showEditor && !projects.length) void load(); }, [showEditor]);
  useEffect(() => {
    let active = true;
    setSuggestionsLoading(true);
    void client.request<WorkspaceSuggestions>({ type: "workspace-suggestions" }).then((value) => {
      if (active) { setSuggestions(value); setSuggestionError(""); }
    }).catch((reason: unknown) => {
      if (active) setSuggestionError(reason instanceof Error ? reason.message : "Workspace suggestions unavailable");
    }).finally(() => { if (active) setSuggestionsLoading(false); });
    return () => { active = false; };
  }, [client, projectKey]);
  const selectedIds = new Set(session.preferences.projects.map((project) => project.id));
  const suggestedIds = new Set(suggestions.projects.map((project) => project.id));
  const rank = (project: Project) => selectedIds.has(project.id) ? 0 : project.id === session.currentProject?.id ? 1 : suggestedIds.has(project.id) ? 2 : 3;
  const visibleProjects = [...new Map([
    ...projects, ...suggestions.projects, ...(session.currentProject ? [session.currentProject] : []), ...session.preferences.projects
  ].map((project) => [project.id, project])).values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return <section className="discovery-view"><div className="page-heading"><div><span className="eyebrow">Make this workspace yours</span><h1>Projects</h1>
    <p className="page-description">Choose up to 10 projects in {session.context.organization} for your dashboard, profiles, and feed.</p></div>
    <span className="selection-count">{session.preferences.projects.length} / 10 selected</span></div>
    <Errors errors={[error, suggestionError].filter(Boolean)} />
    <section className="surface projects-surface">
    <div className="section-heading project-selection-heading"><h2><WorkspaceIcon name="projects" /> Your projects</h2>
      {showEditor ? <Action primary disabled={saving || !session.preferences.projects.length} onClick={() => {
        if (session.preferences.projectsConfirmed) setEditing(false);
        else void save({ ...session.preferences, projectsConfirmed: true });
      }}>{session.preferences.projectsConfirmed ? "Done" : "Confirm selections"}</Action> :
        <Action disabled={saving} onClick={() => setEditing(true)}>Edit projects</Action>}
    </div>
    {showEditor ? <>
    <p className="muted">Selected projects appear first, followed by suggestions from your locally cached authored and assigned PRs. Suggestions are not selected automatically.</p>
    <div className="project-list project-grid">{visibleProjects.map((project) => <label key={project.id} data-selected={selectedIds.has(project.id)}><input type="checkbox" disabled={saving}
      checked={selectedIds.has(project.id)}
      onChange={(event) => {
        const next = event.target.checked ? [...session.preferences.projects, project] : session.preferences.projects.filter((selected) => selected.id !== project.id);
        if (next.length > 10) { setError("Select at most 10 projects to keep requests bounded."); return; }
        void save({ ...session.preferences, projects: next });
      }} /><WorkspaceIcon name="projects" /><span>{project.name}{project.id === session.currentProject?.id ? <small className="muted"> · Current project</small> :
        suggestedIds.has(project.id) ? <small className="muted"> · Your PR activity</small> : null}</span></label>)}</div>
    <span className="sr-only" role="status">{projectsLoading ? "Loading projects..." : ""}</span>
    {more && <Action disabled={projectsLoading} onClick={() => void load(true)}>Load more projects</Action>}
    {!session.preferences.projects.length && <p className="muted">Select a project to start. Your choices are saved only in this browser.</p>}
    </> : <ul className="selected-projects" aria-label="Selected projects">
      {[...session.preferences.projects].sort((a, b) => a.name.localeCompare(b.name)).map((project) =>
        <li key={project.id}><WorkspaceIcon name="projects" /><span>{project.name}</span></li>)}
    </ul>}</section>
    {!!session.preferences.projects.length && <section className="surface"><h2>Repository favorites</h2>
      <p className="muted">Suggestions from your PR activity across selected projects appear first, followed by repositories in the project below. Check a repository to favorite it. Favorites are optional and do not limit PR queries.</p>
      <RepositorySelector projects={session.preferences.projects} currentProject={session.currentProject ?? null} queries={queries}
        suggestions={suggestions.repositories.filter((repo) => selectedIds.has(repo.project.id))} suggestionsLoading={suggestionsLoading} favorites={session.preferences.favorites} saving={saving} toggle={(id) => {
          const favorites = session.preferences.favorites.includes(id) ? session.preferences.favorites.filter((item) => item !== id) : [...session.preferences.favorites, id];
          if (favorites.length > 1000) { setError("Select at most 1000 repository favorites."); return; }
          void save({ ...session.preferences, favorites });
        }} /></section>}
  </section>;
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
